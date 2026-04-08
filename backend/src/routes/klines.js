import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getKlines } from '../services/binance/rest.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const { symbol, interval = '1m', limit = '100' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const klines = await getKlines(symbol, interval, parseInt(limit));
    res.json(klines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
