import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { decrypt } from '../../config/crypto.js';
import { logger } from '../../config/logger.js';

const BASE_URL = 'https://api.binance.com';

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
  params.timestamp = Date.now();
  params.recvWindow = 5000;

  const query = sign(params, secret);
  const url = `${BASE_URL}${path}?${query}`;

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': apiKey },
  });

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

export async function getOrderBook(symbol, limit = 5000) {
  const url = `${BASE_URL}/api/v3/depth?symbol=${symbol}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance depth error: ${res.status}`);
  return res.json();
}

export async function getKlines(symbol, interval = '1m', limit = 100) {
  const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
  const data = await res.json();
  return data.map((k) => ({
    t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
    l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]), T: k[6],
  }));
}

export async function placeOrder({ symbol, side, quantity, stopLoss, takeProfit }) {
  if (stopLoss && takeProfit) {
    const ocoSide = side === 'BUY' ? 'SELL' : 'BUY';
    const data = await privateRequest('POST', '/api/v3/order/oco', {
      symbol,
      side: ocoSide,
      quantity,
      price: takeProfit,
      stopPrice: stopLoss,
      stopLimitPrice: (stopLoss * (side === 'BUY' ? 0.999 : 1.001)).toFixed(2),
      stopLimitTimeInForce: 'GTC',
    });
    logger.info('OCO order placed', { symbol, orderId: data.orderListId });
    return { orderId: String(data.orderListId), price: takeProfit, type: 'OCO' };
  }

  const data = await privateRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity,
  });

  const avgPrice = data.fills
    ? data.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0)
      / data.fills.reduce((s, f) => s + parseFloat(f.qty), 0)
    : parseFloat(data.price || 0);

  logger.info('Market order placed', { symbol, orderId: data.orderId });
  return { orderId: String(data.orderId), price: avgPrice, type: 'MARKET' };
}
