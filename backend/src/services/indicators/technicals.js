/**
 * Технические индикаторы, вычисляемые из массива свечей перед вызовом Claude.
 * Свеча: { t, o, h, l, c, v }
 */

/**
 * RSI(14) — индекс относительной силы.
 * Возвращает число 0–100 или null если данных меньше 15.
 */
export function calcRsi(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const closes = candles.map((c) => c.c);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder's smoothing для оставшихся свечей
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/**
 * ATR(14) — средний истинный диапазон (волатильность).
 * Возвращает абсолютное значение и % от последней цены закрытия.
 */
export function calcAtr(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  // Начальный ATR — простое среднее
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;

  // Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  const lastClose = candles[candles.length - 1].c;
  return {
    value: Math.round(atr * 10000) / 10000,
    pct: Math.round((atr / lastClose) * 10000) / 100, // % от цены
  };
}

/**
 * Объёмный тренд — сравнивает средний объём последних N свечей с предыдущими N.
 * Возвращает: { direction: 'RISING'|'FALLING'|'FLAT', changePct }
 */
export function calcVolumeTrend(candles, window = 5) {
  if (candles.length < window * 2) return null;

  const recent = candles.slice(-window);
  const previous = candles.slice(-window * 2, -window);

  const avgRecent = recent.reduce((s, c) => s + c.v, 0) / window;
  const avgPrev = previous.reduce((s, c) => s + c.v, 0) / window;

  if (avgPrev === 0) return null;

  const changePct = Math.round(((avgRecent - avgPrev) / avgPrev) * 10000) / 100;

  let direction;
  if (changePct > 10) direction = 'RISING';
  else if (changePct < -10) direction = 'FALLING';
  else direction = 'FLAT';

  return { direction, changePct };
}

/**
 * Анализ последних N свечей — тип тела (bullish/bearish/doji).
 */
export function analyzeRecentCandles(candles, count = 3) {
  const recent = candles.slice(-count);
  return recent.map((c) => {
    const body = c.c - c.o;
    const range = c.h - c.l;
    const bodyRatio = range > 0 ? Math.abs(body) / range : 0;

    let type;
    if (bodyRatio < 0.15) type = 'doji';
    else if (body > 0) type = 'bullish';
    else type = 'bearish';

    return {
      type,
      bodyPct: Math.round(bodyRatio * 100), // тело как % от полного диапазона
      close: c.c,
    };
  });
}

/**
 * Направление тренда по свечам.
 * Сравнивает среднее закрытие первой и последней трети свечей.
 * Возвращает: { direction: 'UP'|'DOWN'|'FLAT', changePct }
 */
export function calcTrend(candles) {
  if (candles.length < 6) return null;

  const third = Math.floor(candles.length / 3);
  const firstAvg = candles.slice(0, third).reduce((s, c) => s + c.c, 0) / third;
  const lastAvg = candles.slice(-third).reduce((s, c) => s + c.c, 0) / third;

  const changePct = Math.round(((lastAvg - firstAvg) / firstAvg) * 10000) / 100;

  let direction;
  if (changePct > 0.2) direction = 'UP';
  else if (changePct < -0.2) direction = 'DOWN';
  else direction = 'FLAT';

  return { direction, changePct };
}

/**
 * Собирает все метрики в один объект для передачи в Claude.
 */
export function calcTechnicals(candles) {
  return {
    rsi: calcRsi(candles),
    atr: calcAtr(candles),
    volumeTrend: calcVolumeTrend(candles),
    recentCandles: analyzeRecentCandles(candles, 3),
  };
}
