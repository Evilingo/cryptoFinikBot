import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { analyzeSignal } from '../claude/orchestrator.js';
import { broadcast } from '../../ws/hub.js';
import { getKlines } from '../binance/rest.js';

// In-memory store: symbol -> { current, previous, history[] }
const obdState = new Map();

// Deduplicate: no signal for same pair within 5 min
const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 5 * 60 * 1000;

export function getLatestObd(symbol) {
  return obdState.get(symbol)?.current || null;
}

export async function processObdUpdate(pair, obd, midPrice) {
  const symbol = pair.monitorSymbol;
  const state = obdState.get(symbol) || { current: null, previous: null, history: [] };

  state.previous = state.current;
  state.current = { ...obd, midPrice, timestamp: Date.now() };
  state.history.push(state.current);
  if (state.history.length > 120) state.history.shift(); // Keep ~10 min

  obdState.set(symbol, state);

  if (!state.previous) return;

  const signal = await detectSignal(pair, state);
  if (!signal) return;

  // Cooldown check
  const lastTime = lastSignalTime.get(symbol) || 0;
  if (Date.now() - lastTime < SIGNAL_COOLDOWN) {
    logger.debug(`Signal cooldown active for ${symbol}`);
    return;
  }

  lastSignalTime.set(symbol, Date.now());
  logger.info(`Signal detected for ${symbol}: ${signal}`, { obd });

  try {
    const candles = await getKlines(pair.monitorSymbol, pair.timeframe, 20);

    const analysis = await analyzeSignal(pair, obd, candles, midPrice);

    const saved = await prisma.signal.create({
      data: {
        pairId: pair.id,
        direction: analysis.direction,
        obd1: obd.obd1,
        obd2: obd.obd2,
        obd3: obd.obd3,
        obd4: obd.obd4,
        price: midPrice,
        claudeAnalysis: analysis.analysis,
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
      },
      include: { pair: true },
    });

    broadcast({
      type: 'SIGNAL',
      signal: {
        id: saved.id,
        pairId: saved.pairId,
        monitorSymbol: pair.monitorSymbol,
        tradeSymbol: pair.tradeSymbol,
        direction: analysis.direction,
        confidence: analysis.confidence,
        claudeAnalysis: analysis.analysis,
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
        price: midPrice,
        obd1: obd.obd1,
        obd2: obd.obd2,
        obd3: obd.obd3,
        obd4: obd.obd4,
        createdAt: saved.createdAt,
      },
    });
  } catch (err) {
    logger.error(`Signal processing failed for ${symbol}`, { error: err.message });
  }
}

async function detectSignal(pair, state) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const threshold = settings?.dipThreshold || 10;

  const { current, history } = state;
  if (history.length < 3) return null;

  // Find the minimum (dip) in recent history for each indicator
  const recent = history.slice(-12); // Last ~1 min
  const mins = {
    obd1: Math.min(...recent.map((h) => h.obd1)),
    obd2: Math.min(...recent.map((h) => h.obd2)),
    obd3: Math.min(...recent.map((h) => h.obd3)),
    obd4: Math.min(...recent.map((h) => h.obd4)),
  };

  // Find maximum before the dip to measure the drop
  const beforeDip = history.slice(-24, -12);
  if (beforeDip.length < 3) return null;

  const maxes = {
    obd1: Math.max(...beforeDip.map((h) => h.obd1)),
    obd2: Math.max(...beforeDip.map((h) => h.obd2)),
    obd3: Math.max(...beforeDip.map((h) => h.obd3)),
    obd4: Math.max(...beforeDip.map((h) => h.obd4)),
  };

  // Check: all 4 dipped by threshold
  const allDipped = ['obd1', 'obd2', 'obd3', 'obd4'].every(
    (k) => maxes[k] - mins[k] > threshold,
  );

  // Check: all 4 recovering (current > min)
  const allRecovering = ['obd1', 'obd2', 'obd3', 'obd4'].every(
    (k) => current[k] > mins[k] + 2, // At least 2 points above min
  );

  if (allDipped && allRecovering) return 'LONG';
  return null;
}
