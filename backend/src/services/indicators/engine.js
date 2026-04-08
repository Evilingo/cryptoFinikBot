import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { analyzeSignal } from '../claude/orchestrator.js';
import { sendTelegramNotification, formatSignalMessage } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';
import { getKlines } from '../binance/rest.js';

// In-memory store: symbol -> { current, previous, history[] }
const obdState = new Map();

// Deduplicate: no signal for same pair within 5 min
const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 5 * 60 * 1000;

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

  try {
    const candles = await getKlines(pair.monitorSymbol, pair.timeframe, 20);
    const analysis = await analyzeSignal(pair, obd, candles, midPrice);

    const saved = await prisma.signal.create({
      data: {
        pairId: pair.id,
        direction: analysis.direction || 'WAIT',
        confidence: analysis.confidence != null ? Math.round(analysis.confidence) : null,
        obd1: obd.obd1,
        obd2: obd.obd2,
        obd3: obd.obd3,
        obd4: obd.obd4,
        price: midPrice,
        claudeAnalysis: analysis.analysis || '',
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
      },
      include: { pair: true },
    });

    const signalData = {
      id: saved.id,
      pairId: saved.pairId,
      monitorSymbol: pair.monitorSymbol,
      tradeSymbol: pair.tradeSymbol,
      direction: analysis.direction,
      confidence: analysis.confidence,
      claudeAnalysis: analysis.analysis || '',
      suggestedSl: analysis.suggestedSl,
      suggestedTp: analysis.suggestedTp,
      price: midPrice,
      obd1: obd.obd1,
      obd2: obd.obd2,
      obd3: obd.obd3,
      obd4: obd.obd4,
      createdAt: saved.createdAt,
    };

    broadcast({ type: 'SIGNAL', signal: signalData });

    // Telegram notification
    sendTelegramNotification(formatSignalMessage(signalData)).catch((err) => {
      logger.error('Telegram notification failed', { error: err.message });
    });
  } catch (err) {
    logger.error(`Signal processing failed for ${symbol}`, { error: err.message });
  }
}

async function detectSignal(state) {
  const threshold = await getDipThreshold();

  const { current, history } = state;
  if (history.length < 3) return null;

  const recent = history.slice(-12);
  const mins = {
    obd1: Math.min(...recent.map((h) => h.obd1)),
    obd2: Math.min(...recent.map((h) => h.obd2)),
    obd3: Math.min(...recent.map((h) => h.obd3)),
    obd4: Math.min(...recent.map((h) => h.obd4)),
  };

  const beforeDip = history.slice(-24, -12);
  if (beforeDip.length < 3) return null;

  const maxes = {
    obd1: Math.max(...beforeDip.map((h) => h.obd1)),
    obd2: Math.max(...beforeDip.map((h) => h.obd2)),
    obd3: Math.max(...beforeDip.map((h) => h.obd3)),
    obd4: Math.max(...beforeDip.map((h) => h.obd4)),
  };

  const allDipped = ['obd1', 'obd2', 'obd3', 'obd4'].every(
    (k) => maxes[k] - mins[k] > threshold,
  );

  const allRecovering = ['obd1', 'obd2', 'obd3', 'obd4'].every(
    (k) => current[k] > mins[k] + 2,
  );

  if (allDipped && allRecovering) return 'LONG';
  return null;
}
