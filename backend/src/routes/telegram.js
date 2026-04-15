import { Router } from 'express';
import { handleTelegramUpdate } from '../services/notifications/telegramBot.js';
import { logger } from '../config/logger.js';

const router = Router();

// Telegram sends POST updates here — no auth (Telegram doesn't send our JWT)
router.post('/webhook', async (req, res) => {
  // Respond immediately so Telegram doesn't retry
  res.sendStatus(200);

  try {
    await handleTelegramUpdate(req.body);
  } catch (err) {
    logger.error('Telegram webhook handler error', { error: err.message });
  }
});

export default router;
