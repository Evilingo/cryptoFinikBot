export const calcSlPrice = (price, side, slPct) =>
  price * (side === 'BUY' ? (1 - slPct / 100) : (1 + slPct / 100));

export const calcTpPrice = (price, side, tpPct) =>
  price * (side === 'BUY' ? (1 + tpPct / 100) : (1 - tpPct / 100));
