/**
 * OBD индикаторы — Order Book Imbalance по количеству уровней.
 *
 * Binance REST depth API возвращает уровни близко к спреду (~0.1-0.5% диапазон
 * даже с limit=5000), поэтому процентные диапазоны (2.5%-25%) давали одинаковые
 * значения для всех 4 индикаторов. Решение: измерять imbalance по первым N уровням.
 *
 * OBD-1: топ-100 уровней  — давление у спреда (HFT/маркет-мейкеры)
 * OBD-2: топ-300 уровней  — ближняя зона
 * OBD-3: топ-800 уровней  — средняя глубина
 * OBD-4: топ-2000 уровней — широкая глубина
 *
 * Формула: bidVol / (bidVol + askVol) * 100  →  0-100, >50 = давление покупателей
 *
 * Bybit spot максимум 200 уровней — используй BYBIT_OBD_LEVELS:
 * OBD-1: 25, OBD-2: 50, OBD-3: 100, OBD-4: 200
 */

export const BINANCE_OBD_LEVELS = [
  { name: 'obd1', levels: 100 },
  { name: 'obd2', levels: 300 },
  { name: 'obd3', levels: 800 },
  { name: 'obd4', levels: 2000 },
];

// Backward-compat alias
export const OBD_LEVELS = BINANCE_OBD_LEVELS;

function volumeAtLevels(entries, count) {
  let total = 0;
  const limit = Math.min(count, entries.length);
  for (let i = 0; i < limit; i++) {
    total += parseFloat(entries[i][1]);
  }
  return total;
}

/**
 * Calculate Order Book Depth indicators.
 * @param {Array} bids - sorted bids (highest price first), [[price, qty], ...]
 * @param {Array} asks - sorted asks (lowest price first), [[price, qty], ...]
 * @param {number} midPrice - current mid price
 * @param {Array} levels - optional custom level config (defaults to Binance 100/300/800/2000)
 * @returns {{ obd1, obd2, obd3, obd4 }}
 */
export function calculateObd(bids, asks, midPrice, levels = BINANCE_OBD_LEVELS) {
  const result = {};
  for (const level of levels) {
    const bidVol = volumeAtLevels(bids, level.levels);
    const askVol = volumeAtLevels(asks, level.levels);
    const total = bidVol + askVol;
    result[level.name] = total > 0
      ? Math.round((bidVol / total) * 10000) / 100
      : 50;
  }
  return result;
}
