import { prisma } from '../../db/prisma.js';
import { makeSettingCache } from '../../db/settingsCache.js';
import { logger } from '../../config/logger.js';
import { analyzeSignal } from '../claude/orchestrator.js';
import { broadcast } from '../../ws/hub.js';
import { getKlines, placeOrder, getAccountBalance } from '../exchange/index.js';
import { placeTpSl, getOpenOrders, getSymbolInfo, getOrderHistory, cancelExitProtection, getMidPrice } from '../bybit/rest.js';
import { isSlOrder, isTpOrder } from '../bybit/orderMatchers.js';
import { runClaudePipeline } from '../signals/claudePipeline.js';
import { sendTelegramNotification } from '../notifications/notifier.js';

// In-memory store: symbol -> { current, previous, history[] }
const obdState = new Map();

// Deduplicate: no signal for same pair within 90 min
const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 15 * 60 * 1000;

// OBD snapshot recording: save every 30s per symbol
const lastSnapshotTime = new Map();
const SNAPSHOT_INTERVAL = 30_000;

const getDipThreshold = makeSettingCache(
  async () => { const s = await prisma.settings.findUnique({ where: { id: 1 } }); return s?.dipThreshold ?? 10; },
  10,
);

export function isSlDead(side, currentPrice, slPrice) {
  if (!slPrice || !currentPrice) return false;
  if (side === 'BUY') return currentPrice <= slPrice;
  return currentPrice >= slPrice;
}

export function isTpHit(side, currentPrice, tpPrice) {
  if (!tpPrice || !currentPrice) return false;
  if (side === 'BUY') return currentPrice >= tpPrice;
  return currentPrice <= tpPrice;
}

export function getLatestObd(symbol) {
  return obdState.get(symbol)?.current || null;
}

export async function processObdUpdate(pair, obd, midPrice) {
  const symbol = pair.monitorSymbol;
  const state = obdState.get(symbol) || { current: null, previous: null, history: [] };

  state.previous = state.current;
  state.current = { ...obd, midPrice, timestamp: Date.now() };
  state.history.push(state.current);
  if (state.history.length > 120) state.history.shift();

  obdState.set(symbol, state);

  // Save OBD snapshot every 30s for backtesting
  const now = Date.now();
  if (now - (lastSnapshotTime.get(symbol) || 0) >= SNAPSHOT_INTERVAL) {
    lastSnapshotTime.set(symbol, now);
    prisma.obdSnapshot.create({
      data: { pairId: pair.id, obd1: obd.obd1, obd2: obd.obd2, obd3: obd.obd3, obd4: obd.obd4, midPrice },
    }).catch((err) => logger.debug('OBD snapshot save failed', { error: err.message }));
  }

  if (!state.previous) return;

  const signal = await detectSignal(state);
  if (!signal) return;

  // Cooldown check
  const lastTime = lastSignalTime.get(symbol) || 0;
  if (Date.now() - lastTime < SIGNAL_COOLDOWN) {
    logger.debug(`Signal cooldown active for ${symbol}`);
    return;
  }

  lastSignalTime.set(symbol, Date.now());
  logger.info(`Signal detected for ${symbol}: ${signal}`, { obd });

  // Step 1: Save signal immediately (even without Claude)
  let saved;
  try {
    saved = await prisma.signal.create({
      data: {
        pairId: pair.id,
        direction: signal,
        obd1: obd.obd1,
        obd2: obd.obd2,
        obd3: obd.obd3,
        obd4: obd.obd4,
        price: midPrice,
        claudeAnalysis: '',
      },
      include: { pair: true },
    });
    logger.info(`Signal #${saved.id} saved for ${symbol}`, { price: midPrice });
  } catch (err) {
    logger.error(`Failed to save signal for ${symbol}`, { error: err.message });
    return;
  }

  // Step 2: Send to frontend immediately (without Claude analysis)
  const signalData = {
    id: saved.id,
    pairId: saved.pairId,
    monitorSymbol: pair.monitorSymbol,
    tradeSymbol: pair.tradeSymbol,
    direction: signal,
    confidence: null,
    claudeAnalysis: 'Analyzing...',
    suggestedSl: null,
    suggestedTp: null,
    price: midPrice,
    obd1: obd.obd1,
    obd2: obd.obd2,
    obd3: obd.obd3,
    obd4: obd.obd4,
    createdAt: saved.createdAt,
  };

  broadcast({ type: 'SIGNAL', signal: signalData });

  // Step 3: Call Claude in background (with retry), update signal
  analyzeWithClaude(saved.id, pair, obd, midPrice, signal).catch((err) => {
    logger.error(`Claude analysis failed for signal #${saved.id}`, { error: err.message });
  });
}

