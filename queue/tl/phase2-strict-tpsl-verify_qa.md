# QA: phase2-strict-tpsl-verify

## [CRITICAL] slPlaced матчит TP-ордер — предикат не различает SL и TP — backend/src/services/indicators/engine.js:325-327 и :411-413

**Причина.**
`placeTpSl` в `backend/src/services/bybit/rest.js:306-332` создаёт TP как Limit с `orderFilter: 'tpSlOrder'` и `triggerBy: 'LastPrice'`. Bybit v5 возвращает такой ордер в `getOpenOrders` с НЕПУСТЫМ `stopOrderType` (обычно `'TakeProfit'` или `'tpslOrder'`) — это подтверждается фронтом `frontend/src/pages/Portfolio.jsx:504-510`, где `hasSlOrder` явно исключает `TakeProfit`/`OcoTriggerByTp` и проверяет `triggerPrice>0 && price===0` (Stop-Market), а не просто `Boolean(stopOrderType)`.

В новом бэкендовом предикате:
```js
const slPlaced = !suggestedSl || exitOrders.some((o) =>
  Boolean(o.stopOrderType) || parseFloat(o.triggerPrice || 0) > 0,
);
```
любой размещённый TP (Limit tpSlOrder) имеет `stopOrderType !== ''`, поэтому `slPlaced=true` даже если реального Stop-Market SL нет. Сценарий ровно того же типа, что и исходный баг (SL ок / TP reject) — только зеркально: TP ок / SL reject → верификация ложно проходит → Phase 3 коммитит OPEN без SL. **Регрессия не исправляет исходную проблему полностью, а создаёт симметричный баг.**

Дополнительно: это рассинхрон с фронтом — задача явно требовала консистентности с `hasSlOrder`/`hasTpOrder` (`phase2-strict-tpsl-verify.md:36`), а фронт для SL проверяет именно Stop-Market-паттерн (`triggerPrice>0 && price===0` либо явные `StopLoss`/`Stop`/`OcoTriggerByStopLoss`), никогда просто `Boolean(stopOrderType)`.

**Исправление** (обе зоны, 325-327 и 411-413). Повторить паттерн фронта:
```js
const slPlaced = !suggestedSl || exitOrders.some((o) =>
  o.stopOrderType === 'StopLoss' ||
  o.stopOrderType === 'Stop' ||
  o.stopOrderType === 'OcoTriggerByStopLoss' ||
  (parseFloat(o.triggerPrice || 0) > 0 && parseFloat(o.price || 0) === 0),
);
```
(в зоне reconcile — `!trade.stopLoss` вместо `!suggestedSl`).

TP-предикат оставить как есть: `orderType==='Limit' && price>0 && triggerPrice===0` — он корректен и совпадает с фронтом.

## Прочее

- `parseFloat(o.triggerPrice || 0) === 0` для TP: при `triggerPrice` undefined/null/'' → `|| 0` → `parseFloat(0)` → 0 → ок. При строке `'0.00'` → 0 → ок. Ok.
- `!suggestedSl`/`!trade.stopLoss` корректно обрабатывают 0/null/undefined как «не задано» — совпадает со схемой Prisma Float|null и ветками вызова `placeTpSl(...suggestedSl || null, suggestedTp || null...)`.
- Reconcile `!trade.stopLoss || ...` — если trade.stopLoss=null (не задан), ветка slPlaced=true, reconcile его не тронет. Это правильно — нечего размещать.
- Race по кэшу getOpenOrders — вне скоупа задачи.
