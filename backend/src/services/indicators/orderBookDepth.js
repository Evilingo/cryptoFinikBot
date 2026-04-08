/**
 * OBD индикаторы — вычисление Depth Ratio по формуле:
 * Depth Ratio = bid_volume(X%) / (bid_volume(X%) + ask_volume(Y%)) * 100
 *
 * 4 индикатора с разными уровнями глубины:
 * OBD-1: bid 2.5% / ask 5%
 * OBD-2: bid 5%   / ask 10%
 * OBD-3: bid 5%   / ask 25%
 * OBD-4: bid 10%  / ask 25%
 */

const OBD_LEVELS = [
  { name: 'obd1', bidPct: 2.5, askPct: 5 },
  { name: 'obd2', bidPct: 5, askPct: 10 },
  { name: 'obd3', bidPct: 5, askPct: 25 },
  { name: 'obd4', bidPct: 10, askPct: 25 },
];

function volumeInRange(levels, midPrice, pct, isBid) {
  const boundary = isBid
    ? midPrice * (1 - pct / 100)
    : midPrice * (1 + pct / 100);

  let total = 0;
  for (const [priceStr, qtyStr] of levels) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (isBid && price < boundary) break;
    if (!isBid && price > boundary) break;
    total += qty;
  }
  return total;
}

export function calculateObd(bids, asks, midPrice) {
  const result = {};

  for (const level of OBD_LEVELS) {
    const bidVol = volumeInRange(bids, midPrice, level.bidPct, true);
    const askVol = volumeInRange(asks, midPrice, level.askPct, false);
    const total = bidVol + askVol;
    result[level.name] = total > 0
      ? Math.round((bidVol / total) * 10000) / 100
      : 50;
  }

  return result;
}