async function analyzeWithClaude(signalId, pair, obd, midPrice, signalDirection) {
  await runClaudePipeline(signalId, pair, midPrice, {
    getAnalysis: async (skipClaude) => {
      if (skipClaude) return { direction: signalDirection, confidence: 80, analysis: 'Claude skipped (test mode)', suggestedSl: null, suggestedTp: null };
      const candles = await getKlines(pair.monitorSymbol, pair.timeframe, 20);
      return analyzeSignal(pair, obd, candles, midPrice);
    },
    extraDbFields: (analysis, entryPrice) => ({
      rsi: analysis.rsi ?? null,
      trend5m: analysis.trend5m ?? null,
      trend15m: analysis.trend15m ?? null,
      atr: analysis.atr ?? null,
      atrPct: analysis.atrPct ?? null,
      tpPct: analysis.suggestedTp ? Math.round(Math.abs(analysis.suggestedTp - entryPrice) / entryPrice * 10000) / 100 : null,
      slPct: analysis.suggestedSl ? Math.round(Math.abs(entryPrice - analysis.suggestedSl) / entryPrice * 10000) / 100 : null,
    }),
    broadcastExtra: { obd1: obd.obd1, obd2: obd.obd2, obd3: obd.obd3, obd4: obd.obd4 },
    executeAutoTrade,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeAutoTrade(signalId, pair, analysis, entryPrice) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.autoTrade) return;

  const { direction, confidence, suggestedSl, suggestedTp } = analysis;
  const minConf = settings.minConfidence ?? 65;
  if (confidence != null && confidence < minConf) {
    logger.info('Auto-trade skipped: confidence below threshold', { confidence, minConf });
    return;
  }

  // Per-symbol guard: only one OPEN/PENDING trade per symbol at a time
  const existingTrade = await prisma.trade.findFirst({
    where: { symbol: pair.tradeSymbol, status: { in: ['OPEN', 'PENDING'] } },
  });

  if (existingTrade) {
    // TRADE-01: reverse signal — force-close existing position
    const isReverseSignal = (existingTrade.side === 'BUY' && direction === 'SHORT') ||
                            (existingTrade.side === 'SELL' && direction === 'LONG');
    if (isReverseSignal) {
      logger.info(
        { symbol: pair.tradeSymbol, existingSide: existingTrade.side, newDirection: direction },
        'auto-trade: reverse signal — closing existing position',
      );
      try {
        const oldExitSide = existingTrade.side === 'BUY' ? 'Sell' : 'Buy';
        await cancelExitProtection(pair.tradeSymbol, oldExitSide).catch(() => {});
        const closeSide = existingTrade.side === 'BUY' ? 'SELL' : 'BUY';
        await placeOrder({ symbol: pair.tradeSymbol, side: closeSide, quantity: existingTrade.quantity });
        await prisma.trade.update({
          where: { id: existingTrade.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
        sendTelegramNotification(
          `🔄 Reverse signal: closed ${existingTrade.side} ${pair.tradeSymbol} at market`,
          null,
        ).catch(() => {});
      } catch (err) {
        logger.error({ err }, 'auto-trade: failed to close position on reverse signal');
      }
    }
    // In both cases (reverse or same direction) — do not open a new position
    return;
  }

  // Check open trades limit (count OPEN only, PENDING is reserved for current flow)
  const openCount = await prisma.trade.count({ where: { status: 'OPEN' } });
  if (openCount >= settings.maxOpenTrades) {
    logger.info('Auto-trade skipped: maxOpenTrades limit reached', { openCount, max: settings.maxOpenTrades });
    return;
  }

  const side = direction === 'LONG' ? 'BUY' : 'SELL';

  if (side === 'SELL' && settings.allowShort === false) {
    logger.info('Auto-trade SHORT skipped: SHORT signals disabled in settings');
    return;
  }

  const quantity = settings.autoTradeAmount / entryPrice;

  // For SHORT (SELL): check we have enough of the asset
  if (side === 'SELL') {
    try {
      const balances = await getAccountBalance();
      const asset = pair.tradeSymbol.replace('USDT', '').replace('USDC', '').replace('BUSD', '');
      const bal = balances.find((b) => b.asset === asset);
      const free = parseFloat(bal?.free ?? '0');
      if (isNaN(free) || free < quantity) {
        logger.info('Auto-trade SHORT skipped: insufficient balance', { asset, required: quantity.toFixed(6), available: free.toFixed(6) });
        sendTelegramNotification(
          `⚠️ SHORT пропущен: недостаточно ${asset}\nНужно: ${quantity.toFixed(6)}, доступно: ${free.toFixed(6)}`,
          null,
        ).catch(() => {});
        return;
      }
    } catch (err) {
      logger.warn('Balance check failed for SHORT, skipping trade', { error: err.message });
      return;
    }
  }

  // ── Phase 1: Entry ──────────────────────────────────────────────────────────
  // Save as PENDING before placing order (so position is always tracked)
  const trade = await prisma.trade.create({
    data: {
      signalId,
      symbol: pair.tradeSymbol,
      side,
      quantity,
      price: entryPrice,
      stopLoss: suggestedSl || null,
      takeProfit: suggestedTp || null,
      binanceOrderId: '0',  // placeholder — updated below
      status: 'PENDING',
      slOrderFailed: false,
    },
  });

  logger.info('Auto-trade Phase 1: placing market order', {
    symbol: pair.tradeSymbol,
    side,
    quantity: quantity.toFixed(6),
    entryPrice,
    tradeId: trade.id,
  });

  let entryResult;
  try {
    entryResult = await placeOrder({ symbol: pair.tradeSymbol, side, quantity });
  } catch (err) {
    logger.error('Auto-trade Phase 1 failed: market order rejected', { symbol: pair.tradeSymbol, error: err.message, tradeId: trade.id });
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'FAILED' } });
    sendTelegramNotification(
      `🚨 Авто-сделка провалилась: не удалось разместить ордер ${side} ${pair.tradeSymbol}\nОшибка: ${err.message}`,
      null,
    ).catch(() => {});
    return;
  }

  // Poll for confirmed fill (up to 3 attempts, 1s apart). Capture both avgPrice
  // and cumExecQty/cumExecFee so Phase 2 has the real filled base qty (Bybit
  // wallet propagation is async; cumExec* is deterministic per-order).
  let confirmedPrice = entryResult.price;
  let confirmedFilledQty = 0;
  let confirmedFee = 0;
  if (!confirmedPrice || !confirmedFilledQty) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(1000);
      try {
        const histData = await getOrderHistory(pair.tradeSymbol, 5);
        const order = (histData.result?.list || []).find((o) => o.orderId === entryResult.orderId);
        if (order?.avgPrice) confirmedPrice = parseFloat(order.avgPrice);
        if (order?.cumExecQty) confirmedFilledQty = parseFloat(order.cumExecQty);
        if (order?.cumExecFee) confirmedFee = parseFloat(order.cumExecFee);
        if (confirmedPrice && confirmedFilledQty > 0) break;
      } catch (err) {
        logger.warn('Phase 1 fill poll failed', { attempt, error: err.message });
      }
    }
    if (side === 'BUY' && confirmedFilledQty === 0) {
      logger.warn('Phase 1: cumExecQty polling exhausted, Phase 2 will use gross qty (170131 risk)', { symbol: pair.tradeSymbol, orderId: entryResult.orderId });
    }
  }

  const confirmedQty = quantity;  // quantity was what we sent; real fill qty from Bybit not yet in poll
  await prisma.trade.update({
    where: { id: trade.id },
    data: {
      binanceOrderId: entryResult.orderId,
      price: confirmedPrice || entryPrice,
      quantity: confirmedQty,
    },
  });

  logger.info('Auto-trade Phase 1 done', { symbol: pair.tradeSymbol, orderId: entryResult.orderId, confirmedPrice, tradeId: trade.id });

  // ── Phase 2: Protection ─────────────────────────────────────────────────────
  // Если нет SL и TP — пропускаем Phase 2, сразу коммит
  if (!suggestedSl && !suggestedTp) {
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'OPEN', slOrderFailed: false } });
    logger.info('Auto-trade OPEN (no SL/TP configured)', { symbol: pair.tradeSymbol, tradeId: trade.id });
    sendTelegramNotification(
      `✅ Авто-сделка открыта\n${side} ${pair.tradeSymbol}\nЦена входа: ${confirmedPrice || entryPrice}\n(без SL/TP)`,
      null,
    ).catch(() => {});
    return;
  }

  const exitSide = side === 'BUY' ? 'Sell' : 'Buy';
  const backoffs = [500, 1000, 2000];
  let tpSlPlaced = false;
  let symbolInfo;

  try {
    symbolInfo = await getSymbolInfo(pair.tradeSymbol);
  } catch (err) {
    logger.error('Phase 2: failed to get symbol info', { symbol: pair.tradeSymbol, error: err.message });
    symbolInfo = { pricePrecision: 2, qtyPrecision: 6 };
  }

  // BUY-entry: Market BUY deducts ~0.1% fee from base asset (Bybit 170131).
  // Use cumExecQty - cumExecFee from Phase 1 polling (deterministic, no wallet lag).
  // SELL-entry: fee in quote, doesn't affect base qty — leave confirmedQty (task 13.6).
  // Fallback: if polling failed (cumExecQty=0), use gross confirmedQty.
  let tpSlQty = confirmedQty;
  if (side === 'BUY' && confirmedFilledQty > 0) {
    const netQty = confirmedFilledQty - confirmedFee;
    const factor = Math.pow(10, symbolInfo.qtyPrecision);
    const floored = Math.floor(netQty * factor) / factor;
    if (floored > 0) tpSlQty = floored;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await placeTpSl(pair.tradeSymbol, exitSide, suggestedSl || null, suggestedTp || null, symbolInfo, tpSlQty);
    } catch (err) {
      logger.warn(`Phase 2: placeTpSl attempt ${attempt + 1} failed`, { symbol: pair.tradeSymbol, qty: tpSlQty, error: err.message });
      // 170131 = insufficient balance (wallet propagation lag or fee mode mismatch) — shrink for next attempt
      if (err.message?.includes('170131') && side === 'BUY') {
        const factor = Math.pow(10, symbolInfo.qtyPrecision);
        tpSlQty = Math.floor(tpSlQty * 0.999 * factor) / factor;
        logger.warn('Phase 2: 170131 — shrinking tpSlQty for next attempt', { symbol: pair.tradeSymbol, newQty: tpSlQty });
      }
    }

    await sleep(backoffs[attempt]);

    try {
      const ordersData = await getOpenOrders(pair.tradeSymbol);
      const orders = ordersData.result?.list || [];
      const exitOrders = orders.filter((o) => o.side === exitSide);
      const slPlaced = !suggestedSl || exitOrders.some(isSlOrder);
      const tpPlaced = !suggestedTp || exitOrders.some(isTpOrder);
      if (slPlaced && tpPlaced) {
        tpSlPlaced = true;
        logger.info(`Phase 2: TP/SL verified on exchange (attempt ${attempt + 1})`, { symbol: pair.tradeSymbol, slPlaced, tpPlaced });
        break;
      }
      logger.warn(`Phase 2: TP/SL not found after attempt ${attempt + 1}`, { symbol: pair.tradeSymbol, orderCount: orders.length, slPlaced, tpPlaced });
    } catch (err) {
      logger.warn('Phase 2: getOpenOrders failed', { symbol: pair.tradeSymbol, error: err.message });
    }
  }

  if (!tpSlPlaced) {
    logger.error('Phase 2: TP/SL placement failed after 3 attempts — emergency close', { symbol: pair.tradeSymbol, tradeId: trade.id });
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    try {
      await cancelExitProtection(pair.tradeSymbol, exitSide).catch(() => {});
      await placeOrder({ symbol: pair.tradeSymbol, side: closeSide, quantity: confirmedQty });
      logger.info('Emergency close executed', { symbol: pair.tradeSymbol });
    } catch (closeErr) {
      logger.error('CRITICAL: emergency close failed — manual intervention required', {
        symbol: pair.tradeSymbol,
        tradeId: trade.id,
        error: closeErr.message,
      });
    }
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'FAILED', slOrderFailed: true } });
    sendTelegramNotification(
      `🚨 Позиция закрыта аварийно: SL не создан\n${side} ${pair.tradeSymbol}\nТрейд #${trade.id}`,
      null,
    ).catch(() => {});
    return;
  }

  // ── Phase 3: Commit ──────────────────────────────────────────────────────────
  await prisma.trade.update({
    where: { id: trade.id },
    data: { status: 'OPEN', slOrderFailed: false },
  });

  logger.info('Auto-trade Phase 3: trade OPEN with confirmed TP/SL', {
    symbol: pair.tradeSymbol,
    orderId: entryResult.orderId,
    price: confirmedPrice || entryPrice,
    tradeId: trade.id,
  });

  sendTelegramNotification(
    `✅ Авто-сделка открыта\n${side} ${pair.tradeSymbol}\nЦена входа: ${confirmedPrice || entryPrice}\nSL: ${suggestedSl || 'нет'} | TP: ${suggestedTp || 'нет'}`,
    null,
  ).catch(() => {});
}

