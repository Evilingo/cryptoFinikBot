/**
 * TRADE-03 — Reconciliation job
 * Runs every 5 minutes. Finds OPEN trades where the exit order
 * was filled on Bybit but the fill event was missed by userDataStream.
 */

import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { getOrderHistory } from './rest.js';
import { sendTelegramNotification } from '../notifications/notifier.js';
import { broadcast } from '../../ws/hub.js';

export async function reconcileOpenTrades() {
  // Skip if API keys not configured
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.bybitApiKey || !settings?.bybitSecret) {
    logger.debug('[Reconciliation] Skipped: Bybit API keys not configured');
    return;
  }

  const openTrades = await prisma.trade.findMany({ where: { status: 'OPEN' } });
  if (openTrades.length === 0) return;

  logger.debug(`[Reconciliation] Checking ${openTrades.length} open trade(s)`);

  for (const trade of openTrades) {
    try {
      const data = await getOrderHistory(trade.symbol);
      const orders = data.result?.list || [];

      // Look for a filled TP or SL exit order linked to this trade
      const idSuffix = String(trade.binanceOrderId).slice(-28);
      const exitOrder = orders.find((o) =>
        o.orderStatus === 'Filled' &&
        (o.orderLinkId === `tp-${idSuffix}` || o.orderLinkId === `sl-${idSuffix}`)
      );

      if (!exitOrder) continue;

      const exitPrice = parseFloat(exitOrder.avgPrice);
      const entryPrice = trade.price;

      // Guard: skip if entry price is zero to avoid NaN/Infinity in PnL
      if (!entryPrice || entryPrice === 0) {
        logger.warn('[Reconciliation] Skipping trade with zero entry price', { tradeId: trade.id, symbol: trade.symbol });
        continue;
      }

      const pnl = (trade.side === 'BUY'
        ? ((exitPrice - entryPrice) / entryPrice)
        : ((entryPrice - exitPrice) / entryPrice)) * 100 - 0.2;

      const roundedPnl = Math.round(pnl * 100) / 100;
      const outcome = roundedPnl > 0.1 ? 'WIN' : roundedPnl < -0.1 ? 'LOSS' : 'BREAKEVEN';

      // Race condition guard: only close if still OPEN
      const updated = await prisma.trade.updateMany({
        where: { id: trade.id, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          pnl: roundedPnl,
          closedAt: new Date(parseInt(exitOrder.updatedTime)),
        },
      });

      if (updated.count === 0) {
        logger.debug('[Reconciliation] Trade already closed by userDataStream, skipping', { tradeId: trade.id });
        continue;
      }

      if (trade.signalId) {
        await prisma.signal.updateMany({
          where: { id: trade.signalId, outcome: null },
          data: {
            outcome,
            outcomePnl: roundedPnl,
            outcomePrice: exitPrice,
            outcomeAt: new Date(parseInt(exitOrder.updatedTime)),
          },
        });
        broadcast({
          type: 'SIGNAL_OUTCOME',
          signalId: trade.signalId,
          symbol: trade.symbol,
          outcome,
          pnl: roundedPnl,
          outcomePrice: exitPrice,
        });
      }

      logger.info('[Reconciliation] Closed missed trade', {
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        entryPrice,
        exitPrice,
        pnl: roundedPnl,
        outcome,
        orderLinkId: exitOrder.orderLinkId,
      });

      sendTelegramNotification(
        `🔄 Reconciled: ${trade.symbol} ${trade.side} — ${roundedPnl > 0 ? 'WIN' : 'LOSS'} ${roundedPnl.toFixed(2)}%`,
        null,
      ).catch(() => {});
    } catch (err) {
      logger.warn('[Reconciliation] Failed to check trade', {
        tradeId: trade.id,
        symbol: trade.symbol,
        error: err.message,
      });
    }
  }
}
