import crypto from 'crypto';
import { Router } from 'express';
import { handleTelegramUpdate } from '../services/notifications/telegramBot.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { safeDecrypt } from '../config/crypto.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendTelegramNotification } from '../services/notifications/notifier.js';

const router = Router();

// Telegram sends POST updates here — no auth (Telegram doesn't send our JWT)
router.post('/webhook', async (req, res) => {
  // Verify Telegram webhook secret (SEC-04)
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (settings?.telegramToken) {
    const token = safeDecrypt(settings.telegramToken);
    const expectedSecret = crypto.createHash('sha256').update(token).digest('hex');
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedSecret !== expectedSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  // Respond immediately so Telegram doesn't retry
  res.sendStatus(200);

  try {
    await handleTelegramUpdate(req.body);
  } catch (err) {
    logger.error('Telegram webhook handler error', { error: err.message });
  }
});

router.post('/test', authMiddleware, async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.telegramToken || !settings?.telegramChatId) {
      return res.status(400).json({ error: 'Telegram not configured' });
    }
    await sendTelegramNotification('🔔 Test notification from BestTrader', null);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Telegram test error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
