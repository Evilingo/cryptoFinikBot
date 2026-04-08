import { getOrderBook } from './rest.js';
import { calculateObd } from '../indicators/orderBookDepth.js';
import { processObdUpdate } from '../indicators/engine.js';
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

      broadcast({
        type: 'OBD_UPDATE',
        symbol: pair.monitorSymbol,
        obd1: obd.obd1,
        obd2: obd.obd2,
        obd3: obd.obd3,
        obd4: obd.obd4,
        midPrice,
        timestamp: Date.now(),
      });

      processObdUpdate(pair, obd, midPrice);
    } catch (err) {
      logger.error(`Order book poll failed for ${pair.monitorSymbol}`, {
        error: err.message,
      });
    }
  }
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
