import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getAccountBalance,
  getOpenOrders,
  getOrderHistory,
  cancelOrder,
  placeManualOrder,
} from '../services/bybit/rest.js';

const router = Router();
router.use(authMiddleware);

// GET /api/portfolio/balance
// Returns UTA wallet: array of { asset, free, locked, total }
router.get('/balance', async (req, res) => {
  const coins = await getAccountBalance(); // уже массив { asset, free, locked }
  res.json(
    coins.map(c => ({
      asset: c.asset,
      free: parseFloat(c.free || 0),
      locked: parseFloat(c.locked || 0),
      total: parseFloat(c.free || 0) + parseFloat(c.locked || 0),
    }))
  );
});

// GET /api/portfolio/orders/open?symbol=BTCUSDT
router.get('/orders/open', async (req, res) => {
  const data = await getOpenOrders(req.query.symbol || null);
  const orders = data.result?.list || [];
  res.json(orders.map(normalizeOrder));
});

// GET /api/portfolio/orders/history?symbol=BTCUSDT&limit=50
router.get('/orders/history', async (req, res) => {
  const symbol = req.query.symbol || null;
  const limit = parseInt(req.query.limit) || 50;
  const data = await getOrderHistory(symbol, limit);
  const orders = data.result?.list || [];
  res.json(orders.map(normalizeOrder));
});

// POST /api/portfolio/orders
// Body: { symbol, side, orderType, qty, price?, triggerPrice?, stopLoss?, takeProfit? }
router.post('/orders', async (req, res) => {
  const { symbol, side, orderType, qty, price, triggerPrice, stopLoss, takeProfit } = req.body;
  if (!symbol || !side || !orderType || !qty) {
    return res.status(400).json({ error: 'symbol, side, orderType, qty are required' });
  }
  if (!['BUY', 'SELL'].includes(side)) return res.status(400).json({ error: 'side must be BUY or SELL' });
  if (!['Market', 'Limit'].includes(orderType)) return res.status(400).json({ error: 'orderType must be Market or Limit' });
  if (orderType === 'Limit') {
    if (!triggerPrice && !price) {
      return res.status(400).json({ error: 'Limit order requires price or triggerPrice' });
    }
    if (triggerPrice && !price) {
      return res.status(400).json({ error: 'Stop-Limit order requires both triggerPrice and price' });
    }
  }

  const result = await placeManualOrder({
    symbol,
    side,
    orderType,
    qty: parseFloat(qty),
    price: price ? parseFloat(price) : null,
    triggerPrice: triggerPrice ? parseFloat(triggerPrice) : null,
    stopLoss: stopLoss ? parseFloat(stopLoss) : null,
    takeProfit: takeProfit ? parseFloat(takeProfit) : null,
  });
  res.json(result || { ok: true });
});

// DELETE /api/portfolio/orders/:orderId?symbol=BTCUSDT
router.delete('/orders/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol query param required' });
  const data = await cancelOrder(symbol, orderId);
  res.json(data.result || { ok: true });
});

function normalizeOrder(o) {
  return {
    orderId: o.orderId,
    orderLinkId: o.orderLinkId,
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    stopOrderType: o.stopOrderType,
    price: parseFloat(o.price || 0),
    triggerPrice: parseFloat(o.triggerPrice || 0),
    qty: parseFloat(o.qty || 0),
    cumExecQty: parseFloat(o.cumExecQty || 0),
    avgPrice: parseFloat(o.avgPrice || 0),
    stopLoss: parseFloat(o.stopLoss || 0),
    takeProfit: parseFloat(o.takeProfit || 0),
    orderStatus: o.orderStatus,
    createdTime: parseInt(o.createdTime || 0),
    updatedTime: parseInt(o.updatedTime || 0),
  };
}

export default router;
