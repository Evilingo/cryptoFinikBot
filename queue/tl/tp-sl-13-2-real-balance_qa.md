# QA Report: tp-sl-13-2-real-balance

## Баги

### [CRITICAL] `free` = walletBalance включает ВСЕ существующие холдинги монеты — TP/SL зарезервирует чужой баланс — backend/src/services/bybit/rest.js:450, backend/src/services/indicators/engine.js:321

**Причина:**
`getAccountBalance()` (rest.js:111-128) маппит `free = c.walletBalance || c.availableToWithdraw`. На Bybit UNIFIED `walletBalance` — это **полный баланс монеты на кошельке**, а не свободный остаток после только что выполненного Market BUY.

Сценарий:
1. У пользователя уже лежит 0.5 BTC (от прошлых трейдов / депозитов / ручной покупки).
2. Manual Place Order: BUY 0.001 BTC + SL + TP (Market).
3. Phase 1 fill → walletBalance ≈ 0.5009 BTC.
4. Наш код: `free = 0.5009` → `floored = 0.5009` → `realQty = 0.5009`.
5. `placeTpSl(..., 0.5009)` ставит TP/SL на **весь существующий баланс BTC**.
6. При срабатывании TP/SL пользователь теряет 0.5 BTC, не относящихся к этой сделке.

То же в `executeAutoTrade` Phase 2 (engine.js:319): если у пользователя есть BTC от ранее открытых трейдов или вне-системных холдингов, `tpSlQty` будет завышен → TP-Limit-sell на чужие активы.

В close-trade (portfolio.js:96-105) поведение допустимо: цель — закрыть всё, что есть. Здесь же резервируем под конкретную сделку — нужна **дельта**, а не абсолют.

**Исправление:**
Вычислить дельту относительно баланса ДО Market BUY. Минимально:
```js
// rest.js placeManualOrder Market-branch:
const baseAsset = symbol.replace(/USDT$|USDC$/, '');
let realQty = qty;
if (orderType === 'Market' && (stopLoss || takeProfit)) {
  // снимок баланса ДО privatePost (вынести выше); fallback на min(free, qty)
  ...
  const free = parseFloat(coin?.free || coin?.total || 0);
  if (free > 0) {
    // никогда не превышаем исходный qty — защита от резерва чужих холдингов
    const factor = Math.pow(10, info.qtyPrecision);
    const floored = Math.floor(Math.min(free, qty) * factor) / factor;
    if (floored > 0) realQty = floored;
  }
}
```
Аналогично в engine.js:315 — `Math.min(free, confirmedQty)`.
Это покрывает реальный кейс fee (free чуть меньше qty) без риска overshoot чужих холдингов.

---

### [HIGH] Race condition: параллельные авто-трейды и сторонние ордера на одной базовой монете — engine.js:319, rest.js:448

**Причина:**
`maxOpenTrades` по умолчанию 1, но настраивается. Если пользователь поднимет до 2+ и бот откроет два BUY на BTCUSDT параллельно (или manual + auto одновременно), оба прочитают `walletBalance` после своих fill'ов — каждый увидит сумму ОБОИХ. Оба попытаются поставить TP/SL на завышенный qty → у второго будет "Insufficient balance" 170131 (ловится `placeTpSl attempt failed` warn'ами и не приводит к крашу, но защита не выставится). При single-trade сценарии не воспроизводится, но архитектурно хрупко.

`dev-common-errors.md`: "Double balance lock: два независимых ордера на одну монету одновременно".

**Исправление:**
Тот же `Math.min(free, qty)` из CRITICAL fix снимает основную остроту. Полный fix (mutex по baseAsset) — вне scope KISS, оставить как известное ограничение в BACKLOG.

---

### [MEDIUM] Async gap: Bybit может не успеть обновить wallet до `getAccountBalance` после Market fill — rest.js:448, engine.js:319

**Причина:**
После `privatePost('/v5/order/create', body)` (rest.js:440) ответ возвращается при создании ордера, не при его исполнении. Market на Spot обычно филлится мгновенно, но wallet-update в UNIFIED-аккаунте идёт через внутренний event bus биржи и может отставать на 100–500ms. В Phase 2 engine.js аналогично: между `placeOrder` и `getAccountBalance` нет явного poll'а fill-статуса (Phase 1 poll — best-effort, может вернуться без подтверждения).

Если баланс ещё не обновлён, мы прочитаем СТАРЫЙ walletBalance (без только что купленных монет) → `floored < qty` → TP/SL поставится на меньший qty, чем фактически куплено. Минусы умеренные: остаток сядет на кошельке, но защита будет на части позиции.

**Исправление:**
Не блокирует. Допустимо как trade-off. Можно добавить короткий retry (300ms sleep + повторный `getAccountBalance`) если `floored < qty * 0.99`, но это усложнение — оставить на будущее, если в логах будет видно реальное проявление.

---

## Прочее (не блокирует)

- `parseFloat(coin?.free || coin?.total || 0)` — `getAccountBalance` всегда отдаёт `free` как непустую строку (`'0'` минимум, см. rest.js:126). `'0' || '5'` = `'0'` (truthy), parseFloat = 0. Edge `coin.free === ''` теоретически возможен, но фильтр `walletBalance > 0` (rest.js:123) исключает coin'ы с пустым балансом из результата. ОК.
- `Math.floor(free * factor) / factor` — корректно.
- SELL-entry в engine.js пропущен (`if (side === 'BUY')`) — соответствует задаче (13.6 отдельно).
- Manual SELL Market + SL/TP в `placeManualOrder` НЕ ограничен по side. После SELL базы не остаётся — `floored = 0` → fallback на исходный qty → `placeTpSl` для exitSide=Buy с qty=исходный. Это может быть нормально для Bybit (BUY-side TP/SL = условный buy-back), но семантика мутная. Оставить TL на решение: добавить `if (bybitSide === 'Buy')` или нет.
- `getAccountBalance` импорт в engine.js уже был (строка 6) — ОК.

---

## Вердикт

**BLOCK** — CRITICAL в обоих файлах. `walletBalance` = полный баланс монеты, не дельта от свежего fill'а. Текущий код в проде поставит TP/SL на чужие холдинги BTC/ETH/SOL/BNB, если они есть на кошельке. Минимальный фикс — `Math.min(free, qty)` в обоих местах.
