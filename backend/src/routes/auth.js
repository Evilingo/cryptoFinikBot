import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { publicLimiter } from '../middleware/rateLimit.js';

const router = Router();

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, env.jwtSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, env.jwtRefreshSecret, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

router.post('/login', publicLimiter, async (req, res) => {
  const { username, password } = req.body;
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
  setRefreshCookie(res, refreshToken);
  res.json({ accessToken });
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

export default router;
