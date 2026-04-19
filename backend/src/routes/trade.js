import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tradeLimiter } from '../middleware/rateLimit.js';
import { placeOrder, getMidPrice } from '../services/exchange/index.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';

const router = Router();

function validateSlTp(side, entryPrice, stopLoss, takeProfit) {
  if (stopLoss !== undefined && (typeof stopLoss !== 'number' || !isFinite(stopLoss)))
    return 'stopLoss must be a finite number';
  if (takeProfit !== undefined && (typeof takeProfit !== 'number' || !isFinite(takeProfit)))
    return 'takeProfit must be a finite number';
  if (stopLoss !== undefined && stopLoss <= 0) return 'stopLoss must be positive';
  if (takeProfit !== undefined && takeProfit <= 0) return 'takeProfit must be positive';
  if (stopLoss !== undefined && takeProfit !== undefined && stopLoss === takeProfit)
    return 'stopLoss and takeProfit cannot be equal';
  if (side === 'BUY') {
    if (stopLoss !== undefined && stopLoss >= entryPrice)
      return 'stopLoss must be below entry price for BUY';
    if (takeProfit !== undefined && takeProfit <= entryPrice)
      return 'takeProfit must be above entry price for BUY';
  }
  if (side === 'SELL') {
    if (stopLoss !== undefined && stopLoss <= entryPrice)
      return 'stopLoss must be above entry price for SELL';
    if (takeProfit !== undefined && takeProfit >= entryPrice)
      return 'takeProfit must be below entry price for SELL';
  }
  return null;
}

router.post('/order', authMiddleware, tradeLimiter, async (req, res) => {
  const { symbol, side, quantity, entryPrice: bodyEntryPrice, stopLoss, takeProfit } = req.body;

  if (!symbol || !side || !quantity) {
    return res.status(400).json({ error: 'symbol, side, and quantity are required' });
  }

  if (!['BUY', 'SELL'].includes(side)) {
    return res.status(400).json({ error: 'side must be BUY or SELL' });
  }

  if (typeof quantity !== 'number' || !isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }

  try {
    if (stopLoss !== undefined || takeProfit !== undefined) {
      if (bodyEntryPrice !== undefined && (typeof bodyEntryPrice !== 'number' || bodyEntryPrice <= 0)) {
        return res.status(400).json({ error: 'entryPrice must be a positive number' });
      }
      const entryPrice = bodyEntryPrice ?? await getMidPrice(symbol);
      const validationError = validateSlTp(side, entryPrice, stopLoss, takeProfit);
      if (validationError) return res.status(400).json({ error: validationError });
    }

    const result = await placeOrder({ symbol, side, quantity, stopLoss, takeProfit });

    await prisma.trade.create({
      data: {
        symbol,
        side,
        quantity,
        price: result.price,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        binanceOrderId: result.orderId,
        status: 'OPEN',
      },
    });

    logger.info('Trade placed', { symbol, side, quantity, orderId: result.orderId });
    res.json(result);
  } catch (err) {
    logger.error('Trade failed', { error: err.message, symbol, side, quantity });
    const msg = (err.message?.includes('Binance') || err.message?.includes('Bybit')) ? err.message : 'Trade execution failed';
    res.status(500).json({ error: msg });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(trades);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await prisma.trade.delete({ where: { id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Trade not found' });
  }
});

export default router;
