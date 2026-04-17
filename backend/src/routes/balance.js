import { Router } from 'express';
import { getAccountBalance } from '../services/exchange/index.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const balances = await getAccountBalance();
    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
