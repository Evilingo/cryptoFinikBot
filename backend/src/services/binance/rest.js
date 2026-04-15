import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { decrypt } from '../../config/crypto.js';
import { logger } from '../../config/logger.js';

// data-api.binance.vision — публичный API без геоблокировки (для market data)
// api.binance.com — для приватных запросов (торговля) — нужен иностранный IP
const DATA_URL = 'https://data-api.binance.vision';
const TRADE_URL = process.env.BINANCE_TESTNET === 'true'
  ? 'https://testnet.binance.vision'
  : 'https://api.binance.com';

if (process.env.BINANCE_TESTNET === 'true') {
  console.log('[Binance] TESTNET mode active:', TRADE_URL);
}

async function getKeys() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.binanceApiKey || !settings?.binanceSecret) {
    throw new Error('Binance API keys not configured');
  }
  return {
    apiKey: decrypt(settings.binanceApiKey),
    secret: decrypt(settings.binanceSecret),
  };
}

function sign(params, secret) {
  const qs = new URLSearchParams(params).toString();
  const signature = crypto.createHmac('sha256', secret).update(qs).digest('hex');
  return qs + '&signature=' + signature;
}

async function privateRequest(method, path, params = {}) {
  const { apiKey, secret } = await getKeys();
  params.timestamp = Date.now().toString();
  params.recvWindow = '5000';

  const query = sign(params, secret);
  const url = `${TRADE_URL}${path}?${query}`;

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': apiKey },
  });

  if (!res.ok) {
    let errMsg = `Binance HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.msg) errMsg = `Binance error ${data.code}: ${data.msg}`;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  if (data.code && data.code < 0) {
    throw new Error(`Binance error ${data.code}: ${data.msg}`);
  }
  return data;
}

export async function getAccountBalance() {
  const data = await privateRequest('GET', '/api/v3/account');
  return data.balances.filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
}

export async function getOrderBook(symbol, limit = 1000) {
  const url = `${DATA_URL}/api/v3/depth?symbol=${symbol}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance depth error: ${res.status}`);
  return res.json();
}

export async function getMidPrice(symbol) {
  const url = `${DATA_URL}/api/v3/ticker/bookTicker?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance bookTicker error: ${res.status}`);
  const { bidPrice, askPrice } = await res.json();
  return (parseFloat(bidPrice) + parseFloat(askPrice)) / 2;
}

export async function getKlines(symbol, interval = '1m', limit = 100) {
  const url = `${DATA_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
  const data = await res.json();
  return data.map((k) => ({
    t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
    l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]), T: k[6],
  }));
}

// Cache symbol info for price/qty precision
const symbolInfoCache = new Map();

async function getSymbolInfo(symbol) {
  if (symbolInfoCache.has(symbol)) return symbolInfoCache.get(symbol);

  const url = `${DATA_URL}/api/v3/exchangeInfo?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`exchangeInfo error: ${res.status}`);
  const data = await res.json();
  const info = data.symbols?.[0];
  if (!info) throw new Error(`Symbol ${symbol} not found`);

  const priceFilter = info.filters.find((f) => f.filterType === 'PRICE_FILTER');
  const lotFilter = info.filters.find((f) => f.filterType === 'LOT_SIZE');

  const result = {
    pricePrecision: countDecimals(priceFilter?.tickSize || '0.01'),
    qtyPrecision: countDecimals(lotFilter?.stepSize || '0.001'),
  };

  symbolInfoCache.set(symbol, result);
  return result;
}

function countDecimals(str) {
  const s = parseFloat(str).toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function formatPrice(price, precision) {
  return parseFloat(price).toFixed(precision);
}

// User Data Stream — no signature needed, only API key header
async function keyOnlyRequest(method, path, params = {}) {
  const { apiKey } = await getKeys();
  const query = new URLSearchParams(params).toString();
  const url = query ? `${TRADE_URL}${path}?${query}` : `${TRADE_URL}${path}`;
  const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': apiKey } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Binance error: ${data.msg || res.status}`);
  }
  return res.json();
}

export async function createListenKey() {
  const data = await keyOnlyRequest('POST', '/api/v3/userDataStream');
  return data.listenKey;
}

export async function keepAliveListenKey(listenKey) {
  await keyOnlyRequest('PUT', '/api/v3/userDataStream', { listenKey });
}

export async function deleteListenKey(listenKey) {
  await keyOnlyRequest('DELETE', '/api/v3/userDataStream', { listenKey }).catch(() => {});
}

export async function placeOrder({ symbol, side, quantity, stopLoss, takeProfit }) {
  const info = await getSymbolInfo(symbol);
  const qtyStr = formatPrice(quantity, info.qtyPrecision);

  // Always place market entry first
  const entryData = await privateRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: qtyStr,
  });

  const avgPrice = entryData.fills?.length
    ? entryData.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0)
      / entryData.fills.reduce((s, f) => s + parseFloat(f.qty), 0)
    : parseFloat(entryData.price || 0);

  logger.info('Market order placed', { symbol, side, orderId: entryData.orderId, avgPrice });

  // If SL+TP provided — place OCO exit order after entry is filled
  if (stopLoss && takeProfit) {
    const ocoSide = side === 'BUY' ? 'SELL' : 'BUY';
    const slippage = side === 'BUY' ? 0.999 : 1.001;

    try {
      const ocoData = await privateRequest('POST', '/api/v3/orderList/oco', {
        symbol,
        side: ocoSide,
        quantity: qtyStr,
        price: formatPrice(takeProfit, info.pricePrecision),
        stopPrice: formatPrice(stopLoss, info.pricePrecision),
        stopLimitPrice: formatPrice(stopLoss * slippage, info.pricePrecision),
        stopLimitTimeInForce: 'GTC',
      });
      logger.info('OCO exit order placed', { symbol, ocoOrderId: ocoData.orderListId });
      return { orderId: String(entryData.orderId), ocoOrderId: String(ocoData.orderListId), price: avgPrice, type: 'MARKET+OCO' };
    } catch (ocoErr) {
      // Entry is already filled — log OCO failure but don't fail the whole call
      logger.error('OCO exit order failed after entry fill', { symbol, error: ocoErr.message });
      return { orderId: String(entryData.orderId), price: avgPrice, type: 'MARKET', warning: 'OCO placement failed — manage exit manually' };
    }
  }

  return { orderId: String(entryData.orderId), price: avgPrice, type: 'MARKET' };
}
