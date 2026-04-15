import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { broadcast } from '../../ws/hub.js';

const TRACKING_TIMEOUT = 60 * 60 * 1000; // 1 час — макс. время отслеживания сигнала

/**
 * Вызывается каждые 5 сек из orderbook polling.
 * Проверяет все PENDING сигналы — не сработал ли SL или TP.
 */
export async function trackSignalOutcomes(symbol, currentPrice) {
  const pendingSignals = await prisma.signal.findMany({
    where: {
      pair: { monitorSymbol: symbol },
      outcome: null,
      suggestedSl: { not: null },
      suggestedTp: { not: null },
    },
    include: { pair: true },
  });

  for (const signal of pendingSignals) {
    const age = Date.now() - new Date(signal.createdAt).getTime();

    // Обновляем max/min цену
    const maxPrice = Math.max(signal.maxPrice || currentPrice, currentPrice);
    const minPrice = Math.min(signal.minPrice || currentPrice, currentPrice);

    const isLong = signal.direction === 'LONG';

    let outcome = null;
    let outcomePrice = null;
    let outcomePnl = null;

    if (isLong) {
      // LONG: TP выше цены входа, SL ниже
      if (currentPrice >= signal.suggestedTp) {
        outcome = 'WIN';
        outcomePrice = currentPrice;
        outcomePnl = ((currentPrice - signal.price) / signal.price) * 100;
      } else if (currentPrice <= signal.suggestedSl) {
        outcome = 'LOSS';
        outcomePrice = currentPrice;
        outcomePnl = ((currentPrice - signal.price) / signal.price) * 100;
      }
    } else if (signal.direction === 'SHORT') {
      // SHORT: TP ниже цены входа, SL выше
      if (currentPrice <= signal.suggestedTp) {
        outcome = 'WIN';
        outcomePrice = currentPrice;
        outcomePnl = ((signal.price - currentPrice) / signal.price) * 100;
      } else if (currentPrice >= signal.suggestedSl) {
        outcome = 'LOSS';
        outcomePrice = currentPrice;
        outcomePnl = ((signal.price - currentPrice) / signal.price) * 100;
      }
    }

    // Таймаут — закрываем по текущей цене
    if (!outcome && age > TRACKING_TIMEOUT) {
      outcomePrice = currentPrice;
      if (isLong) {
        outcomePnl = ((currentPrice - signal.price) / signal.price) * 100;
      } else {
        outcomePnl = ((signal.price - currentPrice) / signal.price) * 100;
      }
      outcome = outcomePnl > 0.1 ? 'WIN' : outcomePnl < -0.1 ? 'LOSS' : 'BREAKEVEN';
    }

    const updateData = { maxPrice, minPrice };

    if (outcome) {
      updateData.outcome = outcome;
      updateData.outcomePrice = outcomePrice;
      updateData.outcomePnl = Math.round(outcomePnl * 100) / 100;
      updateData.outcomeAt = new Date();

      logger.info(`Signal #${signal.id} ${signal.pair.monitorSymbol} resolved: ${outcome}`, {
        pnl: updateData.outcomePnl,
        entry: signal.price,
        exit: outcomePrice,
      });

      broadcast({
        type: 'SIGNAL_OUTCOME',
        signalId: signal.id,
        symbol: signal.pair.monitorSymbol,
        outcome,
        pnl: updateData.outcomePnl,
        outcomePrice,
      });
    }

    await prisma.signal.update({
      where: { id: signal.id },
      data: updateData,
    });
  }
}

/**
 * Статистика точности сигналов.
 */
export async function getEnhancedStats(pairId = null, since = null) {
  const where = { outcome: { not: null } };
  if (pairId) where.pairId = pairId;
  if (since) where.createdAt = { gte: since };

  const signals = await prisma.signal.findMany({
    where,
    select: {
      outcome: true, outcomePnl: true, direction: true,
      confidence: true, createdAt: true,
      pair: { select: { monitorSymbol: true } },
    },
  });

  if (signals.length === 0) return { byConfidence: [], byDirection: {}, byHour: [] };

  // By confidence bracket
  const brackets = [
    { label: '0–50', min: 0, max: 50 },
    { label: '50–65', min: 50, max: 65 },
    { label: '65–80', min: 65, max: 80 },
    { label: '80–100', min: 80, max: 101 },
  ];
  const byConfidence = brackets.map(({ label, min, max }) => {
    const group = signals.filter((s) => s.confidence != null && s.confidence >= min && s.confidence < max);
    const wins = group.filter((s) => s.outcome === 'WIN').length;
    const total = group.length;
    const totalPnl = group.reduce((sum, s) => sum + (s.outcomePnl || 0), 0);
    return {
      label, total, wins,
      losses: group.filter((s) => s.outcome === 'LOSS').length,
      winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
      avgPnl: total > 0 ? Math.round((totalPnl / total) * 100) / 100 : 0,
    };
  });

  // By direction
  const byDirection = {};
  for (const dir of ['LONG', 'SHORT']) {
    const group = signals.filter((s) => s.direction === dir);
    const wins = group.filter((s) => s.outcome === 'WIN').length;
    const total = group.length;
    const totalPnl = group.reduce((sum, s) => sum + (s.outcomePnl || 0), 0);
    byDirection[dir] = {
      total, wins,
      losses: group.filter((s) => s.outcome === 'LOSS').length,
      winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
      avgPnl: total > 0 ? Math.round((totalPnl / total) * 100) / 100 : 0,
    };
  }

  // By hour of day (UTC)
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const group = signals.filter((s) => new Date(s.createdAt).getUTCHours() === h);
    const wins = group.filter((s) => s.outcome === 'WIN').length;
    const total = group.length;
    return {
      hour: h,
      total,
      wins,
      winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : null,
    };
  });

  return { byConfidence, byDirection, byHour };
}

