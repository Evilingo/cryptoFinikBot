/**
 * Shared Claude analysis pipeline for OBD and OFI signals.
 * Handles: skip-check, entry price fetch, DB update (BUG-00 WAIT fix), broadcast, Telegram, auto-trade.
 */

import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { getMidPrice } from '../exchange/index.js';
import { broadcast } from '../../ws/hub.js';
import { sendTelegramNotification, formatSignalMessage } from '../notifications/notifier.js';

/**
 * @param {number} signalId
 * @param {object} pair
 * @param {number} midPrice - price at signal detection time
 * @param {object} opts
 * @param {function} opts.getAnalysis - async (skipClaude: boolean) => analysis object
 * @param {function} [opts.extraDbFields] - (analysis, entryPrice) => object of extra Signal fields
 * @param {object} [opts.broadcastExtra] - extra fields merged into SIGNAL_UPDATE broadcast
 * @param {function} opts.executeAutoTrade - passed to avoid circular import with engine.js
 */
export async function runClaudePipeline(signalId, pair, midPrice, {
  getAnalysis,
  extraDbFields = () => ({}),
  broadcastExtra = {},
  executeAutoTrade,
}) {
  try {
    const skipClaude = process.env.SKIP_CLAUDE_ANALYSIS === 'true';
    const analysis = await getAnalysis(skipClaude);

    let entryPrice = midPrice;
    if (analysis.direction !== 'WAIT') {
      try {
        entryPrice = await getMidPrice(pair.tradeSymbol);
        logger.info('Entry price updated after Claude', {
          symbol: pair.monitorSymbol,
          signalPrice: midPrice,
          entryPrice,
          drift: `${((entryPrice - midPrice) / midPrice * 100).toFixed(3)}%`,
        });
      } catch (err) {
        logger.warn('Failed to fetch entry price, using signal price', { error: err.message });
      }
    }

    await prisma.signal.update({
      where: { id: signalId },
      data: {
        direction: analysis.direction || 'WAIT',
        confidence: analysis.confidence != null ? Math.round(analysis.confidence) : null,
        claudeAnalysis: analysis.analysis || '',
        suggestedSl: analysis.suggestedSl,
        suggestedTp: analysis.suggestedTp,
        price: entryPrice,
        // BUG-00: mark WAIT signals immediately so tracker doesn't leave them as PENDING forever
        ...(analysis.direction === 'WAIT' ? { outcome: 'WAIT' } : {}),
        ...extraDbFields(analysis, entryPrice),
      },
    });

    logger.info(`Signal #${signalId} updated with Claude analysis`, {
      direction: analysis.direction,
      confidence: analysis.confidence,
      entryPrice,
    });

    const updated = {
      id: signalId,
      monitorSymbol: pair.monitorSymbol,
      tradeSymbol: pair.tradeSymbol,
      direction: analysis.direction,
      confidence: analysis.confidence,
      claudeAnalysis: analysis.analysis || '',
      suggestedSl: analysis.suggestedSl,
      suggestedTp: analysis.suggestedTp,
      price: entryPrice,
      ...broadcastExtra,
    };

    broadcast({ type: 'SIGNAL_UPDATE', signal: updated });

    if (analysis.direction !== 'WAIT') {
      sendTelegramNotification(formatSignalMessage(updated), analysis.confidence).catch(() => {});
      executeAutoTrade(signalId, pair, analysis, entryPrice).catch((err) => {
        logger.error(`Auto-trade failed for signal #${signalId}`, { error: err.message });
      });
    }
  } catch (err) {
    await prisma.signal.update({
      where: { id: signalId },
      data: { claudeAnalysis: `Claude error: ${err.message}` },
    }).catch(() => {});
    throw err;
  }
}
