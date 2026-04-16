import WebSocket from 'ws';
import { broadcast } from '../../ws/hub.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';

const BYBIT_STREAM = 'wss://stream.bybit.com/v5/public/spot';
const PING_INTERVAL = 20_000;

const INTERVAL_MAP = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
};

let ws = null;
let reconnectTimer = null;
let pingTimer = null;
let stopped = false;

function clearTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

export async function startBybitWs() {
  stopped = false;

  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }
  clearTimers();

  const pairs = await prisma.tradingPair.findMany({ where: { isActive: true } });
  if (pairs.length === 0) {
    logger.warn('No active pairs for Bybit Kline WS');
    return;
  }

  // Build subscription args: kline.<interval>.<symbol>
  const args = pairs.map((p) => {
    const bybitInterval = INTERVAL_MAP[p.timeframe] || '1';
    return `kline.${bybitInterval}.${p.monitorSymbol}`;
  });

  logger.info('Connecting to Bybit Kline WS', { args });
  ws = new WebSocket(BYBIT_STREAM);

  ws.on('open', () => {
    logger.info('Bybit Kline WS connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    ws.send(JSON.stringify({ op: 'subscribe', args }));

    // Ping every 20s to keep connection alive
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, PING_INTERVAL);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Ignore pong / subscription responses
      if (msg.op === 'pong' || msg.op === 'subscribe') return;
      if (!msg.topic || !msg.data) return;

      // topic format: kline.1.BTCUSDT
      const parts = msg.topic.split('.');
      if (parts[0] !== 'kline') return;

      const symbol = parts[2];
      const klineArr = msg.data;
      if (!Array.isArray(klineArr) || klineArr.length === 0) return;

      for (const k of klineArr) {
        broadcast({
          type: 'KLINE',
          symbol,
          kline: {
            t: k.start,
            T: k.end,
            o: k.open,
            h: k.high,
            l: k.low,
            c: k.close,
            v: k.volume,
            x: k.confirm, // true = candle closed (same as Binance k.x)
          },
        });
      }
    } catch (err) {
      logger.error('Bybit Kline WS parse error', { error: err.message });
    }
  });

  ws.on('close', () => {
    logger.warn('Bybit Kline WS disconnected');
    clearTimers();
    ws = null;
    if (!stopped) {
      logger.info('Bybit Kline WS reconnecting in 5s...');
      reconnectTimer = setTimeout(() => startBybitWs(), 5000);
    }
  });

  ws.on('error', (err) => {
    logger.error('Bybit Kline WS error', { error: err.message });
    if (ws) { ws.removeAllListeners('close'); ws.close(); ws = null; }
    clearTimers();
    if (!stopped) {
      reconnectTimer = setTimeout(() => startBybitWs(), 5000);
    }
  });
}

export function stopBybitWs() {
  stopped = true;
  clearTimers();
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }
}
