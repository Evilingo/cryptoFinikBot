# TP/SL-13.2-v2 — Replace getAccountBalance with cumExecQty polling

**Priority:** HIGH — прод-блокер Place Order. Предыдущий фикс (Math.min с getAccountBalance) не сработал из-за async wallet update Bybit.

## Корневая причина

- Market BUY → orderId синхронно, но wallet endpoint обновляется с лагом 100-500мс.
- `getAccountBalance` сразу после → stale free=0 (если у юзера нет прежних BTC).
- `Math.min(0, qty) = 0` → guard `free > 0` → fallback к qty=0.001 → 170131 (wallet к этому моменту имеет 0.000999).

## Решение

Получать точное `cumExecQty - cumExecFee` через polling `/v5/order/history?orderId=...` (детерминированно, не зависит от wallet propagation, точно учитывает fee именно этой сделки).

## Файлы

### `backend/src/services/bybit/rest.js` — `placeManualOrder` (Market+SL/TP branch)

**Удалить** существующий блок `getAccountBalance + Math.min(free, qty)`.

**Заменить на** polling order/history (4×500мс ceiling, ловим cumExecQty>0):

```js
if (orderType === 'Market' && (stopLoss || takeProfit)) {
  const exitSide = bybitSide === 'Buy' ? 'Sell' : 'Buy';
  const orderId = data.result?.orderId;
  let realQty = qty;

  // Poll order for actual filled qty (cumExecQty - cumExecFee).
  // Bybit fill propagation is async ~100-500ms; up to 4×500ms (2s ceiling).
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const histData = await privateGet('/v5/order/history', { category: 'spot', orderId });
      const order = histData.result?.list?.[0];
      const cumExecQty = parseFloat(order?.cumExecQty || 0);
      const cumExecFee = parseFloat(order?.cumExecFee || 0);
      if (cumExecQty > 0) {
        // BUY: fee in base; SELL: fee in quote (irrelevant to base qty).
        const netQty = bybitSide === 'Buy' ? cumExecQty - cumExecFee : cumExecQty;
        const factor = Math.pow(10, info.qtyPrecision);
        const floored = Math.floor(netQty * factor) / factor;
        if (floored > 0) { realQty = floored; break; }
      }
    } catch (err) {
      logger.warn('placeManualOrder: fill poll failed', { orderId, attempt, error: err.message });
    }
  }

  try {
    await placeTpSl(symbol, exitSide, stopLoss || null, takeProfit || null, info, realQty);
  } catch (err) {
    logger.warn('placeManualOrder: separate TP/SL placement failed', { symbol, error: err.message });
  }
}
```

### `backend/src/services/indicators/engine.js` — `executeAutoTrade`

**Расширить** существующий polling loop в Phase 1 (`if (!confirmedPrice)`) — модифицировать так, чтобы он ВСЕГДА захватывал cumExecQty + cumExecFee, даже если avgPrice уже есть.

Объявить `confirmedFilledQty` и `confirmedFee` через `let`. Внутри loop при удачной выборке:
```js
if (order?.avgPrice) confirmedPrice = parseFloat(order.avgPrice);
if (order?.cumExecQty) confirmedFilledQty = parseFloat(order.cumExecQty);
if (order?.cumExecFee) confirmedFee = parseFloat(order.cumExecFee);
if (confirmedPrice && confirmedFilledQty > 0) break;
```

Переместить условие entry в loop: вместо `if (!confirmedPrice) { for ... }` сделать `if (!confirmedPrice || !confirmedFilledQty) { for ... }`. Или просто всегда выполнять loop с break при success.

**Удалить** существующий блок `getAccountBalance + Math.min(free, confirmedQty)` в Phase 2 целиком.

**Заменить на**:
```js
let tpSlQty = confirmedQty;
if (side === 'BUY' && confirmedFilledQty > 0) {
  const netQty = confirmedFilledQty - confirmedFee;
  const factor = Math.pow(10, symbolInfo.qtyPrecision);
  const floored = Math.floor(netQty * factor) / factor;
  if (floored > 0) tpSlQty = floored;
}
```

Если cumExecQty=0 (polling упал/не успел) — fallback к confirmedQty (gross). `confirmedQty` в остальных местах (Phase 3 log, Telegram) не трогать.

## KISS

- Не выносить в хелпер (2 места — inline).
- Не рефакторить функции целиком — только замена нерабочих блоков.
- Не трогать `placeOrder`.
- Без новых файлов / endpoints.

## Типичные ошибки

- `parseFloat(order?.cumExecQty || 0)` — guard.
- `Math.floor` (не round).
- `if (cumExecQty > 0)` ВНУТРИ loop — пропустить пустые ответы и продолжать polling.
- `if (floored > 0)` — guard от деградации до 0.
- УДАЛИТЬ старый блок (Math.min/getAccountBalance) — не оставлять рядом.

## Отчёт Dev

В `queue/qa/tp-sl-13-2-v2-cumexec_dev.md`:
- Одно предложение что сделал
- До/после snippet для каждого файла
- Sanity-check: старый блок удалён; engine.js polling/fallback корректен; SELL не затронут
