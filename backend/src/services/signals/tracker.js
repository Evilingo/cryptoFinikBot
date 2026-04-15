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
