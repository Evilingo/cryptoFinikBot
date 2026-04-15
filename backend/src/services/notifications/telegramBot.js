import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { getSignalStats } from '../signals/tracker.js';

async function sendBotMessage(token, chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    logger.warn('Bot reply failed', { status: res.status, description: data.description });
  }
}

async function answerCallbackQuery(token, callbackQueryId) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function handlePositions(token, chatId) {
  const trades = await prisma.trade.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });

  if (trades.length === 0) {
    return sendBotMessage(token, chatId, '📭 Нет открытых сделок');
  }

  const lines = trades.map((t) => {
    const sl = t.stopLoss ? `SL: ${t.stopLoss}` : '';
    const tp = t.takeProfit ? `TP: ${t.takeProfit}` : '';
    const sltp = [sl, tp].filter(Boolean).join(' | ');
    return `${t.side === 'BUY' ? '🟢' : '🔴'} <b>${t.side} ${t.symbol}</b>\nЦена входа: ${t.price}\n${sltp || 'SL/TP не установлены'}\n#${t.id}`;
  });

  await sendBotMessage(token, chatId, `<b>Открытые сделки (${trades.length})</b>\n\n${lines.join('\n\n')}`);
}

async function handleStats(token, chatId, period = 'week') {
  const now = new Date();
  let since;
  let label;

  if (period === 'day') {
    since = new Date(now - 24 * 60 * 60 * 1000);
    label = 'за 24 часа';
  } else if (period === 'week') {
    since = new Date(now - 7 * 24 * 60 * 60 * 1000);
    label = 'за 7 дней';
  } else {
    since = new Date(now - 30 * 24 * 60 * 60 * 1000);
    label = 'за 30 дней';
  }

  const stats = await getSignalStats(null, since);

  if (stats.total === 0) {
    const keyboard = buildStatsKeyboard(period);
    return sendBotMessage(token, chatId, `📊 Статистика ${label}\n\nНет завершённых сигналов за этот период`, keyboard);
  }

  const pnlSign = stats.totalPnl >= 0 ? '+' : '';
  const text = [
    `📊 <b>Статистика ${label}</b>`,
    '',
    `Сигналов: ${stats.total}`,
    `✅ WIN: ${stats.wins}  ❌ LOSS: ${stats.losses}  ➡️ BREAKEVEN: ${stats.breakeven}`,
    `Winrate: <b>${stats.winRate}%</b>`,
    `Avg P&L: ${pnlSign}${stats.avgPnl}%`,
    `Total P&L: ${pnlSign}${stats.totalPnl}%`,
  ].join('\n');

  const keyboard = buildStatsKeyboard(period);
  await sendBotMessage(token, chatId, text, keyboard);
}

function buildStatsKeyboard(activePeriod) {
  const periods = [
    { label: activePeriod === 'day' ? '• День •' : 'День', data: 'stats:day' },
    { label: activePeriod === 'week' ? '• Неделя •' : 'Неделя', data: 'stats:week' },
    { label: activePeriod === 'month' ? '• Месяц •' : 'Месяц', data: 'stats:month' },
  ];
  return { inline_keyboard: [periods.map((p) => ({ text: p.label, callback_data: p.data }))] };
}

export async function handleTelegramUpdate(update) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.telegramToken) return;
  const { telegramToken: token } = settings;

  // Callback query (inline button taps)
  if (update.callback_query) {
    const { id, data, message } = update.callback_query;
    await answerCallbackQuery(token, id);
    if (data?.startsWith('stats:')) {
      const period = data.split(':')[1];
      await handleStats(token, message.chat.id, period);
    }
    return;
  }

  // Text commands
  const msg = update.message;
  if (!msg?.text) return;

  const channelChatId = settings.telegramChatId; // always reply to the configured channel
  const text = msg.text.split('@')[0].trim(); // strip @botname suffix

  if (text === '/start' || text === '/help') {
    await sendBotMessage(token, channelChatId,
      '👋 <b>BestTrader Bot</b>\n\n/positions — открытые сделки\n/stats — статистика сигналов'
    );
  } else if (text === '/positions') {
    await handlePositions(token, channelChatId);
  } else if (text === '/stats') {
    await handleStats(token, channelChatId, 'week');
  }
}

export async function setupTelegramWebhook(baseUrl) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.telegramToken) {
    logger.info('Telegram webhook skipped: no token in DB');
    return;
  }

  const webhookUrl = `${baseUrl}/telegram/webhook`;
  const url = `https://api.telegram.org/bot${settings.telegramToken}/setWebhook`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'] }),
    });
    const data = await res.json();
    if (data.ok) {
      logger.info('Telegram webhook registered', { url: webhookUrl });
    } else {
      logger.warn('Telegram webhook registration failed', { description: data.description });
    }
  } catch (err) {
    logger.warn('Telegram webhook setup error', { error: err.message });
  }
}
