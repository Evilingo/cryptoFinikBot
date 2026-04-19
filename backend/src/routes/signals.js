import { Router } from 'express';
import { prisma } from '../db/prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const [rawSignals, total] = await Promise.all([
    prisma.signal.findMany({
      include: { pair: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.signal.count(),
  ]);

  const signals = rawSignals.map((s) => ({
    id: s.id,
    pairId: s.pairId,
    pair: s.pair?.monitorSymbol || '',
    direction: s.direction,
    confidence: s.confidence,
    strategy: s.strategy || 'OBD',
    ofiRatio: s.ofiRatio ?? null,
    obd: [s.obd1, s.obd2, s.obd3, s.obd4],
    price: s.price ?? 0,
    analysis: s.claudeAnalysis || '',
    sl: s.suggestedSl ?? null,
    tp: s.suggestedTp ?? null,
    tpPct: s.tpPct ?? null,
    slPct: s.slPct ?? null,
    outcome: s.outcome,
    pnl: s.outcomePnl ?? null,
    createdAt: new Date(s.createdAt).getTime(),
  }));

  res.json({ signals, total, limit, offset });
});

export default router;
