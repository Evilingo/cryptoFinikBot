import { getOrderBook } from './rest.js';
import { calculateObd } from '../indicators/orderBookDepth.js';
import { processObdUpdate } from '../indicators/engine.js';
import { trackSignalOutcomes } from '../signals/tracker.js';
import { broadcast } from '../../ws/hub.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';

const POLL_INTERVAL = 5000;
let pollTimer = null;

export async function pollOrderBooks() {
  const pairs = await prisma.tradingPair.findMany({ where: { isActive: true } });

  for (const pair of pairs) {
    try {
      const book = await getOrderBook(pair.monitorSymbol);

      const midPrice =
        (parseFloat(book.bids[0][0]) + parseFloat(book.asks[0][0])) / 2;

      const obd = calculateObd(book.bids, book.asks, midPrice);

      // Heatmap: группируем ордера по ценовым уровням (0.1% шаг, до 5% от mid)
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

      processObdUpdate(pair, obd, midPrice);

      // Трекинг результатов сигналов
      trackSignalOutcomes(pair.monitorSymbol, midPrice).catch((err) => {
        logger.error(`Signal tracking failed for ${pair.monitorSymbol}`, { error: err.message });
      });
    } catch (err) {
      logger.error(`Order book poll failed for ${pair.monitorSymbol}`, {
        error: err.message,
      });
    }
  }
}

/**
 * Группирует ордера стакана в ценовые бакеты для heatmap.
 * Шаг = 0.1% от midPrice, диапазон ±5%.
 * Возвращает массив { price, bidVol, askVol, total, intensity }.
 */
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

  // Fill bid volumes
  for (const [priceStr, qtyStr] of bids) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (price < midPrice * (1 - rangePct / 100)) break;
    const idx = Math.round((price - (midPrice - steps * bucketSize)) / bucketSize);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].bidVol += qty;
    }
  }

  // Fill ask volumes
  for (const [priceStr, qtyStr] of asks) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (price > midPrice * (1 + rangePct / 100)) break;
    const idx = Math.round((price - (midPrice - steps * bucketSize)) / bucketSize);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].askVol += qty;
    }
  }

  // Calculate intensity (0-1 normalized)
  const maxVol = Math.max(...buckets.map((b) => b.bidVol + b.askVol), 1);
  return buckets.map((b) => ({
    ...b,
    total: Math.round((b.bidVol + b.askVol) * 1000) / 1000,
    intensity: Math.round(((b.bidVol + b.askVol) / maxVol) * 100) / 100,
  }));
}

export function startOrderBookPolling() {
  logger.info('Starting Order Book polling (5s interval)');
  pollOrderBooks();
  pollTimer = setInterval(pollOrderBooks, POLL_INTERVAL);
}

export function stopOrderBookPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
