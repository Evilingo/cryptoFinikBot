/**
 * Bybit V5 Order Book WebSocket — replaces Binance diff-depth stream.
 *
 * Protocol:
 * - Subscribe to orderbook.200.<SYMBOL> for each active pair
 * - type: 'snapshot' → initialize book directly (no REST fetch needed)
 * - type: 'delta'    → apply incremental updates (qty='0' → delete level)
 * - Gap detection via data.seq — reconnect on gap
 * - Ping every 20s
 */

import WebSocket from 'ws';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { calculateObd } from '../indicators/orderBookDepth.js';
import { processObdUpdate } from '../indicators/engine.js';
import { trackSignalOutcomes } from '../signals/tracker.js';
import { broadcast } from '../../ws/hub.js';
import { buildHeatmap } from '../binance/orderbook.js';
import { env } from '../../config/env.js';

const BYBIT_STREAM = env.bybitTestnet
  ? 'wss://stream-testnet.bybit.com/v5/public/spot'
  : 'wss://stream.bybit.com/v5/public/spot';
const PING_INTERVAL = 20_000;

// Bybit spot max OB depth is 200 levels
export const BYBIT_OBD_LEVELS = [
  { name: 'obd1', levels: 25 },
  { name: 'obd2', levels: 50 },
  { name: 'obd3', levels: 100 },
  { name: 'obd4', levels: 200 },
];

// Per-symbol order book state
const books = new Map();   // symbol → { bids: Map<price, qty>, asks: Map<price, qty> }
const lastSeq = new Map(); // symbol → last seq number
const synced = new Set();  // symbols with initialized snapshot

let ws = null;
let reconnectTimer = null;
let pingTimer = null;
let stopped = false;
let activePairs = [];

function clearTimers() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function applyLevels(side, updates) {
  for (const [price, qty] of updates) {
    if (parseFloat(qty) === 0) {
      side.delete(price);
    } else {
      side.set(price, qty);
    }
  }
}

function getSortedLevels(map, descending) {
  const entries = [...map.entries()];
  entries.sort((a, b) => descending
    ? parseFloat(b[0]) - parseFloat(a[0])
    : parseFloat(a[0]) - parseFloat(b[0])
  );
  return entries;
}

// Throttle processBook calls per symbol (max once per 100ms)
const lastProcess = new Map();
function shouldProcess(symbol) {
  const now = Date.now();
  if (now - (lastProcess.get(symbol) || 0) < 100) return false;
  lastProcess.set(symbol, now);
  return true;
}

async function processBook(symbol, pair) {
  const book = books.get(symbol);
  if (!book) return;

  const bids = getSortedLevels(book.bids, true);  // highest first
  const asks = getSortedLevels(book.asks, false); // lowest first

  if (!bids.length || !asks.length) return;

  const midPrice = (parseFloat(bids[0][0]) + parseFloat(asks[0][0])) / 2;
  const obd = calculateObd(bids, asks, midPrice, BYBIT_OBD_LEVELS);
  const heatmap = buildHeatmap(bids, asks, midPrice);

  broadcast({
    type: 'OBD_UPDATE',
    symbol,
    obd1: obd.obd1,
    obd2: obd.obd2,
    obd3: obd.obd3,
    obd4: obd.obd4,
    midPrice,
    heatmap,
    timestamp: Date.now(),
  });

  await processObdUpdate(pair, obd, midPrice);
  trackSignalOutcomes(symbol, midPrice).catch((err) =>
    logger.error(`Signal tracking failed for ${symbol}`, { error: err.message })
  );
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    logger.error('Bybit OB WS parse error', { error: err.message });
    return;
  }

  // Ignore pong / subscription acks
  if (msg.op === 'pong' || msg.op === 'subscribe') return;
  if (!msg.topic || !msg.data) return;

  // topic: orderbook.200.BTCUSDT
  const parts = msg.topic.split('.');
  if (parts[0] !== 'orderbook') return;

  const symbol = parts[2];
  const pair = activePairs.find((p) => p.monitorSymbol === symbol);
  if (!pair) return;

  const { b: bids, a: asks, seq } = msg.data;
  const msgType = msg.type; // 'snapshot' or 'delta'

  if (msgType === 'snapshot') {
    // Initialize book directly from snapshot
    books.set(symbol, {
      bids: new Map(bids.map(([p, q]) => [p, q])),
      asks: new Map(asks.map(([p, q]) => [p, q])),
    });
    lastSeq.set(symbol, seq);
    synced.add(symbol);
    logger.info(`Bybit OB snapshot received for ${symbol}`, { seq });

    if (shouldProcess(symbol)) {
      processBook(symbol, pair).catch((err) =>
        logger.error('processBook error', { symbol, error: err.message })
      );
    }
    return;
  }

  if (msgType === 'delta') {
    if (!synced.has(symbol)) return;

    // Gap detection
    const prevSeq = lastSeq.get(symbol);
    if (prevSeq !== undefined && seq !== prevSeq + 1) {
      logger.warn(`Bybit OB sequence gap for ${symbol}: expected ${prevSeq + 1}, got ${seq}. Reconnecting.`);
      synced.delete(symbol);
      // Trigger full reconnect
      if (ws) {
        ws.removeAllListeners('close');
        ws.close();
        ws = null;
      }
      clearTimers();
      if (!stopped) {
        reconnectTimer = setTimeout(() => startBybitOrderBookWs(), 5000);
      }
      return;
    }

    const book = books.get(symbol);
    if (!book) return;

    applyLevels(book.bids, bids || []);
    applyLevels(book.asks, asks || []);
    lastSeq.set(symbol, seq);

    if (shouldProcess(symbol)) {
      processBook(symbol, pair).catch((err) =>
        logger.error('processBook error', { symbol, error: err.message })
      );
    }
  }
}

export async function startBybitOrderBookWs() {
  stopped = false;
  activePairs = await prisma.tradingPair.findMany({ where: { isActive: true } });

  if (!activePairs.length) {
    logger.warn('No active pairs for Bybit Order Book WS');
    return;
  }

  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
  clearTimers();
  synced.clear();
  books.clear();
  lastSeq.clear();

  const args = activePairs.map((p) => `orderbook.200.${p.monitorSymbol}`);
  logger.info('Connecting to Bybit Order Book WS', { symbols: activePairs.map((p) => p.monitorSymbol) });

  ws = new WebSocket(BYBIT_STREAM);

  ws.on('open', () => {
    logger.info('Bybit Order Book WS connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    ws.send(JSON.stringify({ op: 'subscribe', args }));

    // Ping every 20s
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, PING_INTERVAL);
  });

  ws.on('message', (raw) => {
    try {
      handleMessage(raw);
    } catch (err) {
      logger.error('Bybit OB WS message handler error', { error: err.message });
    }
  });

  ws.on('close', () => {
    logger.warn('Bybit Order Book WS disconnected');
    clearTimers();
    ws = null;
    if (!stopped) {
      logger.info('Bybit OB WS reconnecting in 5s...');
      reconnectTimer = setTimeout(() => startBybitOrderBookWs(), 5000);
    }
  });

  ws.on('error', (err) => {
    logger.error('Bybit Order Book WS error', { error: err.message });
    if (ws) { ws.removeAllListeners('close'); ws.close(); ws = null; }
    clearTimers();
    if (!stopped) {
      reconnectTimer = setTimeout(() => startBybitOrderBookWs(), 5000);
    }
  });
}

export function stopBybitOrderBookWs() {
  stopped = true;
  clearTimers();
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
  synced.clear();
  books.clear();
  lastSeq.clear();
}
