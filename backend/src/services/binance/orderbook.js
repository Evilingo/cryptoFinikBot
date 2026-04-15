import { getOrderBook } from './rest.js';
import { calculateObd } from '../indicators/orderBookDepth.js';
import { processObdUpdate } from '../indicators/engine.js';
import { trackSignalOutcomes } from '../signals/tracker.js';
import { broadcast } from '../../ws/hub.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';

const BASE_POLL_INTERVAL = 5000;
let running = false;
let currentInterval = BASE_POLL_INTERVAL;
let consecutiveErrors = 0;

async function pollOrderBooks() {
  const pairs = await prisma.tradingPair.findMany({ where: { isActive: true } });

  for (const pair of pairs) {
    try {
      const book = await getOrderBook(pair.monitorSymbol, 5000);

      if (!book.bids?.length || !book.asks?.length) {
        logger.warn(`Empty order book for ${pair.monitorSymbol}`);
        continue;
      }

      const midPrice =
        (parseFloat(book.bids[0][0]) + parseFloat(book.asks[0][0])) / 2;

      const obd = calculateObd(book.bids, book.asks, midPrice);
      const heatmap = buildHeatmap(book.bids, book.asks, midPrice);

      broadcast({
        type: 'OBD_UPDATE',
        symbol: pair.monitorSymbol,
        obd1: obd.obd1,
        obd2: obd.obd2,
        obd3: obd.obd3,
        obd4: obd.obd4,
        midPrice,
        heatmap,
        timestamp: Date.now(),
      });

      await processObdUpdate(pair, obd, midPrice);

      trackSignalOutcomes(pair.monitorSymbol, midPrice).catch((err) => {
        logger.error(`Signal tracking failed for ${pair.monitorSymbol}`, { error: err.message });
      });
      consecutiveErrors = 0;
      currentInterval = BASE_POLL_INTERVAL;
    } catch (err) {
      consecutiveErrors++;
      logger.error(`Order book poll failed for ${pair.monitorSymbol}`, {
        error: err.message,
        consecutiveErrors,
      });

      // Backoff on 418 (IP ban), 429 (rate limit), or too many consecutive errors
      if (err.message?.includes('418') || err.message?.includes('429') || consecutiveErrors > 10) {
        currentInterval = Math.min(BASE_POLL_INTERVAL * Math.pow(2, Math.min(consecutiveErrors, 8)), 300_000);
        logger.warn(`Binance rate limited (${err.message}), backing off to ${currentInterval / 1000}s`);
        break; // Skip remaining pairs this cycle
      }
    }
  }
}

function buildHeatmap(bids, asks, midPrice) {
  const stepPct = 0.1;
  const rangePct = 5;
  const steps = Math.floor(rangePct / stepPct);
  const bucketSize = midPrice * stepPct / 100;

  const buckets = [];

  for (let i = -steps; i <= steps; i++) {
    const priceLevel = midPrice + i * bucketSize;
    buckets.push({ price: Math.round(priceLevel * 100) / 100, bidVol: 0, askVol: 0 });
  }

  for (const [priceStr, qtyStr] of bids) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (price < midPrice * (1 - rangePct / 100)) break;
    const idx = Math.round((price - (midPrice - steps * bucketSize)) / bucketSize);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].bidVol += qty;
    }
  }

  for (const [priceStr, qtyStr] of asks) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (price > midPrice * (1 + rangePct / 100)) break;
    const idx = Math.round((price - (midPrice - steps * bucketSize)) / bucketSize);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].askVol += qty;
    }
  }

  const maxVol = Math.max(...buckets.map((b) => b.bidVol + b.askVol), 1);
  return buckets.map((b) => ({
    ...b,
    total: Math.round((b.bidVol + b.askVol) * 1000) / 1000,
    intensity: Math.round(((b.bidVol + b.askVol) / maxVol) * 100) / 100,
  }));
}

// Sequential polling loop — prevents overlapping invocations
async function pollLoop() {
  while (running) {
    await pollOrderBooks();
    await new Promise((r) => setTimeout(r, currentInterval));
  }
}

export function startOrderBookPolling() {
  logger.info('Starting Order Book polling (5s interval)');
  running = true;
  pollLoop();
}

export function stopOrderBookPolling() {
  running = false;
}
