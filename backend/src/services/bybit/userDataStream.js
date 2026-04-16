/**
 * Bybit V5 Private WebSocket — listens for order fill events.
 * Replaces Binance User Data Stream (listenKey-based) with Bybit's
 * HMAC auth on open + subscribe to 'order' topic.
 */

import crypto from 'node:crypto';
import WebSocket from 'ws';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { decrypt } from '../../config/crypto.js';
import { sendTelegramNotification } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';

const BYBIT_PRIVATE_WS = 'wss://stream.bybit.com/v5/private';
const PING_INTERVAL = 20_000;

let ws = null;
let reconnectTimer = null;
let pingTimer = null;
let stopped = false;

function clearTimers() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

async function getKeys() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.bybitApiKey || !settings?.bybitSecret) {
    throw new Error('Bybit API keys not configured');
  }
  return {
    apiKey: decrypt(settings.bybitApiKey),
    secret: decrypt(settings.bybitSecret),
  };
}

async function handleOrderFill(order) {
  const { symbol, orderStatus, avgPrice, stopOrderType, side } = order;

  // Only process TP/SL fills that close positions
  if (orderStatus !== 'Filled') return;
  if (!['TakeProfit', 'StopLoss'].includes(stopOrderType)) return;

  const exitPrice = parseFloat(avgPrice);
  logger.info('Bybit order fill: TP/SL exit', { symbol, stopOrderType, exitPrice });

  const trade = await prisma.trade.findFirst({
    where: { symbol, status: 'OPEN' },
  });
  if (!trade) return;

  const pnl = trade.side === 'BUY'
    ? ((exitPrice - trade.price) / trade.price) * 100
    : ((trade.price - exitPrice) / trade.price) * 100;
  const roundedPnl = Math.round(pnl * 100) / 100;
  const outcome = roundedPnl > 0.1 ? 'WIN' : roundedPnl < -0.1 ? 'LOSS' : 'BREAKEVEN';

  await prisma.trade.update({
    where: { id: trade.id },
    data: { status: 'CLOSED', pnl: roundedPnl, closedAt: new Date() },
  });

  if (trade.signalId) {
    // Use updateMany with outcome: null guard to prevent race condition with tracker.js
    await prisma.signal.updateMany({
      where: { id: trade.signalId, outcome: null },
      data: {
        outcome,
        outcomePnl: roundedPnl,
        outcomePrice: exitPrice,
        outcomeAt: new Date(),
      },
    });
    broadcast({
      type: 'SIGNAL_OUTCOME',
      signalId: trade.signalId,
      symbol,
      outcome,
      pnl: roundedPnl,
      outcomePrice: exitPrice,
    });
  }

  const emoji = outcome === 'WIN' ? '✅' : outcome === 'LOSS' ? '❌' : '➡️';
  const sign = roundedPnl >= 0 ? '+' : '';
  sendTelegramNotification(
    `${emoji} <b>Сделка закрыта</b>\n${trade.side} ${symbol}\nВход: ${trade.price} → Выход: ${exitPrice}\nP&amp;L: <b>${sign}${roundedPnl}%</b> (${outcome})`,
    null,
  ).catch(() => {});
}

function connect(apiKey, secret) {
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
  clearTimers();

  logger.info('Connecting to Bybit Private WS');
  ws = new WebSocket(BYBIT_PRIVATE_WS);

  ws.on('open', () => {
    logger.info('Bybit Private WS connected, authenticating...');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    // Auth: sign 'GET/realtime' + expires
    const expires = Date.now() + 1000;
    const signature = crypto
      .createHmac('sha256', secret)
      .update('GET/realtime' + expires)
      .digest('hex');

    ws.send(JSON.stringify({ op: 'auth', args: [apiKey, expires, signature] }));

    // Ping every 20s
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, PING_INTERVAL);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Auth success → subscribe to order topic
      if (msg.op === 'auth' && msg.success === true) {
        logger.info('Bybit Private WS authenticated, subscribing to order topic');
        ws.send(JSON.stringify({ op: 'subscribe', args: ['order'] }));
        return;
      }

      if (msg.op === 'auth' && msg.success === false) {
        logger.error('Bybit Private WS auth failed', { retMsg: msg.retMsg });
        return;
      }

      // Ignore pong / sub acks
      if (msg.op === 'pong' || msg.op === 'subscribe') return;

      // Order fill events
      if (msg.topic === 'order' && Array.isArray(msg.data)) {
        for (const order of msg.data) {
          handleOrderFill(order).catch((err) =>
            logger.error('Bybit order fill handler error', { error: err.message })
          );
        }
      }
    } catch (err) {
      logger.error('Bybit Private WS parse error', { error: err.message });
    }
  });

  ws.on('close', () => {
    logger.warn('Bybit Private WS disconnected');
    clearTimers();
    ws = null;
    if (!stopped) {
      reconnectTimer = setTimeout(() => startBybitUserDataStream(), 10_000);
    }
  });

  ws.on('error', (err) => {
    logger.error('Bybit Private WS error', { error: err.message });
    if (ws) { ws.removeAllListeners('close'); ws.close(); ws = null; }
    clearTimers();
    if (!stopped) {
      reconnectTimer = setTimeout(() => startBybitUserDataStream(), 10_000);
    }
  });
}

export async function startBybitUserDataStream() {
  stopped = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  let apiKey, secret;
  try {
    ({ apiKey, secret } = await getKeys());
  } catch (err) {
    logger.warn('Bybit User Data Stream skipped: keys not configured', { error: err.message });
    return;
  }

  connect(apiKey, secret);
}

export function stopBybitUserDataStream() {
  stopped = true;
  clearTimers();
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
}
