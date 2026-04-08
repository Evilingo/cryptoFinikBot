import WebSocket from 'ws';
import { broadcast } from '../../ws/hub.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';

const BINANCE_WS = 'wss://stream.binance.com:9443/ws';
let ws = null;
let reconnectTimer = null;

export async function startBinanceWs() {
  const pairs = await prisma.tradingPair.findMany({ where: { isActive: true } });
  const streams = pairs.map(
    (p) => `${p.monitorSymbol.toLowerCase()}@kline_${p.timeframe}`,
  );

  if (streams.length === 0) {
    logger.warn('No active pairs for Binance WS');
    return;
  }

  const url = `${BINANCE_WS}/${streams.join('/')}`;
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
      const data = JSON.parse(raw);
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
    logger.warn('Binance WS disconnected, reconnecting in 5s...');
    reconnectTimer = setTimeout(startBinanceWs, 5000);
  });

  ws.on('error', (err) => {
    logger.error('Binance WS error', { error: err.message });
    ws.close();
  });
}

export function stopBinanceWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}
