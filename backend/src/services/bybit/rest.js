import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { decrypt } from '../../config/crypto.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

const BASE_URL = env.bybitTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
const RECV_WINDOW = '5000';

async function getKeys() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.bybitApiKey || !settings?.bybitSecret) {
    throw new Error('Bybit API keys not configured');
  }
  return {
    apiKey: decrypt(settings.bybitApiKey),
    secret: decrypt(settings.bybitSecret),
  };
}

function sign(secret, timestamp, apiKey, recvWindow, payload) {
  const signStr = timestamp + apiKey + recvWindow + payload;
  return crypto.createHmac('sha256', secret).update(signStr).digest('hex');
}

async function privateGet(path, params = {}) {
  const { apiKey, secret } = await getKeys();
  const timestamp = Date.now().toString();
  const queryString = new URLSearchParams(params).toString();
  const signature = sign(secret, timestamp, apiKey, RECV_WINDOW, queryString);

  const url = queryString
    ? `${BASE_URL}${path}?${queryString}`
    : `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    },
  });

  if (!res.ok) {
    let errMsg = `Bybit HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.retMsg) errMsg = `Bybit error ${data.retCode}: ${data.retMsg}`;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  if (data.retCode !== 0) {
    throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);
  }
  return data;
}

async function privatePost(path, body = {}) {
  const { apiKey, secret } = await getKeys();
  const timestamp = Date.now().toString();
  const rawBody = JSON.stringify(body);
  const signature = sign(secret, timestamp, apiKey, RECV_WINDOW, rawBody);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    },
    body: rawBody,
  });

  if (!res.ok) {
    let errMsg = `Bybit HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.retMsg) errMsg = `Bybit error ${data.retCode}: ${data.retMsg}`;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  if (data.retCode !== 0) {
    throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);
  }
  return data;
}

export async function getAccountBalance() {
  // Try UNIFIED first, fall back to SPOT
  let data;
  try {
    data = await privateGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
  } catch (err) {
    logger.warn('Bybit UNIFIED balance failed, trying SPOT', { error: err.message });
    data = await privateGet('/v5/account/wallet-balance', { accountType: 'SPOT' });
  }

  const coins = data.result?.list?.[0]?.coin || [];
  return coins
    .filter((c) => parseFloat(c.walletBalance || c.availableToWithdraw || 0) > 0)
    .map((c) => ({
      asset: c.coin,
      free: c.walletBalance || c.availableToWithdraw || '0',
      locked: c.locked || '0',
    }));
}

export async function getOrderBook(symbol, limit = 200) {
  // Bybit max OB depth for spot is 200
  const clampedLimit = Math.min(limit, 200);
  const url = `${BASE_URL}/v5/market/orderbook?category=spot&symbol=${symbol}&limit=${clampedLimit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit orderbook error: ${res.status}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);

  const { b: bids, a: asks, u: lastUpdateId } = data.result;
  return { bids, asks, lastUpdateId };
}

export async function getMidPrice(symbol) {
  const url = `${BASE_URL}/v5/market/tickers?category=spot&symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit tickers error: ${res.status}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);

  const ticker = data.result?.list?.[0];
  if (!ticker) throw new Error(`No ticker data for ${symbol}`);

  const bid = parseFloat(ticker.bid1Price);
  const ask = parseFloat(ticker.ask1Price);
  return (bid + ask) / 2;
}

const INTERVAL_MAP = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
};

export async function getKlines(symbol, interval = '1m', limit = 100) {
  const bybitInterval = INTERVAL_MAP[interval] || '1';
  const url = `${BASE_URL}/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit klines error: ${res.status}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);

  // Bybit returns newest first — reverse before returning
  // Format: [startTime, open, high, low, close, volume, turnover]
  const list = data.result?.list || [];
  return list.reverse().map((k) => ({
    t: parseInt(k[0]),
    o: parseFloat(k[1]),
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
    v: parseFloat(k[5]),
    T: parseInt(k[0]) + (getIntervalMs(bybitInterval) - 1),
  }));
}

function getIntervalMs(bybitInterval) {
  const map = {
    '1': 60000,
    '3': 180000,
    '5': 300000,
    '15': 900000,
    '30': 1800000,
    '60': 3600000,
    '120': 7200000,
    '240': 14400000,
    '360': 21600000,
    '720': 43200000,
    'D': 86400000,
    'W': 604800000,
  };
  return map[bybitInterval] || 60000;
}

