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
import { startOrderBookPolling, stopOrderBookPolling } from './services/binance/orderbook.js';
import { startBinanceWs, stopBinanceWs } from './services/binance/websocket.js';

import { DEFAULT_PROMPT } from './services/claude/prompts.js';
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
  if (!settings) {
    await prisma.settings.create({
      data: {
        id: 1,
        claudePrompt: DEFAULT_PROMPT,
        telegramToken: env.telegramToken,
        telegramChatId: env.telegramChatId,
      },
    });
    logger.info('Default settings created');
  } else if (env.telegramToken && !settings.telegramToken) {
    // Sync Telegram credentials from env if not yet set in DB
    await prisma.settings.update({
      where: { id: 1 },
      data: { telegramToken: env.telegramToken, telegramChatId: env.telegramChatId },
    });
    logger.info('Telegram credentials synced from env to DB');
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

  startOrderBookPolling();
  startBinanceWs();

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
  stopOrderBookPolling();
  stopBinanceWs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
