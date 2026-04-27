import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { getSystemPrompt, getOfiSystemPrompt } from './prompts.js';
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
        model: 'claude-haiku-4-5',
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

function obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m) {
  if (atr15m?.pct != null && atr15m.pct < 0.15) {
    return `ATR(15m) ${atr15m.pct}% < 0.15% — рынок спит, не торгуем`;
  }
  if (ofiRatio >= 35 && ofiRatio <= 65) {
    return `OFI ratio ${ofiRatio}% в нейтральной зоне (35-65%) — не сигнал`;
  }
  if (
    trend5m?.direction === 'FLAT' &&
    trend15m?.direction === 'FLAT' &&
    atr15m?.pct != null && atr15m.pct < 0.30
  ) {
    return `Оба ТФ FLAT + ATR ${atr15m.pct}% < 0.30% — момента нет`;
  }
  return null;
}

function obviousWaitForObd(atr15m) {
  if (atr15m?.pct != null && atr15m.pct < 0.15) {
    return `ATR(15m) ${atr15m.pct}% < 0.15% — слишком низкая волатильность для OBD mean-reversion`;
  }
  return null;
}

// Комиссия Binance Spot round-trip
const ROUND_TRIP_FEE = 0.002; // 0.2%
// Минимальный чистый профит после комиссий
const MIN_NET_TP_PCT = 0.004; // 0.4%
// Минимальное соотношение чистый риск/профит
const MIN_NET_RR = 2.0;

/**
 * Проверяет и корректирует SL/TP с учётом комиссий.
 * - Если SL/TP перепутаны по направлению: ATR-fallback (1.5×ATR SL, 3.5×ATR TP) или WAIT если ATR нет
 * - Если чистый TP (после комиссий) < MIN_NET_TP_PCT → WAIT
 * - Если чистый RR < MIN_NET_RR → расширяем TP до минимально допустимого
 */
