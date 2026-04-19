import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { broadcast } from '../../ws/hub.js';

const TRACKING_TIMEOUT = 60 * 60 * 1000;

const calcPnl = (entry, exit, isLong) => ((isLong ? exit - entry : entry - exit) / entry) * 100;

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
    // WAIT = no trade, no position to track
    if (signal.direction === 'WAIT') continue;

    const age = Date.now() - new Date(signal.createdAt).getTime();

    // Обновляем max/min цену
    const maxPrice = Math.max(signal.maxPrice || currentPrice, currentPrice);
    const minPrice = Math.min(signal.minPrice || currentPrice, currentPrice);

    const isLong = signal.direction === 'LONG';

    let outcome = null;
    let outcomePrice = null;
    let outcomePnl = null;

    if (isLong) {
      if (currentPrice >= signal.suggestedTp) { outcome = 'WIN'; outcomePrice = currentPrice; }
      else if (currentPrice <= signal.suggestedSl) { outcome = 'LOSS'; outcomePrice = currentPrice; }
    } else if (signal.direction === 'SHORT') {
      if (currentPrice <= signal.suggestedTp) { outcome = 'WIN'; outcomePrice = currentPrice; }
      else if (currentPrice >= signal.suggestedSl) { outcome = 'LOSS'; outcomePrice = currentPrice; }
    }

    if (outcomePrice != null) outcomePnl = calcPnl(signal.price, outcomePrice, isLong);

    if (!outcome && age > TRACKING_TIMEOUT) {
      outcomePrice = currentPrice;
      outcomePnl = calcPnl(signal.price, currentPrice, isLong);
      outcome = outcomePnl > 0.1 ? 'WIN' : outcomePnl < -0.1 ? 'LOSS' : 'BREAKEVEN';
    }

    if (outcome) {
      const outcomePnlRounded = Math.round(outcomePnl * 100) / 100;
      logger.info(`Signal #${signal.id} ${signal.pair.monitorSymbol} resolved: ${outcome}`, {
        pnl: outcomePnlRounded,
        entry: signal.price,
        exit: outcomePrice,
      });

      // Use updateMany with outcome: null guard to prevent race condition with userDataStream
      const updated = await prisma.signal.updateMany({
        where: { id: signal.id, outcome: null },
        data: {
          outcome,
          outcomePrice,
          outcomePnl: outcomePnlRounded,
          outcomeAt: new Date(),
          maxPrice,
          minPrice,
        },
      });

      if (updated.count > 0) {
        broadcast({
          type: 'SIGNAL_OUTCOME',
          signalId: signal.id,
          symbol: signal.pair.monitorSymbol,
          outcome,
          pnl: outcomePnlRounded,
          outcomePrice,
        });

        // Trade closure is handled exclusively by userDataStream (real FILLED events from exchange).
        // Do not auto-close here — tracker resolves Signal outcome by midPrice simulation,
        // but the actual exchange order may still be open (OCO pending).
      }
    } else {
      // Only update price tracking, no outcome to set
      await prisma.signal.update({
        where: { id: signal.id },
        data: { maxPrice, minPrice },
      });
    }
  }
}

/**
 * Статистика точности сигналов.
 */
