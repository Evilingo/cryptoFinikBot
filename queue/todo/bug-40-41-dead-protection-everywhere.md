# BUG-40 + BUG-41: Dead protection detection — apply everywhere, surface in UI

**Critical:** сегодня BUG-39 фикс не помог 3 трейдам потому что они >55 мин, и потому что fix-protection не детектит dead **уже размещённый** SL. Зомби-протекция накапливает убытки молча.

## Три ветки фикса

### BUG-40a: `reconcileTpSl` — dead check ВСЕГДА (не блокировать AGE_LIMIT)

**Файл:** `backend/src/services/indicators/engine.js`

Сейчас:
```js
for (const trade of openTrades) {
  const ageMs = ...;
  if (ageMs >= AGE_LIMIT_MS) {
    logger.debug('[TpSlReconciliation] Skipping old trade', ...);
    continue;  // ← пропускает старые трейды до dead-check
  }
  // ... slPlaced/tpPlaced ...
  // ... dead-protection block (BUG-39 fix) ...
  // ... recreate-missing-protection ...
}
```

Нужно:
```js
for (const trade of openTrades) {
  // Step A: dead-protection check (always, regardless of age) — emergency close
  let currentPrice = null;
  try { currentPrice = await getMidPrice(trade.symbol); } catch {}
  if (currentPrice) {
    const slDead = isSlDead(trade.side, currentPrice, trade.stopLoss);
    const tpHit = isTpHit(trade.side, currentPrice, trade.takeProfit);
    if (slDead || tpHit) {
      // emergency close (cancel exit, getBalance, placeOrder market, telegram alert, continue)
      // ... [тот же блок что в текущем reconcile dead-check] ...
      continue;
    }
  }

  // Step B: AGE_LIMIT skip — для recreate-missing
  const ageMs = ...;
  if (ageMs >= AGE_LIMIT_MS) {
    logger.debug('[TpSlReconciliation] Skipping old trade for recreate', ...);
    continue;
  }

  // Step C: existing slPlaced/tpPlaced + recreate (NO MORE inline dead-check, оно уже в Step A)
}
```

**Удалить дубликат dead-check из текущего reconcile** (он сейчас стоит после `slPlaced/tpPlaced`). Перенести в начало loop. Это **рефакторинг** — поведение для свежих трейдов не меняется, только добавляется покрытие старых.

### BUG-40b: `fix-protection` route — dead check ПЕРВЫМ (до early-return "already protected")

**Файл:** `backend/src/routes/portfolio.js`

Сейчас порядок:
```js
1. Get trade, validate
2. Get exit-orders, compute slPlaced/tpPlaced
3. If slPlaced && tpPlaced → return early "already protected"
4. Dead-check (только если !slPlaced или !tpPlaced) → emergency close
5. Pre-shrink + retry placeTpSl
```

**Проблема:** трейд с **placed но dead** SL попадает в #3 → "already protected" вместо emergency close.

Нужно:
```js
1. Get trade, validate
2. Get current price (getMidPrice)
3. Dead-check ПЕРВЫМ (regardless of slPlaced/tpPlaced) → emergency close
4. Get exit-orders, compute slPlaced/tpPlaced
5. If slPlaced && tpPlaced → "already protected" (уже не dead — Step 3 проверил)
6. Pre-shrink + retry placeTpSl
```

В реальном коде:

```js
// Step 1+2: validate, get current price
let currentPrice = null;
try { currentPrice = await getMidPrice(trade.symbol); } catch {}

// Step 3: dead-check first — applies regardless of placed state
if (currentPrice) {
  const slDead = isSlDead(trade.side, currentPrice, trade.stopLoss);
  const tpHit = isTpHit(trade.side, currentPrice, trade.takeProfit);
  if (slDead || tpHit) {
    const reason = slDead
      ? `SL ${trade.stopLoss} уже пересечён (current ${currentPrice})`
      : `TP ${trade.takeProfit} уже достигнут (current ${currentPrice})`;
    logger.warn('Fix protection: dead protection detected, market closing', { tradeId: id, reason });

    const oldExitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
    const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
    await cancelExitProtection(trade.symbol, oldExitSide).catch(() => {});

    const baseAsset = trade.symbol.replace(/USDT$|USDC$/, '');
    let qty = trade.quantity;
    try {
      const coins = await getAccountBalance();
      const coin = coins.find(c => c.asset === baseAsset);
      const realQty = parseFloat(coin?.free || 0);
      if (realQty > 0) qty = realQty;
    } catch {}

    const result = await placeManualOrder({
      symbol: trade.symbol, side: closeSide, orderType: 'Market', qty,
    });
    return res.json({ ok: true, action: 'emergency_closed', reason, orderId: result?.orderId });
  }
}

// Step 4-5: existing logic (compute slPlaced/tpPlaced, early-return if both placed, pre-shrink retry)
const exitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
const ordersData = await getOpenOrders(trade.symbol);
// ... etc ...
```