function validateSlTp(result, price, symbol = '', atr15m = null) {
  const { direction, suggestedSl, suggestedTp } = result;

  if (direction === 'WAIT') return result;

  const isLong = direction === 'LONG';

  // SL отсутствует — ATR-fallback или force WAIT (аналогично null TP)
  if (!suggestedSl) {
    if (!atr15m?.value || atr15m.value <= 0) {
      logger.warn('suggestedSl is null and no ATR available, forcing WAIT', { symbol, direction, price, suggestedTp });
      return { ...result, direction: 'WAIT', analysis: (result.analysis || '') + ' [Авто-WAIT: SL=null, ATR недоступен]' };
    }
    const slDist = 1.5 * atr15m.value;
    const effSlFallback = Math.round((isLong ? price - slDist : price + slDist) * 100) / 100;
    // WARNING-2: LONG ATR-fallback SL must stay positive
    if (isLong && effSlFallback <= 0) {
      logger.warn('ATR fallback produced non-positive SL for LONG, forcing WAIT', { symbol, direction, price, atr: atr15m.value, effSlFallback });
      return { ...result, direction: 'WAIT', analysis: (result.analysis || '') + ' [Авто-WAIT: ATR-fallback SL <= 0]' };
    }
    logger.warn('suggestedSl is null, using ATR fallback for SL', {
      symbol, direction, price, suggestedTp, atrSl: effSlFallback,
    });
    result = {
      ...result,
      suggestedSl: effSlFallback,
      analysis: (result.analysis || '') + ` [SL=null → ATR-fallback: SL=${effSlFallback}]`,
    };
  }

  let effSl = result.suggestedSl;
  let effTp = result.suggestedTp;

  // TP отсутствует, но SL есть — ATR-fallback только для TP
  if (!effTp) {
    if (!atr15m?.value || atr15m.value <= 0) {
      logger.warn('suggestedTp is null and no ATR available, forcing WAIT', { symbol, direction, price, suggestedSl });
      return { ...result, direction: 'WAIT', analysis: (result.analysis || '') + ' [Авто-WAIT: TP=null, ATR недоступен]' };
    }
    const tpDist = 3.5 * atr15m.value;
    effTp = Math.round((isLong ? price + tpDist : price - tpDist) * 100) / 100;
    // BLOCKING-2: SHORT ATR-fallback guard — price - 3.5×ATR must stay positive
    if (effTp <= 0) {
      logger.warn('ATR fallback produced non-positive TP for SHORT, forcing WAIT', { symbol, direction, price, atr: atr15m.value, effTp });
      return { ...result, direction: 'WAIT', analysis: (result.analysis || '') + ' [Авто-WAIT: ATR-fallback TP <= 0]' };
    }
    logger.warn('suggestedTp is null, using ATR fallback for TP', {
      symbol, direction, price, suggestedSl, atrTp: effTp,
    });
    result = {
      ...result,
      suggestedTp: effTp,
      analysis: (result.analysis || '') + ` [TP=null → ATR-fallback: TP=${effTp}]`,
    };
  }

  const slDist0 = isLong ? price - effSl : effSl - price;
  const tpDist0 = isLong ? effTp - price : price - effTp;

  if (slDist0 <= 0 || tpDist0 <= 0) {
    if (!atr15m?.value) {
      logger.warn('Invalid SL/TP direction, forcing WAIT', { direction, price, suggestedSl, suggestedTp });
      return { ...result, direction: 'WAIT', analysis: (result.analysis || '') + ' [Авто-WAIT: некорректные уровни SL/TP]' };
    }
    const slDist = 1.5 * atr15m.value;
    const tpDist = 3.5 * atr15m.value;
    effSl = Math.round((isLong ? price - slDist : price + slDist) * 100) / 100;
    effTp = Math.round((isLong ? price + tpDist : price - tpDist) * 100) / 100;
    logger.warn('Invalid SL/TP direction, using ATR fallback', {
      symbol, direction, price,
      originalSl: suggestedSl, originalTp: suggestedTp,
      atrSl: effSl, atrTp: effTp,
    });
    result = {
      ...result,
      suggestedSl: effSl,
      suggestedTp: effTp,
      analysis: (result.analysis || '') + ` [SL/TP заменены ATR-fallback: SL=${effSl}, TP=${effTp}]`,
    };
  }

  const tpPct   = (isLong ? effTp - price : price - effTp) / price;
  const slPct   = (isLong ? price - effSl : effSl - price) / price;
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
      analysis: `${result.analysis || ''} [Авто-WAIT: TP ${(tpPct * 100).toFixed(2)}% не покрывает комиссии 0.2% + минимум 0.4%]`,
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
      analysis: `${result.analysis || ''} [TP скорректирован ${effTp} → ${adjustedTp} для RR ≥ ${MIN_NET_RR} после комиссий]`,
    };
  }

  return result;
}

