import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { getSystemPrompt } from './prompts.js';
import { calcTechnicals, calcTrend, calcAtr } from '../indicators/technicals.js';
import { getKlines } from '../exchange/index.js';
import { logger } from '../../config/logger.js';

const anthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 20000];

async function callClaude(systemPrompt, userMessage) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      return response.content[0].text;
    } catch (err) {
      const isRetryable =
        err.message?.includes('529') ||
        err.message?.includes('Overloaded') ||
        err.message?.includes('Connection error') ||
        err.message?.includes('timeout') ||
        err.status === 529 ||
        err.status === 503;

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt];
        logger.warn(`Claude retry ${attempt + 1}/${MAX_RETRIES} in ${delay / 1000}s`, {
          error: err.message,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

function formatTechnicals(tech) {
  const lines = [];

  if (tech.rsi != null) {
    let rsiZone;
    if (tech.rsi >= 70) rsiZone = 'перекуплен';
    else if (tech.rsi <= 30) rsiZone = 'перепродан';
    else rsiZone = 'нейтральная зона';
    lines.push(`RSI(14): ${tech.rsi} — ${rsiZone}`);
  }

  if (tech.atr) {
    lines.push(`ATR(14): ${tech.atr.value} (${tech.atr.pct}% от цены) — текущая волатильность`);
  }

  if (tech.volumeTrend) {
    const { direction, changePct } = tech.volumeTrend;
    const sign = changePct > 0 ? '+' : '';
    lines.push(`Объёмный тренд: ${direction} (${sign}${changePct}% к предыдущим 5 свечам)`);
  }

  if (tech.recentCandles?.length) {
    const desc = tech.recentCandles.map((c, i) => {
      const pos = i === tech.recentCandles.length - 1 ? 'последняя' : `−${tech.recentCandles.length - 1 - i}`;
      return `${pos}: ${c.type} (тело ${c.bodyPct}% диапазона, закр. ${c.close})`;
    });
    lines.push(`Последние ${tech.recentCandles.length} свечи:\n  ${desc.join('\n  ')}`);
  }

  return lines.join('\n');
}

async function fetchHigherTimeframes(symbol) {
  const [candles5m, candles15m] = await Promise.allSettled([
    getKlines(symbol, '5m', 20),
    getKlines(symbol, '15m', 30), // 30 свечей чтобы хватило на ATR(14)
  ]);
  const c15m = candles15m.status === 'fulfilled' ? candles15m.value : null;
  return {
    trend5m:  candles5m.status === 'fulfilled' ? calcTrend(candles5m.value) : null,
    trend15m: c15m ? calcTrend(c15m) : null,
    atr15m:   c15m ? calcAtr(c15m) : null,
  };
}

function formatHigherTf(trend5m, trend15m) {
  const fmt = (tf, t) => {
    if (!t) return `${tf}: н/д`;
    const sign = t.changePct > 0 ? '+' : '';
    return `${tf}: ${t.direction} (${sign}${t.changePct}%)`;
  };
  return `${fmt('5m', trend5m)} | ${fmt('15m', trend15m)}`;
}

// Комиссия Binance Spot round-trip
const ROUND_TRIP_FEE = 0.002; // 0.2%
// Минимальный чистый профит после комиссий
const MIN_NET_TP_PCT = 0.004; // 0.4%
// Минимальное соотношение чистый риск/профит
const MIN_NET_RR = 2.0;

/**
 * Проверяет и корректирует SL/TP с учётом комиссий.
 * - Если чистый TP (после комиссий) < MIN_NET_TP_PCT → WAIT
 * - Если чистый RR < MIN_NET_RR → расширяем TP до минимально допустимого
 */
function validateSlTp(result, price, symbol = '') {
  const { direction, suggestedSl, suggestedTp } = result;

  if (direction === 'WAIT' || !suggestedSl || !suggestedTp) return result;

  const isLong = direction === 'LONG';
  const tpDist = isLong ? suggestedTp - price : price - suggestedTp;
  const slDist = isLong ? price - suggestedSl : suggestedSl - price;

  if (tpDist <= 0 || slDist <= 0) {
    logger.warn('Invalid SL/TP direction, forcing WAIT', { direction, price, suggestedSl, suggestedTp });
    return { ...result, direction: 'WAIT', analysis: result.analysis + ' [Авто-WAIT: некорректные уровни SL/TP]' };
  }

  const tpPct   = tpDist / price;
  const slPct   = slDist / price;
  const netTpPct = tpPct - ROUND_TRIP_FEE;
  const netSlPct = slPct + ROUND_TRIP_FEE;

  // TP слишком мал — сигнал не окупает комиссии
  if (netTpPct < MIN_NET_TP_PCT) {
    logger.info('Signal auto-WAIT: TP too small after fees', {
      symbol,
      tpPct: (tpPct * 100).toFixed(3) + '%',
      netTpPct: (netTpPct * 100).toFixed(3) + '%',
      min: (MIN_NET_TP_PCT * 100) + '%',
    });
    return {
      ...result,
      direction: 'WAIT',
      analysis: `${result.analysis} [Авто-WAIT: TP ${(tpPct * 100).toFixed(2)}% не покрывает комиссии 0.2% + минимум 0.4%]`,
    };
  }

  // RR слишком низкий — расширяем TP
  const netRR = netTpPct / netSlPct;
  if (netRR < MIN_NET_RR) {
    // Минимальный TP: net_TP = MIN_NET_RR × net_SL → tp_dist = (MIN_NET_RR × net_SL + fee) × price
    const minTpDist = (MIN_NET_RR * netSlPct + ROUND_TRIP_FEE) * price;
    const adjustedTp = isLong
      ? Math.round((price + minTpDist) * 100) / 100
      : Math.round((price - minTpDist) * 100) / 100;

    logger.info('TP adjusted for minimum net RR', {
      symbol,
      originalTp: suggestedTp,
      adjustedTp,
      originalNetRR: netRR.toFixed(2),
      targetNetRR: MIN_NET_RR,
    });

    return {
      ...result,
      suggestedTp: adjustedTp,
      analysis: `${result.analysis} [TP скорректирован ${suggestedTp} → ${adjustedTp} для RR ≥ ${MIN_NET_RR} после комиссий]`,
    };
  }

  return result;
}

export async function analyzeSignal(pair, obd, candles, currentPrice) {
  if (!anthropic) {
    logger.info('Claude API key not configured, skipping analysis', { symbol: pair.monitorSymbol });
    return { direction: 'LONG', confidence: null, analysis: 'Claude not configured', suggestedSl: null, suggestedTp: null };
  }
  const [systemPrompt, { trend5m, trend15m, atr15m }] = await Promise.all([
    getSystemPrompt(),
    fetchHigherTimeframes(pair.monitorSymbol),
  ]);

  const tech = calcTechnicals(candles);
  const techSection = formatTechnicals(tech);

  const atr15mLine = atr15m
    ? `ATR(14) на 15m: ${atr15m.value} (${atr15m.pct}% от цены) — ИСПОЛЬЗУЙ ДЛЯ РАСЧЁТА SL/TP`
    : 'ATR(15m): н/д';

  const userMessage = `Пара для анализа: ${pair.monitorSymbol} (сигнал), торговля через ${pair.tradeSymbol}
Текущая цена: ${currentPrice}

Order Book Depth индикаторы (0-100, >50 = давление покупателей):
- OBD 2.5%/5%: ${obd.obd1}
- OBD 5%/10%: ${obd.obd2}
- OBD 5%/25%: ${obd.obd3}
- OBD 10%/25%: ${obd.obd4}

Тренд на старших таймфреймах (последние 20 свечей):
${formatHigherTf(trend5m, trend15m)}

Технические индикаторы (${pair.timeframe}):
${techSection}

Размер для SL/TP (15m таймфрейм):
${atr15mLine}

Последние 20 свечей OHLCV (таймфрейм ${pair.timeframe}):
${JSON.stringify(candles.slice(-20))}

На основе данных дай ответ строго в JSON:
{
  "direction": "LONG" | "SHORT" | "WAIT",
  "confidence": 0-100,
  "analysis": "краткое объяснение (2-3 предложения)",
  "suggestedSl": число или null,
  "suggestedTp": число или null
}`;

  logger.info('Calling Claude for signal analysis', {
    symbol: pair.monitorSymbol,
    price: currentPrice,
    rsi: tech.rsi,
    volumeTrend: tech.volumeTrend?.direction,
    atr1mPct: tech.atr?.pct,
    atr15mPct: atr15m?.pct,
    trend5m: trend5m?.direction,
    trend15m: trend15m?.direction,
  });

  const text = await callClaude(systemPrompt, userMessage);
  logger.debug('Claude response', { text });

  // Strip markdown code fences if Claude wraps response in ```json ... ```
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logger.error('Failed to parse Claude response as JSON', { text });
    return {
      direction: 'WAIT',
      confidence: 0,
      analysis: text,
      suggestedSl: null,
      suggestedTp: null,
    };
  }

  const validated = validateSlTp(parsed, currentPrice, pair.monitorSymbol);

  if (validated.direction !== parsed.direction || validated.suggestedTp !== parsed.suggestedTp) {
    logger.info('SL/TP post-validation applied', {
      symbol: pair.monitorSymbol,
      before: { direction: parsed.direction, tp: parsed.suggestedTp },
      after:  { direction: validated.direction, tp: validated.suggestedTp },
    });
  }

  return validated;
}
