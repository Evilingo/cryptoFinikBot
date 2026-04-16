/**
 * Exchange adapter — routes calls to Binance or Bybit based on Settings.exchange.
 * Cache the exchange setting for 60s to avoid DB round-trips on every call.
 */

import { prisma } from '../../db/prisma.js';

let cachedExchange = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

async function getExchange() {
  const now = Date.now();
  if (now - cacheTime < CACHE_TTL && cachedExchange !== null) {
    return cachedExchange;
  }
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    cachedExchange = settings?.exchange || process.env.EXCHANGE || 'binance';
  } catch {
    cachedExchange = process.env.EXCHANGE || 'binance';
  }
  cacheTime = now;
  return cachedExchange;
}

// Invalidate cache (called when exchange setting changes)
export function invalidateExchangeCache() {
  cachedExchange = null;
  cacheTime = 0;
}

export async function getAccountBalance() {
  const exchange = await getExchange();
  if (exchange === 'bybit') {
    const { getAccountBalance: bybitBalance } = await import('../bybit/rest.js');
    return bybitBalance();
  }
  const { getAccountBalance: binanceBalance } = await import('../binance/rest.js');
  return binanceBalance();
}

export async function getMidPrice(symbol) {
  const exchange = await getExchange();
  if (exchange === 'bybit') {
    const { getMidPrice: bybitMidPrice } = await import('../bybit/rest.js');
    return bybitMidPrice(symbol);
  }
  const { getMidPrice: binanceMidPrice } = await import('../binance/rest.js');
  return binanceMidPrice(symbol);
}

export async function getKlines(symbol, interval = '1m', limit = 100) {
  const exchange = await getExchange();
  if (exchange === 'bybit') {
    const { getKlines: bybitKlines } = await import('../bybit/rest.js');
    return bybitKlines(symbol, interval, limit);
  }
  const { getKlines: binanceKlines } = await import('../binance/rest.js');
  return binanceKlines(symbol, interval, limit);
}

export async function placeOrder(params) {
  const exchange = await getExchange();
  if (exchange === 'bybit') {
    const { placeOrder: bybitOrder } = await import('../bybit/rest.js');
    return bybitOrder(params);
  }
  const { placeOrder: binanceOrder } = await import('../binance/rest.js');
  return binanceOrder(params);
}

export async function getOrderBook(symbol, limit) {
  const exchange = await getExchange();
  if (exchange === 'bybit') {
    const { getOrderBook: bybitOb } = await import('../bybit/rest.js');
    return bybitOb(symbol, limit);
  }
  const { getOrderBook: binanceOb } = await import('../binance/rest.js');
  return binanceOb(symbol, limit);
}
