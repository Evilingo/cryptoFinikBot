import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { publicLimiter } from '../middleware/rateLimit.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, env.jwtSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, env.jwtRefreshSecret, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function setRefreshCookie(res, token, persistent = true) {
  const options = {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  };
  if (persistent) {
    options.maxAge = 7 * 24 * 60 * 60 * 1000;
  }
  res.cookie('refreshToken', token, options);
}

router.post('/login', publicLimiter, async (req, res) => {
  const { username, password, remember = true } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  setRefreshCookie(res, refreshToken, remember !== false);
  res.json({ accessToken });
});

router.get('/profile', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, email: user.email || '' });
});

router.put('/profile', authMiddleware, async (req, res) => {
  const { username, email } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'username is required' });
  }
  const conflict = await prisma.user.findFirst({
    where: { username, NOT: { id: req.user.userId } },
  });
  if (conflict) return res.status(409).json({ error: 'Username already taken' });
  await prisma.user.update({
    where: { id: req.user.userId },
    data: { username, email: email || '' },
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ ok: true });
});

router.post('/refresh', async (req, res) => {
  if (env.devSkipAuth) {
    const { accessToken } = generateTokens(1);
    return res.json({ accessToken });
  }

  const token = req.cookies?.refreshToken;
  if (!token) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret);
    const { accessToken, refreshToken } = generateTokens(payload.userId);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  } catch {
    res.clearCookie('refreshToken', { path: '/api/auth' });
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

export default router;
