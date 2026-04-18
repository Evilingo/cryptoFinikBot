import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { analyzeSignal } from '../claude/orchestrator.js';
import { sendTelegramNotification, formatSignalMessage } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';
import { getKlines, getMidPrice, placeOrder, getAccountBalance } from '../exchange/index.js';

// In-memory store: symbol -> { current, previous, history[] }
const obdState = new Map();

// Deduplicate: no signal for same pair within 90 min
const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 15 * 60 * 1000;

// OBD snapshot recording: save every 30s per symbol
const lastSnapshotTime = new Map();
const SNAPSHOT_INTERVAL = 30_000;

// Cache dipThreshold — refresh every 60s
let cachedThreshold = 10;
let thresholdLastFetch = 0;
const THRESHOLD_CACHE_TTL = 60_000;

async function getDipThreshold() {
  if (Date.now() - thresholdLastFetch < THRESHOLD_CACHE_TTL) return cachedThreshold;
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    cachedThreshold = settings?.dipThreshold || 10;
    thresholdLastFetch = Date.now();
  } catch {}
  return cachedThreshold;
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
  try {
    const candles = await getKlines(pair.monitorSymbol, pair.timeframe, 20);

    // Skip Claude if env var set (test mode)
    const skipClaude = process.env.SKIP_CLAUDE_ANALYSIS === 'true';
    const analysis = skipClaude
      ? { direction: signalDirection, confidence: 80, analysis: 'Claude skipped (test mode)', suggestedSl: null, suggestedTp: null }
      : await analyzeSignal(pair, obd, candles, midPrice);

    // Fetch actual entry price after Claude response (price may have moved)
    let entryPrice = midPrice;
    if (analysis.direction !== 'WAIT') {
      try {
        entryPrice = await getMidPrice(pair.tradeSymbol);
        logger.info(`Entry price updated after Claude`, {
          symbol: pair.monitorSymbol,
          signalPrice: midPrice,
          entryPrice,
          drift: ((entryPrice - midPrice) / midPrice * 100).toFixed(3) + '%',
        });
      } catch (err) {
        logger.warn(`Failed to fetch entry price, using signal price`, { error: err.message });
      }
    }

    // Update signal in DB with Claude analysis and actual entry price
    await prisma.signal.update({
      where: { id: signalId },
      data: {
        direction: analysis.direction || 'WAIT',
        confidence: analysis.confidence != null ? Math.round(analysis.confidence) : null,
        claudeAnalysis: analysis.analysis || '',
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
        price: entryPrice,
        rsi: analysis.rsi ?? null,
        trend5m: analysis.trend5m ?? null,
        trend15m: analysis.trend15m ?? null,
        atr: analysis.atr ?? null,
        atrPct: analysis.atrPct ?? null,
      },
    });

    logger.info(`Signal #${signalId} updated with Claude analysis`, {
      direction: analysis.direction,
      confidence: analysis.confidence,
      entryPrice,
    });

    // Broadcast updated signal
    const updated = {
      id: signalId,
      monitorSymbol: pair.monitorSymbol,
      tradeSymbol: pair.tradeSymbol,
      direction: analysis.direction,
      confidence: analysis.confidence,
      claudeAnalysis: analysis.analysis || '',
      suggestedSl: analysis.suggestedSl,
      suggestedTp: analysis.suggestedTp,
      price: entryPrice,
      obd1: obd.obd1,
      obd2: obd.obd2,
      obd3: obd.obd3,
      obd4: obd.obd4,
    };

    broadcast({ type: 'SIGNAL_UPDATE', signal: updated });

    // Telegram notification (only after Claude confirms, respects minConfidence)
    if (analysis.direction !== 'WAIT') {
      sendTelegramNotification(formatSignalMessage(updated), analysis.confidence).catch((err) => {
        logger.error('Telegram notification failed', { error: err.message });
      });

      // Auto-trade if enabled
      executeAutoTrade(signalId, pair, analysis, entryPrice).catch((err) => {
        logger.error(`Auto-trade failed for signal #${signalId}`, { error: err.message });
      });
    }
  } catch (err) {
    // Save error to DB so we know Claude failed
    await prisma.signal.update({
      where: { id: signalId },
      data: { claudeAnalysis: `Claude error: ${err.message}` },
    }).catch(() => {});
    throw err;
  }
}

