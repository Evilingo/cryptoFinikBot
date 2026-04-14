import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';

export async function sendTelegramNotification(message, confidence = null) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.telegramToken || !settings?.telegramChatId) return;

  const minConfidence = settings.minConfidence ?? 65;
  if (confidence !== null && confidence < minConfidence) {
    logger.info(`Telegram skipped: confidence ${confidence} < minConfidence ${minConfidence}`);
    return;
  }

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
  const confidenceLine = signal.confidence != null ? `\nУверенность: ${signal.confidence}%` : '';
  const slTpLine = [
    signal.suggestedSl ? `SL: ${signal.suggestedSl}` : '',
    signal.suggestedTp ? `TP: ${signal.suggestedTp}` : '',
  ].filter(Boolean).join('  ');

  return `${arrow} <b>${signal.direction}</b> ${signal.monitorSymbol}${confidenceLine}
Цена: ${signal.price}
OBD: ${signal.obd1} | ${signal.obd2} | ${signal.obd3} | ${signal.obd4}
${signal.claudeAnalysis}${slTpLine ? `\n${slTpLine}` : ''}`;
}
