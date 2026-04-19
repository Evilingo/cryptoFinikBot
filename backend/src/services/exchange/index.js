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

async function getAdapter() {
  const exchange = await getExchange();
  return exchange === 'bybit' ? import('../bybit/rest.js') : import('../binance/rest.js');
}

export async function getAccountBalance() {
  const { getAccountBalance } = await getAdapter();
  return getAccountBalance();
}

export async function getMidPrice(symbol) {
  const { getMidPrice } = await getAdapter();
  return getMidPrice(symbol);
}

export async function getKlines(symbol, interval = '1m', limit = 100) {
  const { getKlines } = await getAdapter();
  return getKlines(symbol, interval, limit);
}

export async function placeOrder(params) {
  const { placeOrder } = await getAdapter();
  return placeOrder(params);
}

export async function getOrderBook(symbol, limit) {
  const { getOrderBook } = await getAdapter();
  return getOrderBook(symbol, limit);
}

export async function cancelAllOpenOrders(symbol) {
  const { cancelAllOpenOrders } = await getAdapter();
  return cancelAllOpenOrders(symbol);
}