// ── Phase 4: Reconciliation ──────────────────────────────────────────────────
let reconciliationTimer = null;

async function reconcileTpSl() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.bybitApiKey || !settings?.bybitSecret) {
    logger.debug('[TpSlReconciliation] Skipped: Bybit API keys not configured');
    return;
  }

  const openTrades = await prisma.trade.findMany({ where: { status: 'OPEN' } });
  if (openTrades.length === 0) return;

  const AGE_LIMIT_MS = 55 * 60 * 1000; // 55 minutes
  const now = Date.now();

  for (const trade of openTrades) {
    try {
      // Dead protection guard (always, regardless of age): SL trigger already crossed
      // or TP already hit at current price. Bybit accepts the protection order silently
      // but it never fires — zombie protection accumulates losses. Emergency close instead.
      let currentPrice = null;
      try { currentPrice = await getMidPrice(trade.symbol); } catch {}
      if (currentPrice) {
        const slDead = isSlDead(trade.side, currentPrice, trade.stopLoss);
        const tpAlreadyHit = isTpHit(trade.side, currentPrice, trade.takeProfit);
        if (slDead || tpAlreadyHit) {
          const reason = slDead
            ? `SL trigger ${trade.stopLoss} already crossed (current ${currentPrice})`
            : `TP target ${trade.takeProfit} already reached (current ${currentPrice})`;
          logger.warn('[TpSlReconciliation] Dead protection — emergency close', { tradeId: trade.id, reason });

          const oldExitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
          const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';

          await cancelExitProtection(trade.symbol, oldExitSide).catch(() => {});

          const baseAsset = trade.symbol.replace(/USDT$|USDC$/, '');
          let qty = trade.quantity;
          try {
            const coins = await getAccountBalance();
            const coin = coins.find((c) => c.asset === baseAsset);
            const realQty = parseFloat(coin?.free || 0);
            if (realQty > 0) qty = realQty;
          } catch {}

          try {
            await placeOrder({ symbol: trade.symbol, side: closeSide, quantity: qty });
            sendTelegramNotification(
              `🚨 ${trade.symbol} #${trade.id} — ${reason}\nЗакрыто маркетом во избежание dead SL`,
              null,
            ).catch(() => {});
          } catch (err) {
            logger.error('[TpSlReconciliation] Emergency close failed', { tradeId: trade.id, error: err.message });
          }
          continue; // skip placeTpSl; userDataStream closes the Trade record on fill
        }
      }

      const ageMs = now - new Date(trade.createdAt).getTime();
      if (ageMs >= AGE_LIMIT_MS) {
        logger.debug('[TpSlReconciliation] Skipping old trade for recreate', { tradeId: trade.id, ageMin: Math.round(ageMs / 60000) });
        continue;
      }

      const ordersData = await getOpenOrders(trade.symbol);
      const orders = ordersData.result?.list || [];
      const exitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
      const exitOrders = orders.filter((o) => o.side === exitSide);
      const slPlaced = !trade.stopLoss || exitOrders.some(isSlOrder);
      const tpPlaced = !trade.takeProfit || exitOrders.some(isTpOrder);

      if (slPlaced && tpPlaced) continue; // Protection orders are present

      logger.warn('[TpSlReconciliation] Missing TP/SL for OPEN trade — attempting to recreate', { tradeId: trade.id, symbol: trade.symbol });

      let symbolInfo;
      try {
        symbolInfo = await getSymbolInfo(trade.symbol);
      } catch {
        symbolInfo = { pricePrecision: 2, qtyPrecision: 6 };
      }

      try {
        await placeTpSl(
          trade.symbol,
          exitSide,
          slPlaced ? null : (trade.stopLoss || null),
          tpPlaced ? null : (trade.takeProfit || null),
          symbolInfo,
          trade.quantity,
        );
        logger.info('[TpSlReconciliation] TP/SL recreated', { tradeId: trade.id, symbol: trade.symbol, slPlaced, tpPlaced });
      } catch (placeErr) {
        logger.error('[TpSlReconciliation] Failed to recreate TP/SL', { tradeId: trade.id, symbol: trade.symbol, error: placeErr.message });
        await prisma.trade.update({ where: { id: trade.id }, data: { slOrderFailed: true } });
        sendTelegramNotification(
          `🚨 Нет защитных ордеров для ${trade.symbol} (трейд #${trade.id})\nSL/TP не удалось пересоздать: ${placeErr.message}`,
          null,
        ).catch(() => {});
      }
    } catch (err) {
      logger.warn('[TpSlReconciliation] Error checking trade', { tradeId: trade.id, symbol: trade.symbol, error: err.message });
    }
  }
}