**Удалить старый inline dead-check** (он сейчас после early-return "already protected", использует `!slPlaced` guard).

### BUG-41: UI — Protection badge показывает DEAD/HIT варнинг + Fix кнопка видна

**Файл:** `frontend/src/pages/Portfolio.jsx`

В рендере Bot Trades row добавить computed:
```js
const cur = currentPrices[t.symbol];
const slDeadInUi = cur && t.stopLoss && (
  t.side === 'BUY' ? cur <= t.stopLoss : cur >= t.stopLoss
);
const tpHitInUi = cur && t.takeProfit && (
  t.side === 'BUY' ? cur >= t.takeProfit : cur <= t.takeProfit
);
```

Заменить рендер protection-бейджей:
```js
{hasSlOrder && (slDeadInUi
  ? <span className="badge badge-loss" title="SL trigger crossed — order won't fire">SL ⚠ DEAD</span>
  : <span className="badge badge-pending" title="Stop-Loss order active">SL ✓</span>
)}
{hasTpOrder && (tpHitInUi
  ? <span className="badge badge-warn" title="TP target reached — order should fire">TP ⚠ HIT</span>
  : <span className="badge badge-win" title="Take-Profit order active">TP ✓</span>
)}
```

Заменить условие Fix кнопки:
```js
// Before:
{((t.stopLoss && !hasSlOrder) || (t.takeProfit && !hasTpOrder)) && <Fix button />}

// After:
const slNeedsAttention = t.stopLoss && (!hasSlOrder || slDeadInUi);
const tpNeedsAttention = t.takeProfit && (!hasTpOrder || tpHitInUi);
{(slNeedsAttention || tpNeedsAttention) && <Fix button />}
```

Title-tooltip Fix кнопки можно обновить: "Fix missing or dead SL/TP".

## KISS

- helpers (`isSlDead`/`isTpHit`) уже module-scope в engine.js — переиспользовать в reconcile
- Не выносить в новые файлы
- Не дублировать emergency-close блок целиком — переиспользовать паттерн что уже есть в BUG-39 фиксе
- Для UI: inline computed `slDeadInUi`/`tpHitInUi`, без хелперов

## Edge cases

- `currentPrice = null` (Bybit недоступен) → пропускаем dead-check, идём в обычный flow. Не блокировать.
- Трейд без stopLoss + без takeProfit → оба isSlDead/isTpHit false → не входим в dead-block.
- В UI `currentPrices[t.symbol]` может быть `undefined` пока polling не завершился → guard `cur &&` корректно скипает.
- Race в reconcile: Step A emergency_close → continue. Если userDataStream долго обрабатывает FILLED — следующий tick reconcile увидит OPEN trade с уже отсутствующей позицией на бирже → `placeOrder` упадёт insufficient balance → log error в catch. Не блокер, но шумно. Можно дополнительно: после emergency close обновлять `Trade.status = 'CLOSING'` в БД сразу, чтобы reconcile его пропускал. **Опционально.**

## Файлы

- `backend/src/services/indicators/engine.js` — рефактор reconcileTpSl: dead-check → AGE_LIMIT → recreate
- `backend/src/routes/portfolio.js` — рефактор fix-protection: dead-check → already-protected → recreate
- `frontend/src/pages/Portfolio.jsx` — DEAD/HIT badges + расширенное условие Fix

## Отчёт Dev

В `queue/qa/bug-40-41-dead-protection-everywhere_dev.md`:
- Одно предложение что сделал
- Snippet каждого из 3 рефакторов (короткий before/after)
- Sanity:
  1. Dead-check в reconcile стоит ДО AGE_LIMIT
  2. Dead-check в fix-protection стоит ДО `slPlaced && tpPlaced` early-return
  3. Старый inline dead-check удалён (нет дублирования)
  4. UI computed `slDeadInUi/tpHitInUi` использует currentPrices, не свежий fetch
  5. Fix-кнопка показывается на dead/hit, не только missing
