/**
 * Bybit smoke tests — публичные endpoints (без API ключей).
 * Запуск: cd backend && npm run smoke
 *
 * Проверяет:
 *  1. REST: getMidPrice, getKlines, getOrderBook, instruments-info
 *  2. WebSocket: подключение, подписка, OB snapshot, kline
 */

import WebSocket from 'ws';

const BASE = 'https://api.bybit.com';
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}: ${result}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

// ─── REST ────────────────────────────────────────────────────────────────────

console.log('\n── REST ──');

await test('getMidPrice BTCUSDT', async () => {
  const r = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=BTCUSDT`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const t = d.result.list[0];
  const mid = ((+t.bid1Price + +t.ask1Price) / 2).toFixed(2);
  return `bid=${t.bid1Price} ask=${t.ask1Price} mid=${mid}`;
});

await test('getKlines BTCUSDT 1m (5 свечей)', async () => {
  const r = await fetch(`${BASE}/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=5`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const list = d.result.list;
  if (list.length !== 5) throw new Error(`ожидалось 5 свечей, получено ${list.length}`);
  return `получено ${list.length} свечей, последняя close=${list[0][4]}`;
});

await test('getOrderBook BTCUSDT 200 levels', async () => {
  const r = await fetch(`${BASE}/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=200`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const { b, a, seq } = d.result;
  if (!b.length || !a.length) throw new Error('пустой ордербук');
  return `bids=${b.length} asks=${a.length} seq=${seq}`;
});

await test('instruments-info BTCUSDT (precision)', async () => {
  const r = await fetch(`${BASE}/v5/market/instruments-info?category=spot&symbol=BTCUSDT`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const info = d.result.list[0];
  if (!info) throw new Error('символ не найден');
  return `tickSize=${info.priceFilter.tickSize} basePrecision=${info.lotSizeFilter.basePrecision}`;
});

await test('getMidPrice ETHUSDT', async () => {
  const r = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=ETHUSDT`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(d.retMsg);
  return `last=${d.result.list[0].lastPrice}`;
});

// ─── WebSocket ───────────────────────────────────────────────────────────────

console.log('\n── WebSocket ──');

await new Promise((resolve) => {
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  let snapReceived = false;
  let klineReceived = false;

  function maybeClose() {
    if (snapReceived && klineReceived) ws.close();
  }

  ws.on('open', () => {
    console.log('✅ WS: подключён');
    passed++;
    ws.send(JSON.stringify({ op: 'subscribe', args: ['orderbook.200.BTCUSDT', 'kline.1.BTCUSDT'] }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);

    if (msg.op === 'subscribe') {
      if (msg.success) {
        console.log('✅ WS: подписка OK');
        passed++;
      } else {
        console.log(`❌ WS: подписка FAIL — ${msg.retMsg}`);
        failed++;
      }
      return;
    }

    if (msg.topic?.startsWith('orderbook') && msg.type === 'snapshot' && !snapReceived) {
      snapReceived = true;
      const { b, a, seq } = msg.data;
      if (b.length && a.length) {
        console.log(`✅ WS: OB snapshot bids=${b.length} asks=${a.length} seq=${seq}`);
        passed++;
      } else {
        console.log('❌ WS: OB snapshot пустой');
        failed++;
      }
      maybeClose();
    }

    if (msg.topic?.startsWith('kline') && !klineReceived) {
      klineReceived = true;
      const k = msg.data[0];
      if (k?.close) {
        console.log(`✅ WS: kline close=${k.close} confirm=${k.confirm}`);
        passed++;
      } else {
        console.log('❌ WS: kline данные некорректны');
        failed++;
      }
      maybeClose();
    }
  });

  ws.on('error', (e) => {
    console.log(`❌ WS: error — ${e.message}`);
    failed++;
    resolve();
  });

  ws.on('close', () => {
    console.log('   WS закрыт');
    resolve();
  });

  setTimeout(() => {
    if (!snapReceived) { console.log('❌ WS: OB snapshot timeout'); failed++; }
    if (!klineReceived) { console.log('❌ WS: kline timeout'); failed++; }
    ws.close();
  }, 8000);
});

// ─── Итог ────────────────────────────────────────────────────────────────────

console.log(`\n── Итог: ${passed} прошло, ${failed} упало ──`);
if (failed > 0) process.exit(1);
