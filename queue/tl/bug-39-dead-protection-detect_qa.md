# BUG-39 QA Report — Detect dead SL / hit TP

## Bugs

```
[MEDIUM] UX shows "already protected" after emergency close — frontend/src/pages/Portfolio.jsx:134-135
Причина:
  Backend на dead-protection возвращает { ok:true, action:'emergency_closed', reason, orderId }
  без полей slAdded/tpAdded. Текущий фронт:
    const added = [data.slAdded && 'SL', data.tpAdded && 'TP'].filter(Boolean).join(' + ');
    showStatus(true, added ? `${symbol}: ${added} added` : `${symbol}: already protected`);
  При emergency_closed: added === '' → показывается "already protected", хотя позиция была
  закрыта маркетом. Вводит юзера в заблуждение (он думает SL/TP стоят, а позиции уже нет).
Исправление:
  В Portfolio.jsx:130-138 добавить ветку перед added-расчётом:
    if (data.action === 'emergency_closed') {
      showStatus(true, `${trade.symbol}: emergency closed — ${data.reason}`);
    } else {
      const added = [data.slAdded && 'SL', data.tpAdded && 'TP'].filter(Boolean).join(' + ');
      showStatus(true, added ? `${trade.symbol}: ${added} added` : `${trade.symbol}: already protected`);
    }
  Также после emergency_closed желательно перезагрузить trades (а не только openOrders),
  чтобы строка из таблицы пропала после прихода FILLED через userDataStream — но это не критично,
  существующий refresh openOrders уже даёт частичный апдейт.
```

## Прочее (не баги)

- Helpers `isSlDead`/`isTpHit` корректны: null/undefined/0 → false; equality (`<=`/`>=`) на цене триггера → emergency close, что соответствует ожидаемому поведению биржевого SL.
- Reconcile-блок стоит после `if (slPlaced && tpPlaced) continue` и перед "Missing TP/SL" warn — порядок правильный, dead-check работает только когда хотя бы одна сторона не размещена; `!slPlaced`/`!tpPlaced` гард не трогает уже живые ордера.
- `cancelExitProtection` идёт ПЕРЕД market close в обоих путях — защита от double-fill.
- `placeOrder` (engine, auto-context) vs `placeManualOrder` (route, user-initiated) — соответствует существующим паттернам (Phase 2 emergency / `/trades/:id/close`).
- `continue` в reconcile loop корректно пропускает `placeTpSl`; Trade record закрывается через userDataStream FILLED — тот же контракт, что у Phase 2 emergency close.
- Импорты: `getMidPrice` добавлен в engine.js и portfolio.js; `isSlDead`/`isTpHit` импортируются из engine.js в portfolio.js — экспорт `export function ...` присутствует.
- Edge cases: `currentPrice=null` (getMidPrice бросил) → `if (currentPrice)` false → fallback к recreate-пути. `trade.stopLoss=null` (только TP) → `isSlDead` false, проверится только `isTpHit`. ОК.
- Telegram alert только в reconcile (auto-путь), в fix-protection — через response (юзер уже видит UI). ОК.
- Side в DB хранится как 'BUY'/'SELL' (uppercase) — `side === 'BUY'` сравнение корректно (engine.js:191 уже использует тот же паттерн).

## Файлы

- `/Users/iofinkel/Documents/tradingAlgo/besttrader/backend/src/services/indicators/engine.js` — helpers + reconcile early-close (OK)
- `/Users/iofinkel/Documents/tradingAlgo/besttrader/backend/src/routes/portfolio.js` — fix-protection early-close (OK)
- `/Users/iofinkel/Documents/tradingAlgo/besttrader/frontend/src/pages/Portfolio.jsx:130-138` — fixProtection handler **требует обновления** для нового `action: 'emergency_closed'` response.
