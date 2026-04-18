/**
 * Binance aggTrade WebSocket — feeds real executed trades into OFI engine.
 * Subscribes to <symbol>@aggTrade for all active pairs.
 * aggTrade.m (isBuyerMaker): true = seller aggressed, false = buyer aggressed.
 */

import WebSocket from 'ws';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { processAggTrade } from '../indicators/ofiEngine.js';

let ws = null;
let activePairs = [];
let reconnectTimer = null;

export function startAggTradeWs() {
  prisma.tradingPair.findMany({ where: { isActive: true } })
    .then((pairs) => {
      activePairs = pairs;
      connect();
    })
    .catch((err) => logger.error('aggTradeWs: failed to load pairs', { error: err.message }));
}

function connect() {
  const streams = activePairs
    .map((p) => `${p.monitorSymbol.toLowerCase()}@aggTrade`)
    .join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  ws = new WebSocket(url);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!msg.data || msg.data.e !== 'aggTrade') return;
      const d = msg.data;
      const pair = activePairs.find((p) => p.monitorSymbol === d.s);
      if (!pair) return;
      processAggTrade(pair, { isBuyerMaker: d.m, price: d.p, qty: d.q }).catch(() => {});
    } catch {}
  });

  ws.on('close', () => {
    logger.warn('Binance aggTrade WS closed, reconnecting in 3s');
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    logger.error('Binance aggTrade WS error', { error: err.message });
    ws.close();
  });
}

export function stopAggTradeWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    ws.removeAllListeners('close');
    ws.close();
    ws = null;
  }
}
