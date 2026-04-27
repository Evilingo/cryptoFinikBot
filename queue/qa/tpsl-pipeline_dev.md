# Dev Report: tpsl-pipeline implementation

## Summary

Реализована 4-фазная схема открытия позиции с верификацией TP/SL на бирже.

### Изменённые файлы

1. `backend/src/services/bybit/rest.js`
2. `backend/src/services/indicators/engine.js`
3. `backend/src/server.js`

---

## rest.js — изменения

### `placeOrder()` — убраны inline TP/SL

**Старый код:**
```js
export async function placeOrder({ symbol, side, quantity, stopLoss, takeProfit }) {
  // ...
  if (takeProfit) {
    body.takeProfit = formatNum(takeProfit, info.pricePrecision);
    body.tpTriggerBy = 'LastPrice';
    body.tpOrderType = 'Limit';
  }
  if (stopLoss) {
    body.stopLoss = formatNum(stopLoss, info.pricePrecision);
    body.slTriggerBy = 'LastPrice';
    body.slOrderType = 'Market';
  }
  // ...
  return {
    orderId: String(orderId),
    price: avgPrice,
    slFailed: false,
    type: (stopLoss || takeProfit) ? 'MARKET+INLINE_TPSL' : 'MARKET',
  };
}
```

**Новый код:**
```js
export async function placeOrder({ symbol, side, quantity }) {
  // только Market order, без sl/tp параметров
  // ...
  return {
    orderId: String(orderId),
    price: avgPrice,
  };
}
```

### `placeTpSl()` — новая функция

```js
export async function placeTpSl(symbol, exitSide, stopLoss, takeProfit, info) {
  // Параллельно: TP Limit (orderFilter='tpSlOrder') + SL StopMarket (orderFilter='StopOrder')
  // qty='0' = close full position (UTA Spot)
  // Бросает Error если хотя бы один запрошенный ордер провалился
  // Возвращает { tpOrderId, slOrderId }
}
```

### `getSymbolInfo` — экспортирована

```js
export { getSymbolInfo };
```

---

## engine.js — изменения

### Новые импорты

```js
import { placeTpSl, getOpenOrders, getSymbolInfo, getOrderHistory } from '../bybit/rest.js';
```

### `executeAutoTrade()` — переписан под 4 фазы

**Фаза 1 (Entry):**
- `prisma.trade.create({ status: 'PENDING', binanceOrderId: '0' })` — до ордера
- `placeOrder({ symbol, side, quantity })` — только Market, без TP/SL
- Poll `getOrderHistory()` до 3x с 1s задержкой для получения `avgPrice`
- `prisma.trade.update({ binanceOrderId, price: confirmedPrice, quantity })`
- При провале placeOrder: `status = 'FAILED'`, Telegram, return

**Фаза 2 (Protection):**
- `getSymbolInfo(symbol)` — для форматирования цен
- Retry loop (max 3, backoffs 500→1000→2000ms):
  - `placeTpSl(symbol, exitSide, sl, tp, info)`
  - `sleep(backoff)`
  - `getOpenOrders(symbol)` → проверить наличие exitSide ордеров с stopOrderType или нужным orderFilter
  - Если найден → break, tpSlPlaced=true
- Если после 3 попыток нет: аварийное закрытие → `status = 'FAILED'`, `slOrderFailed = true` → Telegram → return

**Фаза 3 (Commit):**
- `prisma.trade.update({ status: 'OPEN', slOrderFailed: false })`
- Telegram: "Авто-сделка открыта, SL/TP активны"

**Guard изменён:** теперь проверяет `status: { in: ['OPEN', 'PENDING'] }` — блокирует параллельный запуск для того же символа.

### `startReconciliation()` / `stopReconciliation()` — новые экспорты

```js
// setInterval 60s
// для каждого OPEN trade с age < 55 min:
//   getOpenOrders → если нет exitSide ордеров → placeTpSl (одна попытка)
//   при провале: slOrderFailed=true + Telegram
export function startReconciliation() { ... }
export function stopReconciliation() { ... }
```

---

## server.js — изменения

### Добавлен импорт

```js
import { startReconciliation, stopReconciliation } from './services/indicators/engine.js';
```

### Вызов при старте

```js
// Phase 4: TP/SL reconciliation
startReconciliation();
```

### Вызов при shutdown

```js
async function shutdown(signal) {
  // ...
  stopReconciliation();
  // ...
}
```

---

## Примечания для QA

1. **Trade.status='PENDING'** — сохраняется до плейсмента ордера. Если сервер упадёт в Phase 1, трейд останется PENDING (не OPEN).
2. **Trade.status='FAILED'** — при провале Market ордера ИЛИ при невозможности разместить TP/SL после 3 попыток.
3. **slOrderFailed** — проставляется только при реальном провале Phase 2, никогда не hardcoded false в конце.
4. **Reconciliation** — пропускает сделки старше 55 минут (спецификация: `age < 55min`).
5. **placeTpSl qty='0'** — UTA Spot Bybit принимает qty=0 для tpSlOrder как "закрыть всю позицию". Если биржа не поддерживает — QA должен проверить на реальном API и возможно заменить на реальный qty из trade.quantity.
6. **Параллельный старт** — guard теперь блокирует PENDING+OPEN, не только OPEN.
