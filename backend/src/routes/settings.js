import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../config/crypto.js';
import { logger } from '../config/logger.js';
import { BINANCE_PAIRS, BYBIT_PAIRS } from '../config/pairs.js';
import { invalidateExchangeCache } from '../services/exchange/index.js';
import { switchExchangeWs } from '../services/exchange/wsManager.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) return res.status(404).json({ error: 'Settings not found' });

  res.json({
    claudePrompt: s.claudePrompt,
    binanceApiKey: s.binanceApiKey ? 'Configured ****' : 'Not set',
    binanceSecret: s.binanceSecret ? 'Configured ****' : 'Not set',
    telegramToken: s.telegramToken ? '****' : '',
    telegramChatId: s.telegramChatId ? '****' : '',
    dipThreshold: s.dipThreshold,
    minConfidence: s.minConfidence,
    autoTrade: s.autoTrade,
    autoTradeAmount: s.autoTradeAmount,
    maxOpenTrades: s.maxOpenTrades,
    allowShort: s.allowShort ?? true,
    exchange: s.exchange || 'binance',
    bybitApiKey: s.bybitApiKey ? 'Configured ****' : 'Not set',
    bybitSecret: s.bybitSecret ? 'Configured ****' : 'Not set',
    ofiEnabled: s.ofiEnabled ?? false,
    ofiClaudePrompt: s.ofiClaudePrompt || '',
  });
});

router.put('/prompt', authMiddleware, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  // Clear promptHash so next deploy with changed DEFAULT_PROMPT will still sync
  await prisma.settings.update({ where: { id: 1 }, data: { claudePrompt: prompt, promptHash: '' } });
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

router.put('/bybit-keys', authMiddleware, async (req, res) => {
  const { apiKey, secret } = req.body;
  if (!apiKey || !secret) {
    return res.status(400).json({ error: 'apiKey and secret are required' });
  }
  await prisma.settings.update({
    where: { id: 1 },
    data: {
      bybitApiKey: encrypt(apiKey),
      bybitSecret: encrypt(secret),
    },
  });
  res.json({ ok: true });
});

router.put('/exchange', authMiddleware, async (req, res) => {
  const { exchange } = req.body;
  if (!['binance', 'bybit'].includes(exchange)) {
    return res.status(400).json({ error: 'exchange must be "binance" or "bybit"' });
  }

  await prisma.settings.update({ where: { id: 1 }, data: { exchange } });

  // Invalidate exchange adapter cache (REST calls)
  invalidateExchangeCache();

  // Swap active trading pairs
  const targetPairs = exchange === 'bybit' ? BYBIT_PAIRS : BINANCE_PAIRS;

  await prisma.tradingPair.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });

  for (const p of targetPairs) {
    const existing = await prisma.tradingPair.findFirst({
      where: { monitorSymbol: p.monitor },
    });
    if (existing) {
      await prisma.tradingPair.update({
        where: { id: existing.id },
        data: { isActive: true, tradeSymbol: p.trade },
      });
    } else {
      await prisma.tradingPair.create({
        data: { monitorSymbol: p.monitor, tradeSymbol: p.trade, isActive: true },
      });
    }
  }

  // Hot-switch WebSocket services (non-blocking — runs in background)
  switchExchangeWs(exchange).catch((err) =>
    logger.error('Exchange WS switch failed', { error: err.message })
  );

  res.json({ ok: true, exchange });
});

router.put('/telegram', authMiddleware, async (req, res) => {
  const { token, chatId } = req.body;
  const data = {};
  if (token !== undefined) data.telegramToken = token || null;
  if (chatId !== undefined) data.telegramChatId = chatId || null;
  if (Object.keys(data).length > 0) {
    await prisma.settings.update({ where: { id: 1 }, data });
  }
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

router.put('/autotrade', authMiddleware, async (req, res) => {
  const { autoTrade, autoTradeAmount, maxOpenTrades, allowShort } = req.body;
  const data = {};
  if (typeof autoTrade === 'boolean') data.autoTrade = autoTrade;
  if (typeof autoTradeAmount === 'number' && autoTradeAmount > 0) data.autoTradeAmount = autoTradeAmount;
  if (typeof maxOpenTrades === 'number' && maxOpenTrades >= 1 && maxOpenTrades <= 10) data.maxOpenTrades = maxOpenTrades;
  if (typeof allowShort === 'boolean') data.allowShort = allowShort;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No valid fields provided' });
  await prisma.settings.update({ where: { id: 1 }, data });
  res.json({ ok: true });
});

router.put('/ofi-prompt', authMiddleware, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  await prisma.settings.update({ where: { id: 1 }, data: { ofiClaudePrompt: prompt, ofiPromptHash: '' } });
  res.json({ ok: true });
});

router.put('/ofi', authMiddleware, async (req, res) => {
  const { ofiEnabled } = req.body;
  if (typeof ofiEnabled !== 'boolean') {
    return res.status(400).json({ error: 'ofiEnabled must be boolean' });
  }
  await prisma.settings.update({ where: { id: 1 }, data: { ofiEnabled } });
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
