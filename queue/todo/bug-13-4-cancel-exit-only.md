# BUG-13.4 — Cancel only our exit-protection orders, not all symbol orders

**Priority:** HIGH — destructive bug. `cancelAllOpenOrders(symbol)` сносит user-side ордера тоже.

## Места вызова

1. `backend/src/services/indicators/engine.js:~351` — Phase 2 emergency close
2. `backend/src/services/indicators/engine.js:~165` — Reverse signal close (TRADE-01)
3. `backend/src/routes/portfolio.js:~90` — Close-trade route (Close button)

## Решение

### Новая функция в `backend/src/services/bybit/rest.js`

```js
/**
 * Cancel only protection orders (SL + TP) matching the given exit side.
 * Uses isSlOrder/isTpOrder predicates. User's manual orders untouched.
 */
export async function cancelExitProtection(symbol, exitSide) {
  const ordersData = await getOpenOrders(symbol);
  const orders = ordersData.result?.list || [];
  const targets = orders.filter((o) =>
    o.side === exitSide && (isSlOrder(o) || isTpOrder(o))
  );

  if (targets.length === 0) return { cancelled: 0 };

  const results = await Promise.allSettled(
    targets.map((o) => cancelOrder(symbol, o.orderId))
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = targets.length - succeeded;
  if (failed > 0) {
    logger.warn('cancelExitProtection: some cancels failed', { symbol, exitSide, succeeded, failed });
  }
  return { cancelled: succeeded };
}
```

Добавить импорт `isSlOrder, isTpOrder` из `./orderMatchers.js` в rest.js.

### Замены

**engine.js Phase 2 emergency (~351):**
- ДО: `await cancelAllOpenOrders(pair.tradeSymbol).catch(() => {});`
- ПОСЛЕ: `await cancelExitProtection(pair.tradeSymbol, exitSide).catch(() => {});`
- `exitSide` уже определён выше на строке 300.

**engine.js reverse signal (~165):**
- ДО: `await cancelAllOpenOrders(pair.tradeSymbol).catch(() => {});`
- ПОСЛЕ: 
  ```js
  const oldExitSide = existingTrade.side === 'BUY' ? 'Sell' : 'Buy';
  await cancelExitProtection(pair.tradeSymbol, oldExitSide).catch(() => {});
  ```
- Импорт обновить (заменить `cancelAllOpenOrders` на `cancelExitProtection` если он не используется в файле больше нигде, иначе оба).

**portfolio.js close-trade route (~90):**
- ДО: `await cancelAllOpenOrders(trade.symbol).catch(() => {});`
- ПОСЛЕ:
  ```js
  const oldExitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
  await cancelExitProtection(trade.symbol, oldExitSide).catch(() => {});
  ```
- Импорт обновить.

## KISS

- Не трогать `cancelAllOpenOrders` — оставить export, не вызывать только из 3 мест выше.
- Функция inline в rest.js, без новых файлов.
- Использовать существующие `isSlOrder`/`isTpOrder` из `orderMatchers.js`.

## Edge cases

- `getOpenOrders` бросает → catch снаружи (`.catch(() => {})` сохранили). ОК.
- Targets пустые → return early. ОК.
- `Promise.allSettled` — частичные неудачи логируются, не валят весь flow.
- Bybit side: 'Buy'/'Sell' (canonical), не 'BUY'/'SELL'.

## Файлы

- `backend/src/services/bybit/rest.js` — добавить функцию + импорт isSlOrder/isTpOrder
- `backend/src/services/indicators/engine.js` — два call-site (~165, ~351) + import
- `backend/src/routes/portfolio.js` — один call-site (~90) + import

## Отчёт Dev

В `queue/qa/bug-13-4-cancel-exit-only_dev.md`:
- Одно предложение что сделал
- Для каждой правки (4 шт): до/после snippet
- Sanity: cancelAllOpenOrders остался exported, импорты обновлены, новая функция использует Promise.allSettled