// Cache symbol precision info
const symbolInfoCache = new Map();

async function getSymbolInfo(symbol) {
  if (symbolInfoCache.has(symbol)) return symbolInfoCache.get(symbol);

  const url = `${BASE_URL}/v5/market/instruments-info?category=spot&symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit instruments-info error: ${res.status}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);

  const info = data.result?.list?.[0];
  if (!info) throw new Error(`Symbol ${symbol} not found on Bybit`);

  const tickSize = info.priceFilter?.tickSize || '0.01';
  const basePrecision = info.lotSizeFilter?.basePrecision || '0.001';

  const result = {
    pricePrecision: countDecimals(tickSize),
    qtyPrecision: countDecimals(basePrecision),
  };

  symbolInfoCache.set(symbol, result);
  return result;
}

function countDecimals(str) {
  const s = parseFloat(str).toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function formatNum(value, precision) {
  return parseFloat(value).toFixed(precision);
}

export async function placeOrder({ symbol, side, quantity, stopLoss, takeProfit }) {
  const info = await getSymbolInfo(symbol);
  const qtyStr = formatNum(quantity, info.qtyPrecision);
  const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';

  const body = {
    category: 'spot',
    symbol,
    side: bybitSide,
    orderType: 'Market',
    qty: qtyStr,
    marketUnit: 'baseCoin',
  };

  if (stopLoss) body.stopLoss = formatNum(stopLoss, info.pricePrecision);
  if (takeProfit) body.takeProfit = formatNum(takeProfit, info.pricePrecision);

  let orderData;
  try {
    orderData = await privatePost('/v5/order/create', body);
  } catch (err) {
    // TP/SL may fail on non-UTA accounts — retry without them
    if (stopLoss || takeProfit) {
      logger.warn('Bybit order with TP/SL failed, retrying without', { error: err.message, symbol });
      const bodyNoTpSl = { category: 'spot', symbol, side: bybitSide, orderType: 'Market', qty: qtyStr, marketUnit: 'baseCoin' };
      orderData = await privatePost('/v5/order/create', bodyNoTpSl);
      logger.warn('Order placed without TP/SL — manage exit manually', { symbol });
    } else {
      throw err;
    }
  }

  const orderId = orderData.result?.orderId;
  logger.info('Bybit market order placed', { symbol, side, orderId });

  // Wait 300ms then fetch avg price from order history
  await new Promise((r) => setTimeout(r, 300));
  let avgPrice = 0;
  try {
    const histData = await privateGet('/v5/order/history', { category: 'spot', orderId });
    const order = histData.result?.list?.[0];
    if (order?.avgPrice) avgPrice = parseFloat(order.avgPrice);
  } catch (err) {
    logger.warn('Failed to fetch Bybit order avgPrice', { error: err.message, orderId });
  }

  return {
    orderId: String(orderId),
    price: avgPrice,
    type: (stopLoss || takeProfit) ? 'MARKET+TPSL' : 'MARKET',
  };
}

/**
 * Query the current API key's permissions from Bybit.
 * Returns { canRead, canTrade, permissions }
 */
export async function queryApiPermissions() {
  const data = await privateGet('/v5/user/query-api');
  const perms = data.result?.permissions || {};
  // Bybit returns permissions as { ContractTrade: [], SpotTrade: ['Order'], ... }
  const spotTrade = Array.isArray(perms.SpotTrade) ? perms.SpotTrade : [];
  const contractTrade = Array.isArray(perms.ContractTrade) ? perms.ContractTrade : [];
  const wallet = Array.isArray(perms.Wallet) ? perms.Wallet : [];

  const canTrade = spotTrade.length > 0 || contractTrade.length > 0;
  const canRead = wallet.length > 0 || spotTrade.length > 0 || contractTrade.length > 0;

  return {
    canRead,
    canTrade,
    spotTrade,
    contractTrade,
    wallet,
    readOnly: data.result?.readOnly === 1,
    ips: data.result?.ips || [],
  };
}

// Stubs — Bybit uses WS auth (not listenKey)
export async function createListenKey() {
  return null;
}

export async function keepAliveListenKey() {
  // no-op
}

export async function deleteListenKey() {
  // no-op
}