export async function getEnhancedStats(pairId = null, since = null) {
  const where = { outcome: { not: null }, direction: { not: 'WAIT' } };
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

// Bybit Spot: 0.1% taker на вход + 0.1% taker на выход = 0.2% round-trip
const ROUND_TRIP_FEE_PCT = 0.2;

export async function runBacktest({ pairId, from, to, threshold = 10, slPct = 1.5, tpPct = 3.0, directionFilter = null }) {
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
    const obdWindow   = snapshots.slice(Math.max(0, i - 24), i + 1);
    const trendWindow = snapshots.slice(Math.max(0, i - 120), i + 1);
    const detectedDir = detectSignalFromHistory(obdWindow, threshold, trendWindow);
    if (!detectedDir) continue;
    if (directionFilter && detectedDir !== directionFilter) continue;

    const snap = snapshots[i];
    const snapTime = snap.createdAt.getTime();
    if (snapTime - lastSignalAt < COOLDOWN) continue;
    lastSignalAt = snapTime;

    const entryPrice = snap.midPrice;
    const sl = detectedDir === 'LONG' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
    const tp = detectedDir === 'LONG' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);

    let outcome = 'TIMEOUT';
    let exitPrice = entryPrice;

    for (let j = i + 1; j < snapshots.length; j++) {
      const future = snapshots[j];
      if (future.createdAt.getTime() - snapTime > TIMEOUT) break;

      const p = future.midPrice;
      if (detectedDir === 'LONG') {
        if (p >= tp) { outcome = 'WIN'; exitPrice = tp; break; }
        if (p <= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
      } else {
        if (p <= tp) { outcome = 'WIN'; exitPrice = tp; break; }
        if (p >= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
      }
      exitPrice = p;
    }

    const rawPnl = detectedDir === 'LONG'
      ? (exitPrice - entryPrice) / entryPrice * 100
      : (entryPrice - exitPrice) / entryPrice * 100;

    // Вычитаем комиссию биржи (0.1% вход + 0.1% выход = 0.2% round-trip)
    const pnl = Math.round((rawPnl - ROUND_TRIP_FEE_PCT) * 100) / 100;

    if (outcome === 'TIMEOUT') {
      outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';
    }

    signals.push({ direction: detectedDir, entryPrice, exitPrice, sl, tp, outcome, pnl, createdAt: snap.createdAt });
  }

  const total = signals.length;
  const wins = signals.filter((s) => s.outcome === 'WIN').length;
  const losses = signals.filter((s) => s.outcome === 'LOSS').length;
  const totalPnl = signals.reduce((sum, s) => sum + s.pnl, 0);

  // Cumulative equity curve
  let equity = 0;
  const equityCurve = signals.map((s) => { equity += s.pnl; return Math.round(equity * 100) / 100; });

  // Max drawdown (peak-to-trough on equity curve)
  let peak = 0, maxDrawdown = 0;
  for (const val of equityCurve) {
    if (val > peak) peak = val;
    const dd = peak - val;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Max consecutive losses
  let maxConsecutiveLosses = 0, streak = 0;
  for (const s of signals) {
    if (s.outcome === 'LOSS') { streak++; if (streak > maxConsecutiveLosses) maxConsecutiveLosses = streak; }
    else streak = 0;
  }

  const feeTotalPct = Math.round(total * ROUND_TRIP_FEE_PCT * 100) / 100;

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
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxConsecutiveLosses,
      feeTotalPct,
    },
  };
}

/**
 * Parameter sweep — загружает снапшоты один раз на пару, перебирает
 * все комбинации threshold/SL/TP в памяти. Масштабируется на любой объём данных.
 */
