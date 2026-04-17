import { Router } from 'express';
import { getAccountBalance } from '../services/exchange/index.js';
import { getAccountBalance as getBybitBalance } from '../services/bybit/rest.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const balances = await getAccountBalance();
    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Bybit keys specifically, regardless of active exchange setting
router.get('/test-bybit', async (req, res) => {
  try {
    const balances = await getBybitBalance();
    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
