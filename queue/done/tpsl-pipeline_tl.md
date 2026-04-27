# TL Report: tpsl-pipeline

**Статус: DONE — все 4 фикса применены**

---

## BUG-1: qty в placeTpSl — FIXED

- `rest.js`: сигнатура обновлена → `placeTpSl(symbol, exitSide, stopLoss, takeProfit, info, quantity)`
- Оба ордера (TP Limit и SL StopMarket): `qty: '0'` заменён на `qty: formatNum(quantity, info.qtyPrecision)`
- `engine.js` Phase 2: вызов обновлён → `placeTpSl(..., symbolInfo, confirmedQty)`
- `engine.js` Reconciliation: вызов обновлён → `placeTpSl(..., symbolInfo, trade.quantity)`

---

## BUG-2: guard для null SL/TP в Phase 2 — FIXED

- `engine.js`: добавлен early-return перед `const exitSide = ...`
- При `!suggestedSl && !suggestedTp`: trade обновляется в `OPEN`, логируется, Telegram уведомление отправляется, функция завершается без попытки разместить TP/SL

---

## BUG-3: hasSellSide упрощён — FIXED

- Phase 2 (engine.js ~line 324): заменено на `orders.some((o) => o.side === exitSide && Boolean(o.stopOrderType))`
- Reconciliation (engine.js ~line 404): то же самое
- Мёртвый код `o.orderFilter === 'StopOrder' || o.orderFilter === 'tpSlOrder'` удалён из обоих мест

---

## BUG-4: resultFull убран из лога — FIXED

- `rest.js` line 283: убран `resultFull: orderData.result` из `logger.info('Bybit market order placed', ...)`

---

## Проверка

- Нет новых импортов — изменения минимальны
- Сигнатура `placeTpSl` обновлена везде: в самой функции (rest.js) и в обоих вызовах (engine.js Phase 2 + Reconciliation)
- Phase 2 retry loop корректен: `confirmedQty` передаётся на каждой попытке
- `trade.quantity` в reconciliation — поле из Prisma модели Trade, доступно через `findMany`
