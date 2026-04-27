# TP/SL-13.2-v2 — Dev Report

Заменил нерабочий `getAccountBalance + Math.min(free, qty)` подход (страдал от async wallet propagation Bybit) на детерминированный polling `cumExecQty - cumExecFee` через `/v5/order/history` в обоих файлах.

## `backend/src/services/bybit/rest.js` — `placeManualOrder` Market+SL/TP ветка

**До:**
```js
const baseAsset = symbol.replace(/USDT$|USDC$/, '');
let realQty = qty;
try {
  const coins = await getAccountBalance();
  const coin = coins.find((c) => c.asset === baseAsset);
  const free = parseFloat(coin?.free || coin?.total || 0);
  if (free > 0) {
    const factor = Math.pow(10, info.qtyPrecision);
    const floored = Math.floor(Math.min(free, qty) * factor) / factor;
    if (floored > 0) realQty = floored;
  }
} catch (err) { ... }
```

**После:**
```js
const orderId = data.result?.orderId;
let realQty = qty;
for (let attempt = 0; attempt < 4; attempt++) {
  await new Promise((r) => setTimeout(r, 500));
  const histData = await privateGet('/v5/order/history', { category: 'spot', orderId });
  const order = histData.result?.list?.[0];
  const cumExecQty = parseFloat(order?.cumExecQty || 0);
  const cumExecFee = parseFloat(order?.cumExecFee || 0);
  if (cumExecQty > 0) {
    const netQty = bybitSide === 'Buy' ? cumExecQty - cumExecFee : cumExecQty;
    const floored = Math.floor(netQty * Math.pow(10, info.qtyPrecision)) / Math.pow(10, info.qtyPrecision);
    if (floored > 0) { realQty = floored; break; }
  }
}
```

## `backend/src/services/indicators/engine.js` — `executeAutoTrade`

**Phase 1 до:**
```js
let confirmedPrice = entryResult.price;
if (!confirmedPrice) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(1000);
    const order = (histData.result?.list || []).find((o) => o.orderId === entryResult.orderId);
    if (order?.avgPrice) { confirmedPrice = parseFloat(order.avgPrice); break; }
  }
}
```

**Phase 1 после:**
```js
let confirmedPrice = entryResult.price;
let confirmedFilledQty = 0;
let confirmedFee = 0;
if (!confirmedPrice || !confirmedFilledQty) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(1000);
    const order = (histData.result?.list || []).find((o) => o.orderId === entryResult.orderId);
    if (order?.avgPrice) confirmedPrice = parseFloat(order.avgPrice);
    if (order?.cumExecQty) confirmedFilledQty = parseFloat(order.cumExecQty);
    if (order?.cumExecFee) confirmedFee = parseFloat(order.cumExecFee);
    if (confirmedPrice && confirmedFilledQty > 0) break;
  }
}
```

**Phase 2 до:**
```js
let tpSlQty = confirmedQty;
if (side === 'BUY') {
  const baseAsset = pair.tradeSymbol.replace(/USDT$|USDC$/, '');
  try {
    const coins = await getAccountBalance();
    const coin = coins.find((c) => c.asset === baseAsset);
    const free = parseFloat(coin?.free || coin?.total || 0);
    if (free > 0) {
      const floored = Math.floor(Math.min(free, confirmedQty) * factor) / factor;
      if (floored > 0) tpSlQty = floored;
    }
  } catch (err) { ... }
}
```

**Phase 2 после:**
```js
let tpSlQty = confirmedQty;
if (side === 'BUY' && confirmedFilledQty > 0) {
  const netQty = confirmedFilledQty - confirmedFee;
  const factor = Math.pow(10, symbolInfo.qtyPrecision);
  const floored = Math.floor(netQty * factor) / factor;
  if (floored > 0) tpSlQty = floored;
}
```

## Sanity-check

1. **Старый `Math.min(free, ...)` / `getAccountBalance`-блок удалён в обоих файлах.** Grep `Math.min(free` → 0 совпадений; `getAccountBalance` остался только: (а) в определении функции в rest.js:111, (б) в импорте engine.js:6 и SHORT pre-entry balance check engine.js:203 — это другая логика, к таску не относится.

2. **Polling в engine.js Phase 1 теперь работает пока не получены оба поля** — условие `if (!confirmedPrice || !confirmedFilledQty)`, внутри loop break только когда `confirmedPrice && confirmedFilledQty > 0`. Fallback корректен: если cumExecQty=0 после 3 попыток, Phase 2 guard `if (side === 'BUY' && confirmedFilledQty > 0)` не сработает → `tpSlQty = confirmedQty` (gross). Для rest.js аналогично: 4 attempt × 500мс, если все провалились — `realQty = qty` (исходный gross).

3. **SELL ветка не затронута.** В rest.js: `bybitSide === 'Buy' ? cumExecQty - cumExecFee : cumExecQty` — SELL получает gross cumExecQty (fee в quote, base qty не меняется). В engine.js Phase 2: BUY-only branch (`if (side === 'BUY' && ...)`) — для SELL `tpSlQty = confirmedQty` как раньше.
