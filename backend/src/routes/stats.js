import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getSignalStats } from '../services/signals/tracker.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const pairId = req.query.pairId ? parseInt(req.query.pairId) : null;
  const stats = await getSignalStats(pairId);
  res.json(stats);
});

export default router;
