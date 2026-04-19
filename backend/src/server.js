import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateEnv, env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { initWebSocketHub } from './ws/hub.js';
import { stopOrderBookPolling } from './services/binance/orderbook.js';
import { initExchangeWs, stopAllExchangeWs } from './services/exchange/wsManager.js';

import crypto from 'node:crypto';
import { DEFAULT_PROMPT, DEFAULT_OFI_PROMPT } from './services/claude/prompts.js';

const hashPrompt = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
import authRoutes from './routes/auth.js';
import pairsRoutes from './routes/pairs.js';
import signalsRoutes from './routes/signals.js';
import tradeRoutes from './routes/trade.js';
import settingsRoutes from './routes/settings.js';
import balanceRoutes from './routes/balance.js';
import klinesRoutes from './routes/klines.js';
import statsRoutes from './routes/stats.js';
import telegramRoutes from './routes/telegram.js';
import { setupTelegramWebhook } from './services/notifications/telegramBot.js';

validateEnv();

const app = express();

app.use(cors({ origin: env.allowedOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Serve frontend static files
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pairs', pairsRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/balance', balanceRoutes);
app.use('/api/klines', klinesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/telegram', telegramRoutes);

// SPA fallback — all non-API routes serve index.html
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(join(frontendDist, 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

// WebSocket Hub
initWebSocketHub(server);

// Seed admin user on first start
async function seedAdmin() {
  const { default: bcrypt } = await import('bcryptjs');
  const existing = await prisma.user.findUnique({
    where: { username: env.adminUsername },
  });
  if (!existing) {
    const passwordHash = await bcrypt.hash(env.adminPassword, 12);
    await prisma.user.create({
      data: { username: env.adminUsername, passwordHash },
    });
    logger.info(`Admin user "${env.adminUsername}" created`);
  }

  // Seed default settings
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const currentHash = hashPrompt(DEFAULT_PROMPT);
  const currentOfiHash = hashPrompt(DEFAULT_OFI_PROMPT);

  if (!settings) {
    await prisma.settings.create({
      data: {
        id: 1,
        claudePrompt: DEFAULT_PROMPT,
        promptHash: currentHash,
        ofiClaudePrompt: DEFAULT_OFI_PROMPT,
        ofiPromptHash: currentOfiHash,
        telegramToken: env.telegramToken,
        telegramChatId: env.telegramChatId,
      },
    });
    logger.info('Default settings created');
  } else {
    const updates = {};

    if (settings.promptHash !== currentHash) {
      updates.claudePrompt = DEFAULT_PROMPT;
      updates.promptHash = currentHash;
      logger.info('DEFAULT_PROMPT changed — syncing to DB');
    }

    if (!settings.ofiClaudePrompt || settings.ofiPromptHash !== currentOfiHash) {
      updates.ofiClaudePrompt = DEFAULT_OFI_PROMPT;
      updates.ofiPromptHash = currentOfiHash;
      logger.info('DEFAULT_OFI_PROMPT changed — syncing to DB');
    }

    if (env.telegramToken && !settings.telegramToken) {
      updates.telegramToken = env.telegramToken;
      updates.telegramChatId = env.telegramChatId;
      logger.info('Telegram credentials synced from env to DB');
    }

    if (Object.keys(updates).length > 0) {
      await prisma.settings.update({ where: { id: 1 }, data: updates });
    }
  }

  // Seed trading pairs
  const { tradingPairs } = await import('./config/pairs.js');
  for (const p of tradingPairs) {
    const exists = await prisma.tradingPair.findFirst({
      where: { monitorSymbol: p.monitor },
    });
    if (!exists) {
      await prisma.tradingPair.create({
        data: { monitorSymbol: p.monitor, tradeSymbol: p.trade },
      });
    }
  }
}

server.listen(env.port, async () => {
  logger.info(`Server running on port ${env.port}`);

  try {
    await seedAdmin();
  } catch (err) {
    logger.error('Seed failed', { error: err.message });
  }

  // Start exchange-specific WebSocket services
  let exchange = 'binance';
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    exchange = s?.exchange || process.env.EXCHANGE || 'binance';
  } catch (err) {
    logger.warn('Failed to read exchange setting, defaulting to binance', { error: err.message });
  }

  await initExchangeWs(exchange);

  // Register Telegram webhook (non-blocking)
  const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.ALLOWED_ORIGIN;
  setupTelegramWebhook(publicUrl).catch((err) =>
    logger.warn('Telegram webhook setup failed', { error: err.message })
  );
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down...`);
  stopOrderBookPolling(); // kept for graceful shutdown compatibility
  stopAllExchangeWs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
