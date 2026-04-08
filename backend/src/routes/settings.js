import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../config/crypto.js';

const router = Router();

function maskKey(val) {
  if (!val) return '';
  return val.length > 8 ? val.slice(0, 4) + '****' + val.slice(-4) : '****';
}

router.get('/', authMiddleware, async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) return res.status(404).json({ error: 'Settings not found' });

  res.json({
    claudePrompt: s.claudePrompt,
    binanceApiKey: maskKey(s.binanceApiKey),
    binanceSecret: maskKey(s.binanceSecret),
    telegramToken: s.telegramToken ? '****' : '',
    telegramChatId: s.telegramChatId || '',
    dipThreshold: s.dipThreshold,
  });
});

router.put('/prompt', authMiddleware, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  await prisma.settings.update({ where: { id: 1 }, data: { claudePrompt: prompt } });
  res.json({ ok: true });
});

router.put('/keys', authMiddleware, async (req, res) => {
  const { apiKey, secret } = req.body;
  if (!apiKey || !secret) {
    return res.status(400).json({ error: 'apiKey and secret are required' });
  }
  await prisma.settings.update({
    where: { id: 1 },
    data: {
      binanceApiKey: encrypt(apiKey),
      binanceSecret: encrypt(secret),
    },
  });
  res.json({ ok: true });
});

router.put('/telegram', authMiddleware, async (req, res) => {
  const { token, chatId } = req.body;
  await prisma.settings.update({
    where: { id: 1 },
    data: {
      telegramToken: token || null,
      telegramChatId: chatId || null,
    },
  });
  res.json({ ok: true });
});

router.put('/threshold', authMiddleware, async (req, res) => {
  const { dipThreshold } = req.body;
  if (typeof dipThreshold !== 'number' || dipThreshold < 1 || dipThreshold > 50) {
    return res.status(400).json({ error: 'dipThreshold must be 1-50' });
  }
  await prisma.settings.update({ where: { id: 1 }, data: { dipThreshold } });
  res.json({ ok: true });
});

export default router;