export async function executeAutoTrade(signalId, pair, analysis, entryPrice) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.autoTrade) return;

  const { direction, confidence, suggestedSl, suggestedTp } = analysis;
  const minConf = settings.minConfidence ?? 65;
  if (confidence != null && confidence < minConf) {
    logger.info('Auto-trade skipped: confidence below threshold', { confidence, minConf });
    return;
  }

  // Check open trades limit
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

  logger.info('Executing auto-trade', {
    symbol: pair.tradeSymbol,
    side,
    quantity: quantity.toFixed(6),
    entryPrice,
    sl: suggestedSl,
    tp: suggestedTp,
  });

  const result = await placeOrder({
    symbol: pair.tradeSymbol,
    side,
    quantity,
    stopLoss: suggestedSl || undefined,
    takeProfit: suggestedTp || undefined,
  });

  await prisma.trade.create({
    data: {
      signalId,
      symbol: pair.tradeSymbol,
      side,
      quantity,
      price: result.price || entryPrice,
      stopLoss: suggestedSl || null,
      takeProfit: suggestedTp || null,
      binanceOrderId: result.orderId,
      status: 'OPEN',
    },
  });

  logger.info('Auto-trade executed and saved', {
    symbol: pair.tradeSymbol,
    orderId: result.orderId,
    price: result.price,
    type: result.type,
  });

  // Notify about auto-trade
  sendTelegramNotification(
    `🤖 Авто-сделка открыта\n${side} ${pair.tradeSymbol}\nЦена: ${result.price}\nSL: ${suggestedSl || 'нет'} | TP: ${suggestedTp || 'нет'}`,
    null,
  ).catch(() => {});
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

/**
 * Pure synchronous version — used by backtester (no DB/async).
 * thresholdPct: relative dip/spike size in % (default 10%).
 *   OBD1/OBD2 require ≥ thresholdPct%, OBD3/OBD4 require ≥ 2×thresholdPct%.
 * trendContext: optional snapshot array (with midPrice) for trend structure gate.
 *   LONG only allowed when trend = 'UP', SHORT only when trend = 'DOWN'.
 *   Pass null to disable the filter (legacy behaviour).
 */
export function detectSignalFromHistory(history, thresholdPct = 10, trendContext = null) {
  if (history.length < 24) return null;
  const current = history[history.length - 1];
  const recent = history.slice(-12);
  const beforeWindow = history.slice(-24, -12);
  if (beforeWindow.length < 3) return null;

  // Trend structure gate
  let trend = 'NEUTRAL';
  if (trendContext && trendContext.length >= 10) {
    trend = detectTrendStructure(trendContext.map((s) => s.midPrice));
    if (trend === 'NEUTRAL') return null;
  }

  const recentMins  = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.min(...recent.map((h) => h[k]))]));
  const beforeMaxes = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.max(...beforeWindow.map((h) => h[k]))]));
  const dippedCount = OBD_KEYS.filter((k) => {
    if (beforeMaxes[k] <= 0) return false;
    return (beforeMaxes[k] - recentMins[k]) / beforeMaxes[k] >= thresholdPct / 100;
  }).length;
  const recoveringCount = OBD_KEYS.filter((k) => current[k] > recentMins[k] + 2).length;
  if (dippedCount >= OBD_MIN_MATCH && recoveringCount >= OBD_MIN_MATCH && (trendContext === null || trend === 'UP')) return 'LONG';

  const recentMaxes = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.max(...recent.map((h) => h[k]))]));
  const beforeMins  = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.min(...beforeWindow.map((h) => h[k]))]));
  const spikedCount = OBD_KEYS.filter((k) => {
    if (recentMaxes[k] <= 0) return false;
    return (recentMaxes[k] - beforeMins[k]) / recentMaxes[k] >= thresholdPct / 100;
  }).length;
  const fallingCount = OBD_KEYS.filter((k) => current[k] < recentMaxes[k] - 2).length;
  if (spikedCount >= OBD_MIN_MATCH && fallingCount >= OBD_MIN_MATCH && (trendContext === null || trend === 'DOWN')) return 'SHORT';

  return null;
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

  // --- LONG ---
  const recentMins  = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.min(...recent.map((h) => h[k]))]));
  const beforeMaxes = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.max(...beforeWindow.map((h) => h[k]))]));
  const dippedCount = OBD_KEYS.filter((k) => {
    if (beforeMaxes[k] <= 0) return false;
    return (beforeMaxes[k] - recentMins[k]) / beforeMaxes[k] >= thresholdPct / 100;
  }).length;
  const recoveringCount = OBD_KEYS.filter((k) => current[k] > recentMins[k] + 2).length;
  if (dippedCount >= OBD_MIN_MATCH && recoveringCount >= OBD_MIN_MATCH && trend === 'UP') return 'LONG';

  // --- SHORT ---
  const recentMaxes = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.max(...recent.map((h) => h[k]))]));
  const beforeMins  = Object.fromEntries(OBD_KEYS.map((k) => [k, Math.min(...beforeWindow.map((h) => h[k]))]));
  const spikedCount = OBD_KEYS.filter((k) => {
    if (recentMaxes[k] <= 0) return false;
    return (recentMaxes[k] - beforeMins[k]) / recentMaxes[k] >= thresholdPct / 100;
  }).length;
  const fallingCount = OBD_KEYS.filter((k) => current[k] < recentMaxes[k] - 2).length;
  if (spikedCount >= OBD_MIN_MATCH && fallingCount >= OBD_MIN_MATCH && trend === 'DOWN') return 'SHORT';

  return null;
}