export async function runOptimize({ pairIds = null, from, to, directionFilter = null }) {
  const THRESHOLDS = [5, 8, 10, 12, 15, 20];
  const SL_PCTS   = [0.3, 0.5, 0.7, 1.0];
  const TP_PCTS   = [1.0, 1.5, 2.0, 3.0];
  const COOLDOWN  = 90 * 60 * 1000;
  const TIMEOUT   = 60 * 60 * 1000;

  const pairFilter = pairIds?.length
    ? { id: { in: pairIds.map(Number) }, isActive: true }
    : { isActive: true };
  const pairs = await prisma.tradingPair.findMany({ where: pairFilter });

  const { detectSignalFromHistory } = await import('../indicators/engine.js');
  const results = [];

  for (const pair of pairs) {
    const snapshots = await prisma.obdSnapshot.findMany({
      where: { pairId: pair.id, createdAt: { gte: new Date(from), lte: new Date(to) } },
      orderBy: { createdAt: 'asc' },
      select: { obd1: true, obd2: true, obd3: true, obd4: true, midPrice: true, createdAt: true },
    });

    if (snapshots.length < 24) continue;

    // Для каждого threshold найти все сигнальные точки (один проход)
    for (const threshold of THRESHOLDS) {
      const signalPoints = [];
      let lastSignalAt = 0;

      for (let i = 24; i < snapshots.length; i++) {
        const obdWindow   = snapshots.slice(Math.max(0, i - 24), i + 1);
        const trendWindow = snapshots.slice(Math.max(0, i - 120), i + 1);
        const direction = detectSignalFromHistory(obdWindow, threshold, trendWindow);
        if (!direction) continue;
        if (directionFilter && direction !== directionFilter) continue;

        const snapTime = new Date(snapshots[i].createdAt).getTime();
        if (snapTime - lastSignalAt < COOLDOWN) continue;
        lastSignalAt = snapTime;
        signalPoints.push({ idx: i, direction, snap: snapshots[i], snapTime });
      }

      if (signalPoints.length === 0) continue;

      // Для каждой комбинации SL/TP оценить исходы в памяти
      for (const slPct of SL_PCTS) {
        for (const tpPct of TP_PCTS) {
          if (tpPct / slPct < 1.5) continue; // минимальный RR 1.5

          let wins = 0, losses = 0, totalPnl = 0;
          let equity = 0, eqPeak = 0, maxDrawdown = 0;
          let maxConsLosses = 0, consStreak = 0;

          for (const { idx, direction, snap, snapTime } of signalPoints) {
            const entry = snap.midPrice;
            const sl = direction === 'LONG' ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
            const tp = direction === 'LONG' ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);

            let outcome = 'TIMEOUT';
            let exitPrice = entry;

            for (let j = idx + 1; j < snapshots.length; j++) {
              if (snapshots[j].createdAt.getTime() - snapTime > TIMEOUT) break;
              const p = snapshots[j].midPrice;
              if (direction === 'LONG') {
                if (p >= tp) { outcome = 'WIN';  exitPrice = tp; break; }
                if (p <= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
              } else {
                if (p <= tp) { outcome = 'WIN';  exitPrice = tp; break; }
                if (p >= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
              }
              exitPrice = p;
            }

            const rawPnl = direction === 'LONG'
              ? (exitPrice - entry) / entry * 100
              : (entry - exitPrice) / entry * 100;

            // Вычитаем комиссию 0.2% round-trip
            const pnl = rawPnl - ROUND_TRIP_FEE_PCT;

            if (outcome === 'TIMEOUT') outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';
            if (outcome === 'WIN')  wins++;
            if (outcome === 'LOSS') losses++;
            totalPnl += pnl;

            // Drawdown tracking
            equity += pnl;
            if (equity > eqPeak) eqPeak = equity;
            const dd = eqPeak - equity;
            if (dd > maxDrawdown) maxDrawdown = dd;

            // Consecutive losses
            if (outcome === 'LOSS') { consStreak++; if (consStreak > maxConsLosses) maxConsLosses = consStreak; }
            else consStreak = 0;
          }

          const total = signalPoints.length;
          results.push({
            symbol: pair.monitorSymbol,
            pairId: pair.id,
            threshold,
            slPct,
            tpPct,
            total,
            wins,
            losses,
            winRate:    total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
            totalPnl:   Math.round(totalPnl * 100) / 100,
            avgPnl:     total > 0 ? Math.round((totalPnl / total) * 100) / 100 : 0,
            maxDrawdown: Math.round(maxDrawdown * 100) / 100,
            maxConsLosses,
          });
        }
      }
    }
  }

  results.sort((a, b) => b.totalPnl - a.totalPnl);
  return { results, combinations: results.length };
}

export async function getSignalStats(pairId = null, since = null) {
  const baseWhere = {};
  if (pairId) baseWhere.pairId = pairId;
  if (since) baseWhere.createdAt = { gte: since };

  // Count WAIT signals separately — they are AI filter decisions, not trades
  const waitTotal = await prisma.signal.count({
    where: { ...baseWhere, direction: 'WAIT' },
  });

  const where = { ...baseWhere, outcome: { not: null }, direction: { not: 'WAIT' } };

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

  // Последние 20 результатов для графика — только LONG/SHORT
  const recent = await prisma.signal.findMany({
    where: { outcome: { not: null }, direction: { not: 'WAIT' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, outcome: true, outcomePnl: true, direction: true, createdAt: true, pair: { select: { monitorSymbol: true } } },
  });

  return { total, wins, losses, breakeven, winRate, avgPnl, totalPnl: Math.round(totalPnl * 100) / 100, byPair, recent: recent.reverse(), waitTotal };
}
