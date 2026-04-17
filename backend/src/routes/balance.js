import { Router } from 'express';
import { getAccountBalance } from '../services/exchange/index.js';
import { getAccountBalance as getBybitBalance, queryApiPermissions } from '../services/bybit/rest.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const balances = await getAccountBalance();
    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Bybit keys specifically — checks both balance (read) AND trading permissions
router.get('/test-bybit', async (req, res) => {
  const result = { balances: null, permissions: null, error: null };

  try {
    result.balances = await getBybitBalance();
  } catch (err) {
    result.error = err.message;
    return res.status(500).json(result);
  }

  try {
    result.permissions = await queryApiPermissions();
  } catch (err) {
    // Permission check is best-effort — balance already confirmed auth works
    result.permissions = { error: err.message };
  }

  res.json(result);
});

export default router;
