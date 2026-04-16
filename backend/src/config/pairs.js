export const BINANCE_PAIRS = [
  { monitor: 'BTCUSDC', trade: 'BTCUSDT', base: 'BTC' },
  { monitor: 'BNBUSDC', trade: 'BNBUSDT', base: 'BNB' },
  { monitor: 'SOLUSDC', trade: 'SOLUSDT', base: 'SOL' },
  { monitor: 'ETHUSDC', trade: 'ETHUSDT', base: 'ETH' },
];

export const BYBIT_PAIRS = [
  { monitor: 'BTCUSDT', trade: 'BTCUSDT', base: 'BTC' },
  { monitor: 'BNBUSDT', trade: 'BNBUSDT', base: 'BNB' },
  { monitor: 'SOLUSDT', trade: 'SOLUSDT', base: 'SOL' },
  { monitor: 'ETHUSDT', trade: 'ETHUSDT', base: 'ETH' },
];

// Backward compat — defaults to Binance pairs
export const tradingPairs = BINANCE_PAIRS;
