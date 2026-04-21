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
import { env } from '../../config/env.js';
import { cancelAllOpenOrders, cancelOrderByLinkId } from './rest.js';

const BYBIT_PRIVATE_WS = env.bybitTestnet
  ? 'wss://stream-testnet.bybit.com/v5/private'
  : 'wss://stream.bybit.com/v5/private';
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
  const { symbol, orderStatus, avgPrice, stopOrderType, side, orderId, orderLinkId } = order;

  if (orderStatus !== 'Filled') return;

  const filledPrice = parseFloat(avgPrice);

  // Find open trade for this symbol to determine if this is entry or exit
  const openTrade = await prisma.trade.findFirst({ where: { symbol, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });

  // Exit = opposite side of the open trade (Sell fills a BUY position, Buy fills a SELL position)
  // Also handles inline UTA TP/SL (stopOrderType TakeProfit/StopLoss)
  const isInlineTpSl = ['TakeProfit', 'StopLoss'].includes(stopOrderType);
  const isOpposingSide = openTrade && (
    (side === 'Sell' && openTrade.side === 'BUY') ||
    (side === 'Buy' && openTrade.side === 'SELL')
  );
  const isExitOrder = isInlineTpSl || isOpposingSide;

  if (!openTrade && side === 'Sell') {
    logger.warn({ symbol, orderId }, 'exit fill received but no OPEN trade found in DB — possible manual close or race condition');
  }

  if (!isExitOrder) {
    // Entry order filled — update Trade record with confirmed fill price
    const trade = await prisma.trade.findFirst({
      where: {
        OR: [{ binanceOrderId: orderId }, { binanceOrderId: orderLinkId }],
        status: 'OPEN',
      },
    });
    if (trade && filledPrice > 0 && trade.price === 0) {
      await prisma.trade.update({ where: { id: trade.id }, data: { price: filledPrice } });
      logger.info('Bybit entry fill confirmed, updated trade price', { symbol, orderId, filledPrice });
    } else if (trade) {
      logger.info('Bybit entry fill confirmed', { symbol, orderId, filledPrice, existingPrice: trade.price });
    }
    return;
  }

  // Cancel only the paired TP or SL order by orderLinkId to avoid wiping new trade's orders
  if (orderLinkId && (orderLinkId.startsWith('tp-') || orderLinkId.startsWith('sl-'))) {
    const pairedLinkId = orderLinkId.startsWith('tp-')
      ? `sl-${orderLinkId.slice(3)}`
      : `tp-${orderLinkId.slice(3)}`;
    cancelOrderByLinkId(symbol, pairedLinkId).catch(err => {
      const msg = err?.message || '';
      if (msg.includes('110001') || msg.includes('Order not found')) {
        logger.debug('Paired order already filled/cancelled', { symbol, orderLinkId: pairedLinkId });
      } else {
        logger.warn('Failed to cancel paired order', { symbol, orderLinkId: pairedLinkId, error: msg });
      }
    });
  } else {
    // Inline TP/SL (stopOrderType-based) — no custom linkId, fall back to cancel-all
    cancelAllOpenOrders(symbol).catch(() => {});
  }

  logger.info('Bybit order fill: exit', { symbol, stopOrderType, side, exitPrice: filledPrice });

  const exitPrice = filledPrice;

  // Try exact match by orderLinkId first (tp-{suffix} / sl-{suffix} → entry orderId suffix)
  let trade = null;
  if (orderLinkId && (orderLinkId.startsWith('tp-') || orderLinkId.startsWith('sl-'))) {
    const entrySuffix = orderLinkId.slice(3); // strip 'tp-' or 'sl-'
    trade = await prisma.trade.findFirst({
      where: { status: 'OPEN', binanceOrderId: { endsWith: entrySuffix } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Fallback: match by symbol (safe when only one position per symbol)
  if (!trade) {
    trade = await prisma.trade.findFirst({
      where: { symbol, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
    });
  }

  if (!trade) return;

  const pnl = (trade.side === 'BUY'
    ? ((exitPrice - trade.price) / trade.price)
    : ((trade.price - exitPrice) / trade.price)) * 100 - 0.2;
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

function normalizePortfolioOrder(o) {
  return {
    orderId: o.orderId,
    orderLinkId: o.orderLinkId,
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    stopOrderType: o.stopOrderType,
    price: parseFloat(o.price || 0),
    triggerPrice: parseFloat(o.triggerPrice || 0),
    qty: parseFloat(o.qty || 0),
    cumExecQty: parseFloat(o.cumExecQty || 0),
    avgPrice: parseFloat(o.avgPrice || 0),
    stopLoss: parseFloat(o.stopLoss || 0),
    takeProfit: parseFloat(o.takeProfit || 0),
    orderStatus: o.orderStatus,
    createdTime: parseInt(o.createdTime || 0),
    updatedTime: parseInt(o.updatedTime || 0),
  };
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

      // Auth success → subscribe to order and wallet topics
      if (msg.op === 'auth' && msg.success === true) {
        logger.info('Bybit Private WS authenticated, subscribing to order and wallet topics');
        ws.send(JSON.stringify({ op: 'subscribe', args: ['order', 'wallet'] }));
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
          // Broadcast portfolio order update to frontend
          broadcast({ type: 'PORTFOLIO_ORDER', order: normalizePortfolioOrder(order) });
          handleOrderFill(order).catch((err) =>
            logger.error('Bybit order fill handler error', { error: err.message })
          );
        }
      }

      // Wallet balance updates
      if (msg.topic === 'wallet' && Array.isArray(msg.data)) {
        for (const account of msg.data) {
          const coins = (account.coin || [])
            .filter(c => parseFloat(c.walletBalance) > 0)
            .map(c => ({
              asset: c.coin,
              free: parseFloat(c.availableToWithdraw || c.free || 0),
              locked: parseFloat(c.locked || 0),
              total: parseFloat(c.walletBalance),
              usdValue: parseFloat(c.usdValue || 0),
            }));
          broadcast({ type: 'PORTFOLIO_BALANCE', coins });
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