export function startReconciliation() {
  if (reconciliationTimer) return;
  reconciliationTimer = setInterval(() => {
    reconcileTpSl().catch((err) => logger.warn('[TpSlReconciliation] Unexpected error', { error: err.message }));
  }, 60_000);
  logger.info('[TpSlReconciliation] Started (interval: 60s)');
}

export function stopReconciliation() {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
    logger.info('[TpSlReconciliation] Stopped');
  }
}

// OBD3/OBD4 are structural indicators — require 2× relative threshold
const OBD_KEYS = ['obd1', 'obd2', 'obd3', 'obd4'];
const OBD_MIN_MATCH = 3; // 3 of 4 levels must confirm (obd4 is naturally stable)

/**
 * Trend filter via EMA-20 slope on midPrice snapshots.
 * Returns 'UP', 'DOWN', or 'NEUTRAL'.
 * NEUTRAL when |slope / price| < SLOPE_EPSILON (choppy / sideways).
 */
const EMA_PERIOD = 20;
const SLOPE_EPSILON = 0.00003; // 0.003% per snapshot — below this = sideways

function detectTrendStructure(prices) {
  if (prices.length < EMA_PERIOD) return 'NEUTRAL';
  const k = 2 / (EMA_PERIOD + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  // Slope: compare last EMA to EMA computed one step earlier
  let emaPrev = prices[0];
  for (let i = 1; i < prices.length - 1; i++) {
    emaPrev = prices[i] * k + emaPrev * (1 - k);
  }
  const slope = ema - emaPrev;
  const relSlope = Math.abs(slope) / ema;
  if (relSlope < SLOPE_EPSILON) return 'NEUTRAL';
  return slope > 0 ? 'UP' : 'DOWN';
}

// Shared detection core — used by both detectSignal (live) and detectSignalFromHistory (backtest).
// trend: 'UP' | 'DOWN' | null (null = no trend gate, allow any direction)
function runDetection(recent, beforeWindow, current, thresholdPct, trend) {
  const recentMins  = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.min(...recent.map((h) => h[k]))]));
  const beforeMaxes = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.max(...beforeWindow.map((h) => h[k]))]));
  const dippedCount = OBD_KEYS.filter((k) => beforeMaxes[k] > 0 && (beforeMaxes[k] - recentMins[k]) / beforeMaxes[k] >= thresholdPct / 100).length;
  const recoveringCount = OBD_KEYS.filter((k) => current[k] > recentMins[k] + 2).length;
  if (dippedCount >= OBD_MIN_MATCH && recoveringCount >= OBD_MIN_MATCH && (trend === null || trend === 'UP')) return 'LONG';

  const recentMaxes = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.max(...recent.map((h) => h[k]))]));
  const beforeMins  = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.min(...beforeWindow.map((h) => h[k]))]));
  const spikedCount = OBD_KEYS.filter((k) => recentMaxes[k] > 0 && (recentMaxes[k] - beforeMins[k]) / recentMaxes[k] >= thresholdPct / 100).length;
  const fallingCount = OBD_KEYS.filter((k) => current[k] < recentMaxes[k] - 2).length;
  if (spikedCount >= OBD_MIN_MATCH && fallingCount >= OBD_MIN_MATCH && (trend === null || trend === 'DOWN')) return 'SHORT';

  return null;
}

