import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getAccountBalance } from '../services/binance/rest.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const balances = await getAccountBalance();
    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
