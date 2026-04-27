# BUG-13.4 — Dev Report

Добавил `cancelExitProtection(symbol, exitSide)` в `bybit/rest.js` и заменил 3 destructive вызова `cancelAllOpenOrders` (engine.js ×2, portfolio.js ×1), чтобы сносить только наши SL/TP, не трогая user-side ордера.

---

## Правка 1: новая функция в `backend/src/services/bybit/rest.js`

ДО: функция отсутствует, импорт `isSlOrder/isTpOrder` отсутствует.

ПОСЛЕ:
```js
// добавлен импорт
import { isSlOrder, isTpOrder } from './orderMatchers.js';

// добавлена функция (после cancelAllOpenOrders):
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

`cancelAllOpenOrders` оставлен exported без изменений.

---

## Правка 2: `engine.js` reverse signal (~165)

ДО:
```js
try {
  await cancelAllOpenOrders(pair.tradeSymbol).catch(() => {});
  const closeSide = existingTrade.side === 'BUY' ? 'SELL' : 'BUY';
  await placeOrder({ symbol: pair.tradeSymbol, side: closeSide, quantity: existingTrade.quantity });
```

ПОСЛЕ:
```js
try {
  const oldExitSide = existingTrade.side === 'BUY' ? 'Sell' : 'Buy';
  await cancelExitProtection(pair.tradeSymbol, oldExitSide).catch(() => {});
  const closeSide = existingTrade.side === 'BUY' ? 'SELL' : 'BUY';
  await placeOrder({ symbol: pair.tradeSymbol, side: closeSide, quantity: existingTrade.quantity });
```

Импорт обновлён:
```js
// ДО
import { getKlines, placeOrder, getAccountBalance, cancelAllOpenOrders } from '../exchange/index.js';
import { placeTpSl, getOpenOrders, getSymbolInfo, getOrderHistory } from '../bybit/rest.js';
// ПОСЛЕ
import { getKlines, placeOrder, getAccountBalance } from '../exchange/index.js';
import { placeTpSl, getOpenOrders, getSymbolInfo, getOrderHistory, cancelExitProtection } from '../bybit/rest.js';
```

`cancelAllOpenOrders` больше не используется в engine.js — убран из импорта.

---

## Правка 3: `engine.js` Phase 2 emergency close (~368)

ДО:
```js
const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
try {
  await cancelAllOpenOrders(pair.tradeSymbol).catch(() => {});
  await placeOrder({ symbol: pair.tradeSymbol, side: closeSide, quantity: confirmedQty });
```

ПОСЛЕ:
```js
const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
try {
  await cancelExitProtection(pair.tradeSymbol, exitSide).catch(() => {});
  await placeOrder({ symbol: pair.tradeSymbol, side: closeSide, quantity: confirmedQty });
```

`exitSide` уже определён выше (строка 308: `const exitSide = side === 'BUY' ? 'Sell' : 'Buy';`) — переиспользован.

---

## Правка 4: `portfolio.js` close-trade route (~93)

ДО:
```js
const exitSide = trade.side === 'BUY' ? 'SELL' : 'BUY';

// Cancel SL/TP before market exit to avoid double-fill
await cancelAllOpenOrders(trade.symbol).catch(() => {});
```

ПОСЛЕ:
```js
const exitSide = trade.side === 'BUY' ? 'SELL' : 'BUY';

// Cancel SL/TP before market exit to avoid double-fill
const oldExitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
await cancelExitProtection(trade.symbol, oldExitSide).catch(() => {});
```

Локальная `exitSide` уже была в snake-uppercase ('SELL'/'BUY') и используется ниже как side для `placeManualOrder` — её не трогал. Добавил отдельную `oldExitSide` в Bybit canonical 'Sell'/'Buy'.

Импорт обновлён:
```js
// ДО
import {
  getAccountBalance, getOpenOrders, getOrderHistory, cancelOrder,
  cancelAllOpenOrders, placeManualOrder, placeTpSl, getSymbolInfo,
} from '../services/bybit/rest.js';
// ПОСЛЕ
import {
  getAccountBalance, getOpenOrders, getOrderHistory, cancelOrder,
  cancelExitProtection, placeManualOrder, placeTpSl, getSymbolInfo,
} from '../services/bybit/rest.js';
```

`cancelAllOpenOrders` больше не используется в portfolio.js — убран из импорта.

---

## Sanity

1. **`cancelAllOpenOrders` остался exported** в `bybit/rest.js` (строки 256–265, без изменений). Также продолжает использоваться в `services/bybit/userDataStream.js` — затронуто не было.
2. **Импорты обновлены в каждом из 3 файлов:**
   - `bybit/rest.js`: добавлен `import { isSlOrder, isTpOrder } from './orderMatchers.js'`.
   - `services/indicators/engine.js`: убран `cancelAllOpenOrders` из exchange-import, добавлен `cancelExitProtection` в bybit-import.
   - `routes/portfolio.js`: `cancelAllOpenOrders` заменён на `cancelExitProtection` в named-импорте.
3. **`Promise.allSettled` использован** в `cancelExitProtection` для параллельной отмены — частичные неудачи логируются `logger.warn`, не валят общий flow.
4. **Exit-side определён правильно для существующего трейда:**
   - engine.js reverse: `existingTrade.side === 'BUY' ? 'Sell' : 'Buy'` → отменяется protection противоположной стороны существующего LONG/SHORT (не нового сигнала).
   - engine.js Phase 2 emergency: переиспользуется уже существующий `exitSide` (строка 308), вычисленный из `side` текущего трейда.
   - portfolio.js: `trade.side === 'BUY' ? 'Sell' : 'Buy'` — Bybit canonical case ('Buy'/'Sell'), как требует `o.side === exitSide` predicate.

Все 4 правки применены через Edit. Тесты не запускались, git commit не делался.
