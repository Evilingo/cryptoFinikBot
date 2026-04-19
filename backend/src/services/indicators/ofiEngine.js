/**
 * OFI (Order Flow Imbalance) Engine
 * Detects BUY/SELL pressure from real executed trades (aggTrade stream).
 * Window: 60s, threshold: >65% buy = LONG, <35% buy = SHORT.
 */

import { prisma } from '../../db/prisma.js';
import { makeSettingCache } from '../../db/settingsCache.js';
import { logger } from '../../config/logger.js';
import { analyzeOfiSignal } from '../claude/orchestrator.js';
import { getMidPrice } from '../exchange/index.js';
import { executeAutoTrade } from './engine.js';
import { runClaudePipeline } from '../signals/claudePipeline.js';
import { broadcast } from '../../ws/hub.js';

// Per-symbol sliding window
const ofiState = new Map();

const OFI_WINDOW = 60_000;       // 60 seconds
const MIN_TRADES = 15;           // need at least 15 trades in window
const LONG_THRESHOLD = 0.65;     // buy ratio > 65%
const SHORT_THRESHOLD = 0.35;    // buy ratio < 35%

const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 90 * 60 * 1000;

const isOfiEnabled = makeSettingCache(
  async () => { const s = await prisma.settings.findUnique({ where: { id: 1 } }); return s?.ofiEnabled ?? false; },
  false,
);

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
  await runClaudePipeline(signalId, pair, midPrice, {
    getAnalysis: async (skipClaude) => {
      if (skipClaude) return { direction: signalDirection, confidence: 80, analysis: 'Claude skipped (test mode)', suggestedSl: null, suggestedTp: null };
      return analyzeOfiSignal(pair, midPrice, signalDirection, ofiRatio);
    },
    broadcastExtra: { strategy: 'OFI', ofiRatio },
    executeAutoTrade,
  });
}
