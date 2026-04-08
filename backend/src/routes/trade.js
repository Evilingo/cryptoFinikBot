import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tradeLimiter } from '../middleware/rateLimit.js';
import { placeOrder } from '../services/binance/rest.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';

const router = Router();

router.post('/order', authMiddleware, tradeLimiter, async (req, res) => {
  const { symbol, side, quantity, stopLoss, takeProfit } = req.body;

  if (!symbol || !side || !quantity) {
    return res.status(400).json({ error: 'symbol, side, and quantity are required' });
  }

  if (!['BUY', 'SELL'].includes(side)) {
    return res.status(400).json({ error: 'side must be BUY or SELL' });
  }

  if (typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }

  try {
    const result = await placeOrder({ symbol, side, quantity, stopLoss, takeProfit });

    await prisma.trade.create({
      data: {
        symbol,
        side,
        quantity,
        price: result.price,
        stopLoss: stopLoss || null,
        takeProfit: takeProfit || null,
        binanceOrderId: result.orderId,
        status: 'OPEN',
      },
    });

    logger.info('Trade placed', { symbol, side, quantity, orderId: result.orderId });
    res.json(result);
  } catch (err) {
    logger.error('Trade failed', { error: err.message, symbol, side, quantity });
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(trades);
});

export default router;
