import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../config/crypto.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { BINANCE_PAIRS, BYBIT_PAIRS } from '../config/pairs.js';
import { invalidateExchangeCache } from '../services/exchange/index.js';
import { invalidateSettingsCache } from '../db/settingsCache.js';
import { switchExchangeWs } from '../services/exchange/wsManager.js';
import { setupTelegramWebhook } from '../services/notifications/telegramBot.js';

const router = Router();

function simpleSetting(field, validator) {
  return [authMiddleware, async (req, res) => {
    const value = req.body[field];
    const error = validator?.(value);
    if (error) return res.status(400).json({ error });
    await prisma.settings.update({ where: { id: 1 }, data: { [field]: value } });
    invalidateSettingsCache();
    res.json({ ok: true });
  }];
}

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

  // Invalidate exchange adapter cache (REST calls)
  invalidateExchangeCache();

  // Swap active trading pairs
  const targetPairs = exchange === 'bybit' ? BYBIT_PAIRS : BINANCE_PAIRS;

  await prisma.$transaction(async (tx) => {
    await tx.settings.update({ where: { id: 1 }, data: { exchange } });

    await tx.tradingPair.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    for (const p of targetPairs) {
      const existing = await tx.tradingPair.findFirst({
        where: { monitorSymbol: p.monitor },
      });
      if (existing) {
        await tx.tradingPair.update({
          where: { id: existing.id },
          data: { isActive: true, tradeSymbol: p.trade },
        });
      } else {
        await tx.tradingPair.create({
          data: { monitorSymbol: p.monitor, tradeSymbol: p.trade, isActive: true },
        });
      }
    }
  });

  // Hot-switch WebSocket services (non-blocking — runs in background)
  switchExchangeWs(exchange).catch((err) =>
    logger.error('Exchange WS switch failed', { error: err.message })
  );

  res.json({ ok: true, exchange });
});

router.put('/telegram', authMiddleware, async (req, res) => {
  const { token, chatId } = req.body;
  const data = {};
  if (token !== undefined) data.telegramToken = token ? encrypt(token) : null;
  if (chatId !== undefined) data.telegramChatId = chatId ? encrypt(chatId) : null;
  if (Object.keys(data).length > 0) {
    await prisma.settings.update({ where: { id: 1 }, data });
  }
  if (data.telegramToken !== undefined) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    setupTelegramWebhook(baseUrl).catch((err) =>
      logger.warn('Telegram webhook re-registration failed', { error: err.message })
    );
  }
  res.json({ ok: true });
});

router.put('/confidence', ...simpleSetting('minConfidence', (v) =>
  typeof v !== 'number' || v < 0 || v > 100 ? 'minConfidence must be 0-100' : null
));

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

router.put('/ofi', ...simpleSetting('ofiEnabled', (v) =>
  typeof v !== 'boolean' ? 'ofiEnabled must be boolean' : null
));

router.put('/threshold', ...simpleSetting('dipThreshold', (v) =>
  typeof v !== 'number' || v < 1 || v > 50 ? 'dipThreshold must be 1-50' : null
));

router.post('/test-prompt', authMiddleware, async (req, res) => {
  if (!env.anthropicApiKey) {
    return res.json({ ok: false, error: 'Anthropic API key not configured' });
  }
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) return res.status(404).json({ error: 'Settings not found' });

  const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  const userMessage = `Пара: BTCUSDT → BTCUSDT
Цена: 65000
OBD: obd1=-18 obd2=-15 obd3=-12 obd4=-10
Тренд: 5m: UP (+0.3%) | 15m: UP (+0.8%)
RSI(14): 35 — перепродан
ATR(14): 320 (0.49% от цены) — ИСПОЛЬЗУЙ ДЛЯ РАСЧЁТА SL/TP`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: s.claudePrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = message.content[0].text;
    let direction = null;
    let confidence = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        direction = parsed.direction ?? null;
        confidence = parsed.confidence ?? null;
      }
    } catch {
      // ignore parse errors — still return raw text
    }
    res.json({ ok: true, response: text, direction, confidence });
  } catch (err) {
    logger.error('Test prompt failed', { error: err.message });
    res.json({ ok: false, error: err.message });
  }
});

export default router;
