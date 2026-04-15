/**
 * Binance Diff Depth Stream — заменяет REST-поллинг книги ордеров.
 *
 * Протокол (по документации Binance):
 * 1. Подписаться на <symbol>@depth@100ms
 * 2. Буферизировать входящие события
 * 3. Получить REST-снапшот (/api/v3/depth?limit=5000)
 * 4. Найти первый буферизованный ивент где U <= lastUpdateId+1 <= u
 * 5. Применять все последующие события по порядку
 * 6. qty=0 → удалить уровень, иначе → обновить
 */

import WebSocket from 'ws';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { getOrderBook } from './rest.js';
import { calculateObd } from '../indicators/orderBookDepth.js';
import { processObdUpdate } from '../indicators/engine.js';
import { trackSignalOutcomes } from '../signals/tracker.js';
import { broadcast } from '../../ws/hub.js';
import { buildHeatmap } from './orderbook.js';

// Always use production stream URL for market data (same as kline WS).
// BINANCE_TESTNET only affects private trade endpoints, not public market streams.
const BINANCE_STREAM = 'wss://stream.binance.com:9443/stream';

// Per-symbol order book state
const books = new Map(); // symbol → { bids: Map<price, qty>, asks: Map<price, qty>, lastUpdateId }
const buffers = new Map(); // symbol → event[]
const synced = new Set(); // symbols that completed initial sync

let ws = null;
let reconnectTimer = null;
let stopped = false;
let activePairs = [];

function applyUpdate(book, updates, isBid) {
  const side = isBid ? book.bids : book.asks;
  for (const [price, qty] of updates) {
    if (parseFloat(qty) === 0) {
      side.delete(price);
    } else {
      side.set(price, qty);
    }
  }
}

function getSortedLevels(map, descending) {
  const entries = [...map.entries()].map(([p, q]) => [p, q]);
  entries.sort((a, b) => descending
    ? parseFloat(b[0]) - parseFloat(a[0])
    : parseFloat(a[0]) - parseFloat(b[0])
  );
  return entries;
}

async function syncBook(symbol, pair) {
  try {
    const snapshot = await getOrderBook(symbol, 5000);
    const book = {
      bids: new Map(snapshot.bids.map(([p, q]) => [p, q])),
      asks: new Map(snapshot.asks.map(([p, q]) => [p, q])),
      lastUpdateId: snapshot.lastUpdateId,
    };
    books.set(symbol, book);

    // Apply buffered events that belong after snapshot
    const buf = buffers.get(symbol) || [];
    for (const evt of buf) {
      if (evt.u <= book.lastUpdateId) continue; // outdated
      if (evt.U > book.lastUpdateId + 1) break;  // gap — need re-sync
      applyUpdate(book, evt.b, true);
      applyUpdate(book, evt.a, false);
      book.lastUpdateId = evt.u;
    }
    buffers.delete(symbol);
    synced.add(symbol);
    logger.info(`Order book synced for ${symbol}`, { lastUpdateId: book.lastUpdateId });
  } catch (err) {
    logger.error(`Order book sync failed for ${symbol}`, { error: err.message });
    // Retry sync after 3s
    setTimeout(() => syncBook(symbol, pair), 3000);
  }
}

async function processBook(symbol, pair) {
  const book = books.get(symbol);
  if (!book) return;

  const bids = getSortedLevels(book.bids, true);  // highest first
  const asks = getSortedLevels(book.asks, false); // lowest first

  if (!bids.length || !asks.length) return;

  const midPrice = (parseFloat(bids[0][0]) + parseFloat(asks[0][0])) / 2;
  const obd = calculateObd(bids, asks, midPrice);
  const heatmap = buildHeatmap(bids, asks, midPrice);

  broadcast({
    type: 'OBD_UPDATE',
    symbol,
    obd1: obd.obd1, obd2: obd.obd2, obd3: obd.obd3, obd4: obd.obd4,
    midPrice,
    heatmap,
    timestamp: Date.now(),
  });

  await processObdUpdate(pair, obd, midPrice);
  trackSignalOutcomes(symbol, midPrice).catch((err) =>
    logger.error(`Signal tracking failed for ${symbol}`, { error: err.message })
  );
}

// Throttle processBook calls per symbol (max once per 100ms)
const lastProcess = new Map();
function shouldProcess(symbol) {
  const now = Date.now();
  if (now - (lastProcess.get(symbol) || 0) < 100) return false;
  lastProcess.set(symbol, now);
  return true;
}

export async function startOrderBookWs() {
  stopped = false;
  activePairs = await prisma.tradingPair.findMany({ where: { isActive: true } });

  if (!activePairs.length) {
    logger.warn('No active pairs for order book WS');
    return;
  }

  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
  synced.clear();
  books.clear();
  buffers.clear();

  const streams = activePairs.map((p) => `${p.monitorSymbol.toLowerCase()}@depth@100ms`);
  const url = `${BINANCE_STREAM}?streams=${streams.join('/')}`;
  logger.info('Connecting to Binance Order Book WS', { symbols: activePairs.map((p) => p.monitorSymbol) });

  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Order Book WS connected — syncing snapshots');
    // Start snapshot sync for each pair
    for (const pair of activePairs) {
      buffers.set(pair.monitorSymbol, []);
      syncBook(pair.monitorSymbol, pair);
    }
  });

  ws.on('message', (raw) => {
    try {
      const wrapper = JSON.parse(raw);
      const evt = wrapper.data || wrapper;
      const symbol = (evt.s || '').toUpperCase();
      const pair = activePairs.find((p) => p.monitorSymbol === symbol);
      if (!pair) return;

      if (!synced.has(symbol)) {
        // Buffer events until snapshot sync is complete
        const buf = buffers.get(symbol);
        if (buf) buf.push(evt);
        return;
      }

      const book = books.get(symbol);
      if (!book) return;

      // Detect gap — re-sync if needed
      if (evt.U > book.lastUpdateId + 1) {
        logger.warn(`Order book gap detected for ${symbol}, re-syncing`);
        synced.delete(symbol);
        buffers.set(symbol, [evt]);
        syncBook(symbol, pair);
        return;
      }
      if (evt.u <= book.lastUpdateId) return; // already applied

      applyUpdate(book, evt.b, true);
      applyUpdate(book, evt.a, false);
      book.lastUpdateId = evt.u;

      if (shouldProcess(symbol)) {
        processBook(symbol, pair).catch((err) =>
          logger.error('processBook error', { symbol, error: err.message })
        );
      }
    } catch (err) {
      logger.error('Order Book WS message error', { error: err.message });
    }
  });

  ws.on('close', () => {
    logger.warn('Order Book WS disconnected');
    ws = null;
    if (!stopped) reconnectTimer = setTimeout(() => startOrderBookWs(), 5000);
  });

  ws.on('error', (err) => {
    logger.error('Order Book WS error', { error: err.message });
    if (ws) { ws.removeAllListeners('close'); ws.close(); ws = null; }
    if (!stopped) reconnectTimer = setTimeout(() => startOrderBookWs(), 5000);
  });
}

export function stopOrderBookWs() {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
  synced.clear();
  books.clear();
  buffers.clear();
}
