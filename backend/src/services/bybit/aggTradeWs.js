/**
 * Bybit publicTrade WebSocket — feeds real executed trades into OFI engine.
 * Subscribes to publicTrade.<symbol> for all active pairs.
 * trade.S: 'Buy' = buyer aggressed (isBuyerMaker=false), 'Sell' = seller aggressed (isBuyerMaker=true).
 */

import WebSocket from 'ws';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { processAggTrade } from '../indicators/ofiEngine.js';
import { env } from '../../config/env.js';

let ws = null;
let reconnectTimer = null;

export function startBybitAggTradeWs() {
  prisma.tradingPair.findMany({ where: { isActive: true } })
    .then((pairs) => connect(pairs))
    .catch((err) => logger.error('bybitAggTradeWs: failed to load pairs', { error: err.message }));
}

function connect(pairs) {
  const baseUrl = env.bybitTestnet
    ? 'wss://stream-testnet.bybit.com/v5/public/spot'
    : 'wss://stream.bybit.com/v5/public/spot';

  ws = new WebSocket(baseUrl);

  ws.on('open', () => {
    const args = pairs.map((p) => `publicTrade.${p.monitorSymbol}`);
    ws.send(JSON.stringify({ op: 'subscribe', args }));
    logger.info('Bybit aggTrade WS subscribed', { symbols: pairs.map((p) => p.monitorSymbol) });
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!msg.topic?.startsWith('publicTrade.') || !Array.isArray(msg.data)) return;
      const symbol = msg.topic.replace('publicTrade.', '');
      const pair = pairs.find((p) => p.monitorSymbol === symbol);
      if (!pair) return;
      for (const trade of msg.data) {
        processAggTrade(pair, {
          isBuyerMaker: trade.S === 'Sell',
          price: trade.p,
          qty: trade.v,
        }).catch(() => {});
      }
    } catch {}
  });

  ws.on('close', () => {
    logger.warn('Bybit aggTrade WS closed, reconnecting in 3s');
    reconnectTimer = setTimeout(() => connect(pairs), 3000);
  });

  ws.on('error', (err) => {
    logger.error('Bybit aggTrade WS error', { error: err.message });
    ws.close();
  });
}

export function stopBybitAggTradeWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    ws.removeAllListeners('close');
    ws.close();
    ws = null;
  }
}
