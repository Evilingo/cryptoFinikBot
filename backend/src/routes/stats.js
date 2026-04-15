import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getSignalStats, getEnhancedStats, runBacktest } from '../services/signals/tracker.js';
import { prisma } from '../db/prisma.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const pairId = req.query.pairId ? parseInt(req.query.pairId) : null;
  const stats = await getSignalStats(pairId);
  res.json(stats);
});

router.get('/analytics', authMiddleware, async (req, res) => {
  const pairId = req.query.pairId ? parseInt(req.query.pairId) : null;
  const since = req.query.since ? new Date(req.query.since) : null;
  const data = await getEnhancedStats(pairId, since);
  res.json(data);
});

router.get('/snapshots', authMiddleware, async (req, res) => {
  const counts = await prisma.obdSnapshot.groupBy({
    by: ['pairId'],
    _count: { id: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  const pairs = await prisma.tradingPair.findMany({ where: { isActive: true } });
  const result = pairs.map((p) => {
    const c = counts.find((x) => x.pairId === p.id);
    return {
      pairId: p.id,
      symbol: p.monitorSymbol,
      count: c?._count.id || 0,
      from: c?._min.createdAt || null,
      to: c?._max.createdAt || null,
    };
  });
  res.json(result);
});

router.get('/backtest', authMiddleware, async (req, res) => {
  const { pairId, from, to, threshold, slPct, tpPct } = req.query;
  if (!pairId || !from || !to) {
    return res.status(400).json({ error: 'pairId, from, to are required' });
  }
  const result = await runBacktest({
    pairId: parseInt(pairId),
    from,
    to,
    threshold: threshold ? parseFloat(threshold) : 10,
    slPct: slPct ? parseFloat(slPct) : 1.5,
    tpPct: tpPct ? parseFloat(tpPct) : 3.0,
  });
  res.json(result);
});

export default router;
