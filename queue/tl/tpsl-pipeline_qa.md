# QA Report: tpsl-pipeline

## Статус: FAIL — 3 бага (2 критических, 1 важный, 1 minor)

---

## BUG-1 🔴 КРИТИЧНО: `qty: '0'` — Bybit Spot не поддерживает

**Файл:** `rest.js`, строки 314, 327

```js
qty: '0',  // qty=0 means "close full position" on UTA Spot tpSl orders
```

**Почему ломает:** qty=0 — futures/position-based концепция. Для category='spot'
Bybit требует реальный qty > 0. Оба ордера получат ошибку API → placeTpSl всегда
бросает Error → Phase 2 всегда проваливается → каждая сделка аварийно закрывается.

**Fix:** добавить параметр `quantity` в `placeTpSl(symbol, exitSide, stopLoss, takeProfit, info, quantity)`,
использовать `qty: formatNum(quantity, info.qtyPrecision)` в обоих ордерах.

---

## BUG-2 🔴 КРИТИЧНО: Phase 2 не пропускается при отсутствии SL/TP

**Файл:** `engine.js`, строка 303

```js
await placeTpSl(pair.tradeSymbol, exitSide, suggestedSl || null, suggestedTp || null, symbolInfo);
```

**Почему ломает:** Если оба null — placeTpSl не размещает ничего, верификация видит 0
ордеров, 3 попытки проваливаются → аварийное закрытие. Торговля без SL/TP стала
невозможной (раньше работало).

**Fix:** перед Phase 2:
```js
if (!suggestedSl && !suggestedTp) {
  await prisma.trade.update({ where: { id: trade.id }, data: { status: 'OPEN' } });
  // ... Telegram ...
  return;
}
```

---

## BUG-3 🟡 ВАЖНО: мёртвый код в hasSellSide — маскирует реальную логику

**Файл:** `engine.js` строки 313, 393

```js
o.orderFilter === 'StopOrder' || o.orderFilter === 'tpSlOrder'
```

`orderFilter` — query-параметр, не поле ордера. Bybit его не возвращает в объекте.
Всегда `undefined`. Логика работает только через `o.stopOrderType`.

**Fix:** `orders.some(o => o.side === exitSide && Boolean(o.stopOrderType))`

---

## BUG-4 🟢 MINOR: debug-лог resultFull не убран

**Файл:** `rest.js` строка 283 — `resultFull: orderData.result` — временный лог.

---

## Что работает корректно

- Phase 1: PENDING → market order → poll avgPrice — логика верна
- Phase 3: commit после верификации — верно
- Phase 4 (reconciliation): структурно верна (BUG-3 есть, но не критично)
- Guard `status: { in: ['OPEN', 'PENDING'] }` — правильно
- getOrderHistory экспортирован, импорт валиден
- Prisma status — String, FAILED/PENDING допустимы
- server.js: startReconciliation/stopReconciliation вызваны правильно