export async function analyzeOfiSignal(pair, currentPrice, ofiDirection, ofiRatio) {
  if (!anthropic) {
    return { direction: ofiDirection, confidence: null, analysis: 'Claude not configured', suggestedSl: null, suggestedTp: null };
  }
  const [systemPrompt, { trend5m, trend15m, atr15m }, candles] = await Promise.all([
    getOfiSystemPrompt(),
    fetchHigherTimeframes(pair.monitorSymbol),
    getKlines(pair.monitorSymbol, pair.timeframe || '1m', 20).catch(() => []),
  ]);

  const ofiPrefilterReason = obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m);
  if (ofiPrefilterReason) {
    logger.info('OFI signal pre-filtered as WAIT (no Claude call)', {
      symbol: pair.monitorSymbol,
      ofiRatio,
      reason: ofiPrefilterReason,
    });
    return {
      direction: 'WAIT',
      confidence: 0,
      analysis: `[Pre-filter] ${ofiPrefilterReason}`,
      suggestedSl: null,
      suggestedTp: null,
      rsi: null,
      trend5m: trend5m?.direction ?? null,
      trend15m: trend15m?.direction ?? null,
      atr: atr15m?.value ?? null,
      atrPct: atr15m?.pct ?? null,
    };
  }

  const tech = candles.length ? calcTechnicals(candles) : {};
  const techSection = formatTechnicals(tech);

  const atr15mLine = atr15m
    ? `ATR(14) на 15m: ${atr15m.value} (${atr15m.pct}% от цены)`
    : 'ATR(15m): н/д';

  const userMessage = `Пара: ${pair.monitorSymbol} → ${pair.tradeSymbol}
Цена: ${currentPrice}
OFI: ${ofiDirection}, ratio ${ofiRatio}%

Тренд: ${formatHigherTf(trend5m, trend15m)}
${techSection}
${atr15mLine}`;

  logger.info('Calling Claude for OFI signal analysis', {
    symbol: pair.monitorSymbol,
    price: currentPrice,
    ofiDirection,
    ofiRatio,
    rsi: tech.rsi,
    trend5m: trend5m?.direction,
    trend15m: trend15m?.direction,
  });

  const text = await callClaude(systemPrompt, userMessage);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : text.trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { direction: 'WAIT', confidence: 0, analysis: text, suggestedSl: null, suggestedTp: null };
  }

  const validated = validateSlTp(parsed, currentPrice, pair.monitorSymbol, atr15m);
  return {
    ...validated,
    rsi: tech.rsi ?? null,
    trend5m: trend5m?.direction ?? null,
    trend15m: trend15m?.direction ?? null,
    atr: atr15m?.value ?? null,
    atrPct: atr15m?.pct ?? null,
  };
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

  const obdPrefilterReason = obviousWaitForObd(atr15m);
  if (obdPrefilterReason) {
    logger.info('OBD signal pre-filtered as WAIT (no Claude call)', {
      symbol: pair.monitorSymbol,
      reason: obdPrefilterReason,
    });
    return {
      direction: 'WAIT',
      confidence: 0,
      analysis: `[Pre-filter] ${obdPrefilterReason}`,
      suggestedSl: null,
      suggestedTp: null,
      rsi: null,
      trend5m: trend5m?.direction ?? null,
      trend15m: trend15m?.direction ?? null,
      atr: atr15m?.value ?? null,
      atrPct: atr15m?.pct ?? null,
    };
  }

  const tech = calcTechnicals(candles);
  const techSection = formatTechnicals(tech);

  const atr15mLine = atr15m
    ? `ATR(14) на 15m: ${atr15m.value} (${atr15m.pct}% от цены) — ИСПОЛЬЗУЙ ДЛЯ РАСЧЁТА SL/TP`
    : 'ATR(15m): н/д';

  const userMessage = `Пара: ${pair.monitorSymbol} → ${pair.tradeSymbol}
Цена: ${currentPrice}
OBD: obd1=${obd.obd1} obd2=${obd.obd2} obd3=${obd.obd3} obd4=${obd.obd4}
Тренд: ${formatHigherTf(trend5m, trend15m)}
${techSection}
${atr15mLine}
Свечи ${pair.timeframe}: ${JSON.stringify(candles.slice(-20))}`;

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

  // Extract JSON object — handles plain JSON, ```json fences, and any surrounding text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : text.trim();

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

  const validated = validateSlTp(parsed, currentPrice, pair.monitorSymbol, atr15m);

  if (validated.direction !== parsed.direction || validated.suggestedTp !== parsed.suggestedTp) {
    logger.info('SL/TP post-validation applied', {
      symbol: pair.monitorSymbol,
      before: { direction: parsed.direction, tp: parsed.suggestedTp },
      after:  { direction: validated.direction, tp: validated.suggestedTp },
    });
  }

  return {
    ...validated,
    rsi: tech.rsi ?? null,
    trend5m: trend5m?.direction ?? null,
    trend15m: trend15m?.direction ?? null,
    atr: atr15m?.value ?? null,
    atrPct: atr15m?.pct ?? null,
  };
}
