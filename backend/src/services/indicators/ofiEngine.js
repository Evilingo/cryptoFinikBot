/**
 * OFI (Order Flow Imbalance) Engine
 * Detects BUY/SELL pressure from real executed trades (aggTrade stream).
 * Window: 60s, threshold: >65% buy = LONG, <35% buy = SHORT.
 */

import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { analyzeOfiSignal } from '../claude/orchestrator.js';
import { sendTelegramNotification, formatSignalMessage } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';
import { getMidPrice } from '../exchange/index.js';
import { executeAutoTrade } from './engine.js';

// Per-symbol sliding window
const ofiState = new Map();

const OFI_WINDOW = 60_000;       // 60 seconds
const MIN_TRADES = 15;           // need at least 15 trades in window
const LONG_THRESHOLD = 0.65;     // buy ratio > 65%
const SHORT_THRESHOLD = 0.35;    // buy ratio < 35%

const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 90 * 60 * 1000;

// Cache ofiEnabled — refresh every 60s
let cachedOfiEnabled = false;
let ofiEnabledLastFetch = 0;
const OFI_CACHE_TTL = 60_000;

async function isOfiEnabled() {
  if (Date.now() - ofiEnabledLastFetch < OFI_CACHE_TTL) return cachedOfiEnabled;
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    cachedOfiEnabled = settings?.ofiEnabled ?? false;
    ofiEnabledLastFetch = Date.now();
  } catch {}
  return cachedOfiEnabled;
}

export async function processAggTrade(pair, { isBuyerMaker, price, qty }) {
  if (!await isOfiEnabled()) return;

  const symbol = pair.monitorSymbol;
  const now = Date.now();

  let state = ofiState.get(symbol);
  if (!state) {
    state = { trades: [] };
    ofiState.set(symbol, state);
  }

  const vol = parseFloat(qty) * parseFloat(price);
  state.trades.push({ time: now, isBuyerMaker, vol });

  // Evict trades outside window
  while (state.trades.length > 0 && now - state.trades[0].time > OFI_WINDOW) {
    state.trades.shift();
  }

  if (state.trades.length < MIN_TRADES) return;

  // Recompute from array on every check — avoids float drift from incremental +=/-=
  const buyVol = state.trades.reduce((s, t) => s + (t.isBuyerMaker ? 0 : t.vol), 0);
  const sellVol = state.trades.reduce((s, t) => s + (t.isBuyerMaker ? t.vol : 0), 0);
  const total = buyVol + sellVol;
  if (total === 0) return;

  const ratio = buyVol / total;
  let direction = null;
  if (ratio > LONG_THRESHOLD) direction = 'LONG';
  else if (ratio < SHORT_THRESHOLD) direction = 'SHORT';
  if (!direction) return;

  // Cooldown check
  const lastTime = lastSignalTime.get(symbol) || 0;
  if (now - lastTime < SIGNAL_COOLDOWN) return;
  lastSignalTime.set(symbol, now);

  const ofiRatio = Math.round(ratio * 100);
  logger.info(`OFI signal: ${direction} ${symbol} (${ofiRatio}% buy pressure)`);

  let midPrice;
  try {
    midPrice = await getMidPrice(pair.tradeSymbol);
  } catch (err) {
    logger.warn('OFI: getMidPrice failed', { error: err.message });
    return;
  }

  let saved;
  try {
    saved = await prisma.signal.create({
      data: {
        pairId: pair.id,
        direction,
        price: midPrice,
        claudeAnalysis: '',
        strategy: 'OFI',
        ofiRatio,
      },
      include: { pair: true },
    });
  } catch (err) {
    logger.error('OFI: failed to save signal', { error: err.message });
    return;
  }

  broadcast({
    type: 'SIGNAL',
    signal: {
      id: saved.id,
      pairId: saved.pairId,
      monitorSymbol: pair.monitorSymbol,
      tradeSymbol: pair.tradeSymbol,
      direction,
      confidence: null,
      claudeAnalysis: 'Analyzing...',
      suggestedSl: null,
      suggestedTp: null,
      price: midPrice,
      strategy: 'OFI',
      ofiRatio,
      createdAt: saved.createdAt,
    },
  });

  analyzeOfiWithClaude(saved.id, pair, midPrice, direction, ofiRatio).catch((err) => {
    logger.error(`OFI Claude failed for signal #${saved.id}`, { error: err.message });
  });
}

async function analyzeOfiWithClaude(signalId, pair, midPrice, signalDirection, ofiRatio) {
  try {
    const skipClaude = process.env.SKIP_CLAUDE_ANALYSIS === 'true';
    const analysis = skipClaude
      ? { direction: signalDirection, confidence: 80, analysis: 'Claude skipped (test mode)', suggestedSl: null, suggestedTp: null }
      : await analyzeOfiSignal(pair, midPrice, signalDirection, ofiRatio);

    let entryPrice = midPrice;
    if (analysis.direction !== 'WAIT') {
      try {
        entryPrice = await getMidPrice(pair.tradeSymbol);
      } catch {}
    }

    await prisma.signal.update({
      where: { id: signalId },
      data: {
        direction: analysis.direction || 'WAIT',
        confidence: analysis.confidence != null ? Math.round(analysis.confidence) : null,
        claudeAnalysis: analysis.analysis || '',
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
        price: entryPrice,
      },
    });

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
      strategy: 'OFI',
      ofiRatio,
    };

    broadcast({ type: 'SIGNAL_UPDATE', signal: updated });

    if (analysis.direction !== 'WAIT') {
      sendTelegramNotification(formatSignalMessage(updated), analysis.confidence).catch(() => {});
      executeAutoTrade(signalId, pair, analysis, entryPrice).catch((err) => {
        logger.error(`OFI auto-trade failed for signal #${signalId}`, { error: err.message });
      });
    }
  } catch (err) {
    await prisma.signal.update({
      where: { id: signalId },
      data: { claudeAnalysis: `Claude error: ${err.message}` },
    }).catch(() => {});
    throw err;
  }
}
