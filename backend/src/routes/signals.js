import { Router } from 'express';
import { prisma } from '../db/prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const [signals, total] = await Promise.all([
    prisma.signal.findMany({
      include: { pair: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.signal.count(),
  ]);

  res.json({ signals, total, limit, offset });
});

export default router;
