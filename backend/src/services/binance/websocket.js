import WebSocket from 'ws';
import { broadcast } from '../../ws/hub.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';

const BINANCE_STREAM = 'wss://stream.binance.com:9443';
let ws = null;
let reconnectTimer = null;
let stopped = false;

export async function startBinanceWs() {
  stopped = false;

  // Close existing connection if any
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }

  const pairs = await prisma.tradingPair.findMany({ where: { isActive: true } });
  const streams = pairs.map(
    (p) => `${p.monitorSymbol.toLowerCase()}@kline_${p.timeframe}`,
  );

  if (streams.length === 0) {
    logger.warn('No active pairs for Binance WS');
    return;
  }

  // Combined streams format: /stream?streams=stream1/stream2/...
  const url = `${BINANCE_STREAM}/stream?streams=${streams.join('/')}`;
  logger.info('Connecting to Binance WS', { streams });

  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Binance WS connected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on('message', (raw) => {
    try {
      const wrapper = JSON.parse(raw);
      // Combined stream format: { stream: "btcusdc@kline_1m", data: { ... } }
      const data = wrapper.data || wrapper;
      if (data.e === 'kline') {
        const k = data.k;
        broadcast({
          type: 'KLINE',
          symbol: k.s,
          kline: {
            t: k.t, T: k.T, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, x: k.x,
          },
        });
      }
    } catch (err) {
      logger.error('Binance WS parse error', { error: err.message });
    }
  });

  ws.on('close', () => {
    logger.warn('Binance WS disconnected');
    ws = null;
    if (!stopped) {
      logger.info('Reconnecting in 5s...');
      reconnectTimer = setTimeout(startBinanceWs, 5000);
    }
  });

  ws.on('error', (err) => {
    logger.error('Binance WS error', { error: err.message });
    if (ws) {
      ws.removeAllListeners('close');
      ws.close();
      ws = null;
    }
    if (!stopped) {
      reconnectTimer = setTimeout(startBinanceWs, 5000);
    }
  });
}

export function stopBinanceWs() {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }
}
