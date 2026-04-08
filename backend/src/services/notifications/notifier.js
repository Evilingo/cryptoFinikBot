import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';

export async function sendTelegramNotification(message) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.telegramToken || !settings?.telegramChatId) return;

  try {
    const url = `https://api.telegram.org/bot${settings.telegramToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    logger.error('Telegram notification failed', { error: err.message });
  }
}

export function formatSignalMessage(signal) {
  const arrow = signal.direction === 'LONG' ? '🟢' : signal.direction === 'SHORT' ? '🔴' : '⚪';
  return `${arrow} <b>${signal.direction}</b> ${signal.monitorSymbol}
Цена: ${signal.price}
OBD: ${signal.obd1} | ${signal.obd2} | ${signal.obd3} | ${signal.obd4}
${signal.claudeAnalysis}
${signal.suggestedSl ? `SL: ${signal.suggestedSl}` : ''} ${signal.suggestedTp ? `TP: ${signal.suggestedTp}` : ''}`;
}
