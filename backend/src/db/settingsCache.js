import { prisma } from './prisma.js';

let cache = null;
let lastFetch = 0;
const TTL = 30_000; // 30 seconds

export async function getSettings() {
  const now = Date.now();
  if (cache && now - lastFetch < TTL) return cache;
  try {
    cache = await prisma.settings.findUnique({ where: { id: 1 } });
    lastFetch = now;
    return cache;
  } catch {
    return cache; // return stale on error
  }
}

export function invalidateSettingsCache() {
  cache = null;
  lastFetch = 0;
}

export function makeSettingCache(getter, defaultValue, ttl = 30_000) {
  let cached = defaultValue;
  let lastFetch = 0;
  return async () => {
    const now = Date.now();
    if (lastFetch !== 0 && now - lastFetch < ttl) return cached;
    try {
      cached = await getter();
      lastFetch = now;
    } catch {}
    return cached;
  };
}
