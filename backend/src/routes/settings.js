import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../config/crypto.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) return res.status(404).json({ error: 'Settings not found' });

  res.json({
    claudePrompt: s.claudePrompt,
    binanceApiKey: s.binanceApiKey ? 'Configured ****' : 'Not set',
    binanceSecret: s.binanceSecret ? 'Configured ****' : 'Not set',
    telegramToken: s.telegramToken ? '****' : '',
    telegramChatId: s.telegramChatId || '',
    dipThreshold: s.dipThreshold,
    minConfidence: s.minConfidence,
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

router.put('/confidence', authMiddleware, async (req, res) => {
  const { minConfidence } = req.body;
  if (typeof minConfidence !== 'number' || minConfidence < 0 || minConfidence > 100) {
    return res.status(400).json({ error: 'minConfidence must be 0-100' });
  }
  await prisma.settings.update({ where: { id: 1 }, data: { minConfidence } });
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
