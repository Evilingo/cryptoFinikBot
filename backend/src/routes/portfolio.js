import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import {
  getAccountBalance,
  getOpenOrders,
  getOrderHistory,
  cancelOrder,
  cancelAllOpenOrders,
  placeManualOrder,
  placeTpSl,
  getSymbolInfo,
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

// POST /api/portfolio/trades/:id/close — market-close a bot trade
router.post('/trades/:id/close', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid trade id' });

  const trade = await prisma.trade.findUnique({ where: { id } });
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.status !== 'OPEN') return res.status(400).json({ error: 'Trade is not open' });

  const exitSide = trade.side === 'BUY' ? 'SELL' : 'BUY';

  // Cancel SL/TP before market exit to avoid double-fill
  await cancelAllOpenOrders(trade.symbol).catch(() => {});

  // Use real wallet balance — DB quantity may differ from actual after fees
  const baseAsset = trade.symbol.replace(/USDT$|USDC$/, '');
  let qty = trade.quantity;
  try {
    const coins = await getAccountBalance();
    const coin = coins.find(c => c.asset === baseAsset);
    const realQty = parseFloat(coin?.free || coin?.total || 0);
    if (realQty > 0) {
      qty = realQty;
      logger.info('close trade: using real balance', { symbol: trade.symbol, dbQty: trade.quantity, realQty });
    }
  } catch (err) {
    logger.warn('close trade: failed to fetch balance, using DB qty', { error: err.message });
  }

  // Place market exit — userDataStream will close the Trade record on fill
  const result = await placeManualOrder({
    symbol: trade.symbol,
    side: exitSide,
    orderType: 'Market',
    qty,
  });

  res.json({ ok: true, orderId: result?.orderId });
});

// POST /api/portfolio/trades/:id/fix-protection
// Places missing SL/TP on Bybit for an OPEN trade (manual override for reconcile).
router.post('/trades/:id/fix-protection', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid trade id' });

  const trade = await prisma.trade.findUnique({ where: { id } });
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.status !== 'OPEN') return res.status(400).json({ error: 'Trade is not open' });
  if (!trade.stopLoss && !trade.takeProfit) return res.status(400).json({ error: 'Trade has no SL/TP configured' });

  const exitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
  const ordersData = await getOpenOrders(trade.symbol);
  const orders = ordersData.result?.list || [];
  const exitOrders = orders.filter(o => o.side === exitSide);

  const isSlOrder = (o) =>
    o.stopOrderType === 'StopLoss' ||
    o.stopOrderType === 'Stop' ||
    o.stopOrderType === 'OcoTriggerByStopLoss' ||
    (parseFloat(o.triggerPrice || 0) > 0 && parseFloat(o.price || 0) === 0);
  const isTpOrder = (o) =>
    o.stopOrderType === 'TakeProfit' ||
    o.stopOrderType === 'OcoTriggerByTp' ||
    (o.orderType === 'Limit' && parseFloat(o.triggerPrice || 0) === 0 && parseFloat(o.price || 0) > 0);

  const slPlaced = !trade.stopLoss || exitOrders.some(isSlOrder);
  const tpPlaced = !trade.takeProfit || exitOrders.some(isTpOrder);
  if (slPlaced && tpPlaced) return res.json({ ok: true, message: 'Protection already present', slPlaced, tpPlaced });

  let symbolInfo;
  try { symbolInfo = await getSymbolInfo(trade.symbol); }
  catch { symbolInfo = { pricePrecision: 2, qtyPrecision: 6 }; }

  try {
    await placeTpSl(
      trade.symbol,
      exitSide,
      slPlaced ? null : trade.stopLoss,
      tpPlaced ? null : trade.takeProfit,
      symbolInfo,
      trade.quantity,
    );
    logger.info('Fix protection: TP/SL placed', { tradeId: id, symbol: trade.symbol, slPlaced, tpPlaced });
    res.json({ ok: true, slAdded: !slPlaced, tpAdded: !tpPlaced });
  } catch (err) {
    logger.error('Fix protection: placeTpSl failed', { tradeId: id, error: err.message });
    res.status(500).json({ error: err.message });
  }
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