export async function runBacktest({ pairId, from, to, threshold = 10, slPct = 1.5, tpPct = 3.0 }) {
  const snapshots = await prisma.obdSnapshot.findMany({
    where: {
      pairId: Number(pairId),
      createdAt: { gte: new Date(from), lte: new Date(to) },
    },
    orderBy: { createdAt: 'asc' },
    select: { obd1: true, obd2: true, obd3: true, obd4: true, midPrice: true, createdAt: true },
  });

  if (snapshots.length < 24) return { signals: [], stats: null, snapshotCount: snapshots.length };

  const { detectSignalFromHistory } = await import('../indicators/engine.js');
  const COOLDOWN = 15 * 60 * 1000;
  const TIMEOUT = 60 * 60 * 1000; // 1h

  const signals = [];
  let lastSignalAt = 0;

  for (let i = 24; i < snapshots.length; i++) {
    const history = snapshots.slice(Math.max(0, i - 24), i + 1);
    const direction = detectSignalFromHistory(history, threshold);
    if (!direction) continue;

    const snap = snapshots[i];
    const snapTime = new Date(snap.createdAt).getTime();
    if (snapTime - lastSignalAt < COOLDOWN) continue;
    lastSignalAt = snapTime;

    // Find outcome in subsequent snapshots
    const entryPrice = snap.midPrice;
    const sl = direction === 'LONG' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
    const tp = direction === 'LONG' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);

    let outcome = 'TIMEOUT';
    let exitPrice = entryPrice;

    for (let j = i + 1; j < snapshots.length; j++) {
      const future = snapshots[j];
      const futureTime = new Date(future.createdAt).getTime();
      if (futureTime - snapTime > TIMEOUT) break;

      const p = future.midPrice;
      if (direction === 'LONG') {
        if (p >= tp) { outcome = 'WIN'; exitPrice = tp; break; }
        if (p <= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
      } else {
        if (p <= tp) { outcome = 'WIN'; exitPrice = tp; break; }
        if (p >= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
      }
      exitPrice = p;
    }

    if (outcome === 'TIMEOUT') {
      const pnlRaw = direction === 'LONG'
        ? (exitPrice - entryPrice) / entryPrice * 100
        : (entryPrice - exitPrice) / entryPrice * 100;
      outcome = pnlRaw > 0.1 ? 'WIN' : pnlRaw < -0.1 ? 'LOSS' : 'BREAKEVEN';
    }

    const pnl = direction === 'LONG'
      ? Math.round((exitPrice - entryPrice) / entryPrice * 10000) / 100
      : Math.round((entryPrice - exitPrice) / entryPrice * 10000) / 100;

    signals.push({ direction, entryPrice, exitPrice, sl, tp, outcome, pnl, createdAt: snap.createdAt });
  }

  const total = signals.length;
  const wins = signals.filter((s) => s.outcome === 'WIN').length;
  const losses = signals.filter((s) => s.outcome === 'LOSS').length;
  const totalPnl = signals.reduce((sum, s) => sum + s.pnl, 0);

  // Cumulative equity curve
  let equity = 0;
  const equityCurve = signals.map((s) => { equity += s.pnl; return Math.round(equity * 100) / 100; });

  return {
    snapshotCount: snapshots.length,
    signals,
    equityCurve,
    stats: {
      total, wins, losses,
      breakeven: total - wins - losses,
      winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgPnl: total > 0 ? Math.round((totalPnl / total) * 100) / 100 : 0,
    },
  };
}

export async function getSignalStats(pairId = null, since = null) {
  const where = { outcome: { not: null } };
  if (pairId) where.pairId = pairId;
  if (since) where.createdAt = { gte: since };

  const signals = await prisma.signal.findMany({
    where,
    select: {
      outcome: true,
      outcomePnl: true,
      direction: true,
      confidence: true,
      pair: { select: { monitorSymbol: true } },
    },
  });

  const total = signals.length;
  if (total === 0) {
    return { total: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, avgPnl: 0, totalPnl: 0, byPair: {} };
  }

  const wins = signals.filter((s) => s.outcome === 'WIN').length;
  const losses = signals.filter((s) => s.outcome === 'LOSS').length;
  const breakeven = signals.filter((s) => s.outcome === 'BREAKEVEN').length;
  const winRate = Math.round((wins / total) * 10000) / 100;
  const totalPnl = signals.reduce((sum, s) => sum + (s.outcomePnl || 0), 0);
  const avgPnl = Math.round((totalPnl / total) * 100) / 100;

  // По парам
  const byPair = {};
  for (const s of signals) {
    const sym = s.pair.monitorSymbol;
    if (!byPair[sym]) byPair[sym] = { total: 0, wins: 0, losses: 0, totalPnl: 0 };
    byPair[sym].total++;
    if (s.outcome === 'WIN') byPair[sym].wins++;
    if (s.outcome === 'LOSS') byPair[sym].losses++;
    byPair[sym].totalPnl += s.outcomePnl || 0;
  }

  for (const sym of Object.keys(byPair)) {
    byPair[sym].winRate = Math.round((byPair[sym].wins / byPair[sym].total) * 10000) / 100;
    byPair[sym].avgPnl = Math.round((byPair[sym].totalPnl / byPair[sym].total) * 100) / 100;
  }

  // Последние 20 результатов для графика
  const recent = await prisma.signal.findMany({
    where: { outcome: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, outcome: true, outcomePnl: true, direction: true, createdAt: true, pair: { select: { monitorSymbol: true } } },
  });

  return { total, wins, losses, breakeven, winRate, avgPnl, totalPnl: Math.round(totalPnl * 100) / 100, byPair, recent: recent.reverse() };
}
