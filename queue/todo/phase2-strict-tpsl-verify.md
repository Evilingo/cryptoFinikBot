# Phase 2: строгая верификация TP и SL по отдельности

**Критичность:** CRITICAL prod bug. На проде три трейда открыты без TP.

## Проблема

`backend/src/services/indicators/engine.js:324` (Phase 2) и `:404` (reconcile missing protection) используют один и тот же предикат:

```js
const hasSellSide = orders.some((o) => o.side === exitSide && Boolean(o.stopOrderType));
```

Это проверяет только что **какой-нибудь** sell-side ордер имеет `stopOrderType`. Но:
- **SL** — Stop-Market (`orderFilter='StopOrder'`) → есть `stopOrderType`
- **TP** — Limit (`orderFilter='tpSlOrder'`) → `stopOrderType` NULL/пусто

Если Bybit отвергает TP (любой причине), а SL прошёл — верификация ложно говорит OK. Phase 3 коммитит Trade в OPEN без реального TP на бирже.

## Фикс (обе зоны — 324 и 404)

Заменить `hasSellSide` на раздельную проверку:

```js
const exitOrders = orders.filter((o) => o.side === exitSide);
const slPlaced = !suggestedSl || exitOrders.some(o =>
  Boolean(o.stopOrderType) || parseFloat(o.triggerPrice) > 0
);
const tpPlaced = !suggestedTp || exitOrders.some(o =>
  o.orderType === 'Limit' && parseFloat(o.price) > 0 && parseFloat(o.triggerPrice || 0) === 0
);
const verified = slPlaced && tpPlaced;
```

В секции reconcile (строка ~404) переменные называются `trade.stopLoss` / `trade.takeProfit` (не `suggestedSl`/`suggestedTp`) — адаптировать имена. Логика та же.

Предикаты согласованы с фронтом [frontend/src/pages/Portfolio.jsx:493-503](frontend/src/pages/Portfolio.jsx) (`hasSlOrder`/`hasTpOrder`).

## Файлы

- `backend/src/services/indicators/engine.js:324` (Phase 2, переменные `suggestedSl`/`suggestedTp`)
- `backend/src/services/indicators/engine.js:404` (reconcile, переменные `trade.stopLoss`/`trade.takeProfit`)

## Ограничения

- KISS: не выносить в хелпер, inline локально (используется 2 раза — допустимая дупликация).
- Не трогать `placeTpSl()` и запросы к Bybit API.
- Не писать тесты (их нет для этого модуля).
- Не трогать фронт.

## Ожидаемый результат

1. Bybit отвергает TP, SL успешен → `tpPlaced=false` → retry Phase 2 → если всё ещё без TP → emergency close (`engine.js:336-355`).
2. Никаких OPEN трейдов без реально размещённых TP и SL на бирже.
3. Reconcile-путь (404) не пропускает трейды с одним только SL — будет делать `placeTpSl` повторно.

## Формат отчёта Dev

В `queue/qa/phase2-strict-tpsl-verify_dev.md`:
- Одно предложение что сделал
- Изменённые строки (файл:строка + краткое описание)
- Нюансы если были