/**
 * Pure synchronous version — used by backtester (no DB/async).
 * trendContext: optional snapshot array (with midPrice) for trend structure gate.
 *   Pass null to disable the filter.
 */
export function detectSignalFromHistory(history, thresholdPct = 10, trendContext = null) {
  if (history.length < 24) return null;
  const current = history[history.length - 1];
  const recent = history.slice(-12);
  const beforeWindow = history.slice(-24, -12);
  if (beforeWindow.length < 3) return null;

  let trend = null;
  if (trendContext && trendContext.length >= 10) {
    trend = detectTrendStructure(trendContext.map((s) => s.midPrice));
    if (trend === 'NEUTRAL') return null;
  }

  return runDetection(recent, beforeWindow, current, thresholdPct, trend);
}

async function detectSignal(state) {
  const thresholdPct = await getDipThreshold();
  const { current, history } = state;
  if (history.length < 3) return null;

  const recent = history.slice(-12);
  const beforeWindow = history.slice(-24, -12);
  if (beforeWindow.length < 3) return null;

  const trend = history.length >= EMA_PERIOD
    ? detectTrendStructure(history.map((s) => s.midPrice))
    : 'NEUTRAL';
  if (trend === 'NEUTRAL') return null;

  return runDetection(recent, beforeWindow, current, thresholdPct, trend);
}
