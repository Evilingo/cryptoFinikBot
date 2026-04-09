import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import { validateEnv, env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { initWebSocketHub } from './ws/hub.js';
import { startOrderBookPolling, stopOrderBookPolling } from './services/binance/orderbook.js';
import { startBinanceWs, stopBinanceWs } from './services/binance/websocket.js';

import authRoutes from './routes/auth.js';
import pairsRoutes from './routes/pairs.js';
import signalsRoutes from './routes/signals.js';
import tradeRoutes from './routes/trade.js';
import settingsRoutes from './routes/settings.js';
import balanceRoutes from './routes/balance.js';
import klinesRoutes from './routes/klines.js';
import statsRoutes from './routes/stats.js';

validateEnv();

const app = express();

app.use(cors({ origin: env.allowedOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pairs', pairsRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/balance', balanceRoutes);
app.use('/api/klines', klinesRoutes);
app.use('/api/stats', statsRoutes);

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
  const { default: bcrypt } = await import('bcrypt');
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
        claudePrompt: `Ты торговый аналитик для Binance Spot.
Анализируй данные Order Book Depth (OBD) индикаторов и свечи.
OBD индикатор: значение 0-100, где >50 означает преобладание покупателей в стакане.
Сигнал появляется когда все 4 OBD индикатора синхронно просели и начали отскок.

Твоя задача:
1. Подтвердить или опровергнуть сигнал на основе контекста свечей
2. Оценить силу сигнала (confidence 0-100)
3. Предложить уровни Stop Loss и Take Profit
4. Дать краткое объяснение (2-3 предложения)

Отвечай ТОЛЬКО валидным JSON без дополнительного текста.`,
      },
    });
    logger.info('Default settings created');
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

  // Binance services — disabled until foreign IP/proxy is configured
  // startOrderBookPolling();
  // startBinanceWs();
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
