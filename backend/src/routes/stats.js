import { Router } from 'express';

import { getSignalStats, getEnhancedStats, runBacktest, runOptimize } from '../services/signals/tracker.js';
import { prisma } from '../db/prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  const pairId = req.query.pairId ? parseInt(req.query.pairId) : null;
  const stats = await getSignalStats(pairId);
  res.json(stats);
});

router.get('/analytics', async (req, res) => {
  const pairId = req.query.pairId ? parseInt(req.query.pairId) : null;
  const since = req.query.since ? new Date(req.query.since) : null;
  const data = await getEnhancedStats(pairId, since);
  res.json(data);
});

router.get('/snapshots', async (req, res) => {
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

router.get('/backtest', async (req, res) => {
  const { pairId, from, to, threshold, slPct, tpPct, direction } = req.query;
  if (!pairId || !from || !to) {
    return res.status(400).json({ error: 'pairId, from, to are required' });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format for from/to' });
  }
  if (fromDate >= toDate) {
    return res.status(400).json({ error: 'from must be before to' });
  }

  const parsedThreshold = threshold ? parseFloat(threshold) : 10;
  const parsedSl = slPct ? parseFloat(slPct) : 1.5;
  const parsedTp = tpPct ? parseFloat(tpPct) : 3.0;
  if (parsedThreshold < 1 || parsedThreshold > 100) {
    return res.status(400).json({ error: 'threshold must be between 1 and 100' });
  }
  if (parsedSl <= 0 || parsedTp <= 0) {
    return res.status(400).json({ error: 'slPct and tpPct must be positive' });
  }

  const directionFilter = direction === 'LONG' || direction === 'SHORT' ? direction : null;

  const result = await runBacktest({
    pairId: parseInt(pairId),
    from: fromDate,
    to: toDate,
    threshold: parsedThreshold,
    slPct: parsedSl,
    tpPct: parsedTp,
    directionFilter,
  });
  res.json(result);
});

router.get('/optimize', async (req, res) => {
  const { pairIds, from, to, direction } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  const fromDate = new Date(from);
  const toDate   = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  if (fromDate >= toDate) return res.status(400).json({ error: 'from must be before to' });

  const parsedPairIds = pairIds
    ? pairIds.split(',').map(Number).filter(Boolean)
    : null;

  const directionFilter = direction === 'LONG' || direction === 'SHORT' ? direction : null;

  const result = await runOptimize({ pairIds: parsedPairIds, from: fromDate, to: toDate, directionFilter });
  res.json(result);
});

export default router;
