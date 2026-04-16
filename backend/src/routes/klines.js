import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getKlines } from '../services/exchange/index.js';

const router = Router();

const VALID_INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];

router.get('/', authMiddleware, async (req, res) => {
  const { symbol, interval = '1m', limit = '100' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  if (!VALID_INTERVALS.includes(interval)) {
    return res.status(400).json({ error: 'Invalid interval' });
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);

  try {
    const klines = await getKlines(symbol, interval, parsedLimit);
    res.json(klines);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch klines' });
  }
});

export default router;
