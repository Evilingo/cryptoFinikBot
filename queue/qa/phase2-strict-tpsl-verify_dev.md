# Dev отчёт: phase2-strict-tpsl-verify

Заменил единый предикат `hasSellSide` на раздельную проверку `slPlaced && tpPlaced` в обеих зонах `backend/src/services/indicators/engine.js`, чтобы верификация не проходила при размещённом SL но отвергнутом TP.

## Зона 1 — Phase 2 (строки ~322-329)

**До:**
```js
const orders = ordersData.result?.list || [];
const hasSellSide = orders.some((o) => o.side === exitSide && Boolean(o.stopOrderType));
if (hasSellSide) {
  tpSlPlaced = true;
  ...
}
```

**После:**
```js
const orders = ordersData.result?.list || [];
const exitOrders = orders.filter((o) => o.side === exitSide);
const slPlaced = !suggestedSl || exitOrders.some((o) =>
  Boolean(o.stopOrderType) || parseFloat(o.triggerPrice || 0) > 0,
);
const tpPlaced = !suggestedTp || exitOrders.some((o) =>
  o.orderType === 'Limit' && parseFloat(o.price) > 0 && parseFloat(o.triggerPrice || 0) === 0,
);
if (slPlaced && tpPlaced) {
  tpSlPlaced = true;
  ...
}
```

## Зона 2 — Reconcile (строки ~401-411)

**До:**
```js
const exitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
const hasSellSide = orders.some((o) => o.side === exitSide && Boolean(o.stopOrderType));
if (hasSellSide) continue;
```

**После:**
```js
const exitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
const exitOrders = orders.filter((o) => o.side === exitSide);
const slPlaced = !trade.stopLoss || exitOrders.some((o) =>
  Boolean(o.stopOrderType) || parseFloat(o.triggerPrice || 0) > 0,
);
const tpPlaced = !trade.takeProfit || exitOrders.some((o) =>
  o.orderType === 'Limit' && parseFloat(o.price) > 0 && parseFloat(o.triggerPrice || 0) === 0,
);
if (slPlaced && tpPlaced) continue;
```

## Почему такие предикаты

Они согласованы с фронтовыми `hasSlOrder`/`hasTpOrder` из `frontend/src/pages/Portfolio.jsx:504-515`: SL ловится либо по `stopOrderType`, либо по `triggerPrice>0` (Stop-Market); TP — Limit-ордер с `price>0` и `triggerPrice===0`. `!suggestedSl`/`!trade.stopLoss` корректно пропускают случай когда уровень не задан (`null`/`undefined`/`0`), а `parseFloat(o.triggerPrice || 0)` защищает от `NaN` на отсутствующем `triggerPrice`.
