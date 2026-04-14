import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getLatestObd } from '../services/indicators/engine.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const pairs = await prisma.tradingPair.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  });

  const result = pairs.map((p) => ({
    ...p,
    obd: getLatestObd(p.monitorSymbol),
  }));

  res.json(result);
});

export default router;
