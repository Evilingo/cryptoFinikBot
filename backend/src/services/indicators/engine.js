import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { analyzeSignal } from '../claude/orchestrator.js';
import { sendTelegramNotification, formatSignalMessage } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';
import { getKlines } from '../binance/rest.js';

// In-memory store: symbol -> { current, previous, history[] }
const obdState = new Map();

// Deduplicate: no signal for same pair within 15 min
const lastSignalTime = new Map();
const SIGNAL_COOLDOWN = 15 * 60 * 1000;

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
  analyzeWithClaude(saved.id, pair, obd, midPrice).catch((err) => {
    logger.error(`Claude analysis failed for signal #${saved.id}`, { error: err.message });
  });
}

async function analyzeWithClaude(signalId, pair, obd, midPrice) {
  try {
    const candles = await getKlines(pair.monitorSymbol, pair.timeframe, 20);
    const analysis = await analyzeSignal(pair, obd, candles, midPrice);

    // Update signal in DB with Claude analysis
    await prisma.signal.update({
      where: { id: signalId },
      data: {
        direction: analysis.direction || 'WAIT',
        confidence: analysis.confidence != null ? Math.round(analysis.confidence) : null,
        claudeAnalysis: analysis.analysis || '',
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
      },
    });

    logger.info(`Signal #${signalId} updated with Claude analysis`, {
      direction: analysis.direction,
      confidence: analysis.confidence,
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
      price: midPrice,
      obd1: obd.obd1,
      obd2: obd.obd2,
      obd3: obd.obd3,
      obd4: obd.obd4,
    };

    broadcast({ type: 'SIGNAL_UPDATE', signal: updated });

    // Telegram notification (only after Claude confirms)
    if (analysis.direction !== 'WAIT') {
      sendTelegramNotification(formatSignalMessage(updated)).catch((err) => {
        logger.error('Telegram notification failed', { error: err.message });
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
