import WebSocket from 'ws';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { createListenKey, keepAliveListenKey, deleteListenKey } from './rest.js';
import { sendTelegramNotification } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';

const WS_BASE = process.env.BINANCE_TESTNET === 'true'
  ? 'wss://testnet.binance.vision/ws'
  : 'wss://stream.binance.com:9443/ws';

// Note: Binance testnet has limited WebSocket support and may return 410 for userDataStream.
// In that case startUserDataStream() exits silently — trade tracking via tracker.js still works.

const KEEPALIVE_INTERVAL = 20 * 60 * 1000; // 20 min (Binance invalidates after 60 min without ping)

let ws = null;
let listenKey = null;
let keepAliveTimer = null;
let reconnectTimer = null;
let stopped = false;

async function handleExecutionReport(report) {
  // Only process filled exit orders (TP = LIMIT, SL = STOP_LOSS_LIMIT)
  if (report.X !== 'FILLED') return;
  if (!['LIMIT', 'STOP_LOSS_LIMIT'].includes(report.o)) return;

  const symbol = report.s;
  const exitPrice = parseFloat(report.L); // last executed price

  logger.info('User Data Stream: exit order filled', { symbol, orderType: report.o, exitPrice });

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

function connect() {
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }

  const url = `${WS_BASE}/${listenKey}`;
  logger.info('Connecting to Binance User Data Stream');
  ws = new WebSocket(url);

  ws.on('open', () => logger.info('User Data Stream connected'));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.e === 'executionReport') {
        handleExecutionReport(data).catch((err) =>
          logger.error('executionReport handler error', { error: err.message })
        );
      }
    } catch (err) {
      logger.error('User Data Stream parse error', { error: err.message });
    }
  });

  ws.on('close', () => {
    logger.warn('User Data Stream disconnected');
    ws = null;
    if (!stopped) reconnectTimer = setTimeout(() => startUserDataStream(), 10_000);
  });

  ws.on('error', (err) => {
    logger.error('User Data Stream error', { error: err.message });
    if (ws) { ws.removeAllListeners('close'); ws.close(); ws = null; }
    if (!stopped) reconnectTimer = setTimeout(() => startUserDataStream(), 10_000);
  });
}

export async function startUserDataStream() {
  stopped = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  try {
    if (listenKey) await deleteListenKey(listenKey).catch(() => {});
    listenKey = await createListenKey();
    logger.info('User Data Stream listenKey created');
  } catch (err) {
    logger.warn('User Data Stream skipped: Binance API keys not configured', { error: err.message });
    return;
  }

  connect();

  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(async () => {
    try {
      await keepAliveListenKey(listenKey);
      logger.debug('User Data Stream listenKey refreshed');
    } catch (err) {
      logger.error('User Data Stream keepalive failed, reconnecting', { error: err.message });
      await startUserDataStream();
    }
  }, KEEPALIVE_INTERVAL);
}

export function stopUserDataStream() {
  stopped = true;
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null; }
  if (listenKey) { deleteListenKey(listenKey).catch(() => {}); listenKey = null; }
}
