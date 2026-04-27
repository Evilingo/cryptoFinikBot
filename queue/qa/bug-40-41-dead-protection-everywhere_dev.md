# BUG-40 + BUG-41 — Dev отчёт

Перенёс dead-check в начало пути на трёх уровнях (reconcile loop, fix-protection route, UI рендер) и расширил Fix-кнопку, чтобы зомби-протекция (placed-but-dead SL / hit TP) больше не маскировалась под "already protected".

---

## 1. `backend/src/services/indicators/engine.js` — `reconcileTpSl`

**Before** (порядок внутри `for (const trade of openTrades)`):
```js
const ageMs = ...;
if (ageMs >= AGE_LIMIT_MS) { logger.debug('Skipping old trade'); continue; }
try {
  // ... fetch orders, compute slPlaced/tpPlaced ...
  if (slPlaced && tpPlaced) continue;
  // dead-check (с guard !slPlaced / !tpPlaced) ...
  // recreate ...
}
```

**After**:
```js
for (const trade of openTrades) {
  try {
    // Dead-check FIRST (always, regardless of age)
    let currentPrice = null;
    try { currentPrice = await getMidPrice(trade.symbol); } catch {}
    if (currentPrice) {
      const slDead = isSlDead(trade.side, currentPrice, trade.stopLoss);
      const tpAlreadyHit = isTpHit(trade.side, currentPrice, trade.takeProfit);
      if (slDead || tpAlreadyHit) {
        // ... cancelExitProtection → getAccountBalance → placeOrder market → telegram → continue ...
      }
    }

    const ageMs = now - new Date(trade.createdAt).getTime();
    if (ageMs >= AGE_LIMIT_MS) {
      logger.debug('Skipping old trade for recreate', ...);
      continue;
    }

    // fetch orders, compute slPlaced/tpPlaced, recreate ...
  } catch (err) { ... }
}
```

Старый inline dead-check (стоял после `slPlaced && tpPlaced` early-return) удалён — теперь один dead-check в начале for-iteration, без guard `!slPlaced`. Старые трейды (>55 мин) теперь тоже покрываются dead-check, но в recreate-ветку всё ещё не идут.

---

## 2. `backend/src/routes/portfolio.js` — `POST /trades/:id/fix-protection`

**Before**:
```js
if (!trade.stopLoss && !trade.takeProfit) return 400;

const exitSide = ...;
const ordersData = await getOpenOrders(trade.symbol);
// ... compute slPlaced/tpPlaced ...
if (slPlaced && tpPlaced) return res.json({ message: 'Protection already present' });  // ← placed-but-dead застревал тут

// dead-check (с guard !slPlaced / !tpPlaced) ...
```

**After**:
```js
if (!trade.stopLoss && !trade.takeProfit) return 400;

// Dead-check FIRST — независимо от placed state
let currentPrice = null;
try { currentPrice = await getMidPrice(trade.symbol); } catch {}
if (currentPrice) {
  const slDead = isSlDead(trade.side, currentPrice, trade.stopLoss);
  const tpAlreadyHit = isTpHit(trade.side, currentPrice, trade.takeProfit);
  if (slDead || tpAlreadyHit) {
    // ... cancelExitProtection → balance → placeManualOrder Market →
    return res.json({ ok: true, action: 'emergency_closed', reason, orderId });
  }
}

const exitSide = ...;
const ordersData = await getOpenOrders(trade.symbol);
// compute slPlaced/tpPlaced
if (slPlaced && tpPlaced) return res.json({ message: 'Protection already present' });  // уже не dead — Step выше проверил
// recreate ...
```

Guard `!slPlaced` / `!tpPlaced` на dead-check убран — теперь он работает и для placed-but-dead кейса, который был причиной BUG-40.

---

## 3. `frontend/src/pages/Portfolio.jsx` — Bot Trades рендер

**Before** (бейджи и Fix-кнопка):
```jsx
{hasSlOrder && <span className="badge badge-pending" title="Stop-Loss order active">SL ✓</span>}
{hasTpOrder && <span className="badge badge-win" title="Take-Profit order active">TP ✓</span>}
...
{((t.stopLoss && !hasSlOrder) || (t.takeProfit && !hasTpOrder)) && <button>Fix</button>}
```

**After** (computed выше блока бейджей):
```jsx
const cur = currentPrices[t.symbol];
const slDeadInUi = cur && t.stopLoss && (isBuy ? cur <= t.stopLoss : cur >= t.stopLoss);
const tpHitInUi = cur && t.takeProfit && (isBuy ? cur >= t.takeProfit : cur <= t.takeProfit);
const slNeedsAttention = t.stopLoss && (!hasSlOrder || slDeadInUi);
const tpNeedsAttention = t.takeProfit && (!hasTpOrder || tpHitInUi);
```

```jsx
{hasSlOrder && (slDeadInUi
  ? <span className="badge badge-loss" title="SL trigger crossed — order won't fire">SL ⚠ DEAD</span>
  : <span className="badge badge-pending" title="Stop-Loss order active">SL ✓</span>
)}
{hasTpOrder && (tpHitInUi
  ? <span className="badge badge-warn" title="TP target reached — order should fire">TP ⚠ HIT</span>
  : <span className="badge badge-win" title="Take-Profit order active">TP ✓</span>
)}
...
{(slNeedsAttention || tpNeedsAttention) && <button title="Fix missing or dead SL/TP">Fix</button>}
```

Без импорта `isSlDead/isTpHit` с бэка — inline computed на основе `currentPrices[t.symbol]` (KISS, не плодим зависимость фронт↔бэк).

---

## Sanity checklist

1. **Reconcile dead-check ДО AGE_LIMIT** — dead-check теперь на строках ~436–475 `engine.js`, AGE_LIMIT skip — ниже на строке ~478. Старые трейды (>55 мин) проходят через dead-check, но не через recreate. ✅
2. **Fix-protection dead-check ДО early-return "already protected"** — dead-check на строках ~136–175 `portfolio.js` (сразу после валидации трейда), `slPlaced && tpPlaced` early-return — ниже на строке ~184. Placed-but-dead SL теперь корректно эмердженси-клозится. ✅
3. **Старые inline dead-check блоки удалены** — в `engine.js` и `portfolio.js` остался ровно один dead-check на путь, без guard `!slPlaced`/`!tpPlaced`. Дубликатов нет. ✅
4. **UI computed `slDeadInUi/tpHitInUi`** — использует `currentPrices[t.symbol]` (заполняется существующим polling каждые 4с через Bybit public tickers), НЕ свежий fetch из обработчика. Никаких новых сетевых вызовов. ✅
5. **Fix-кнопка видна на dead/hit, не только missing** — условие `slNeedsAttention || tpNeedsAttention`, где каждый компонент = `t.stopLoss && (!hasSlOrder || slDeadInUi)`. Старое условие `(t.stopLoss && !hasSlOrder) || (t.takeProfit && !hasTpOrder)` заменено. Tooltip обновлён на "Fix missing or dead SL/TP". ✅

## Edge cases (отработаны)

- `currentPrice = null` (Bybit недоступен) → dead-check skipped, идёт обычный recreate flow. Не блокирует.
- Трейд без `stopLoss` И `takeProfit` → `isSlDead`/`isTpHit` вернут false (в helper-ах guard `if (!slPrice || !currentPrice) return false`). Не входим в emergency-close.
- В UI `currentPrices[t.symbol]` undefined пока polling не отработал → guard `cur && ...` корректно скипает, бейджи показывают `SL ✓` / `TP ✓` пока цены не пришли.
- Race в reconcile (Step A close → следующий tick видит OPEN trade без позиции на бирже): не адресовался, как и в исходном задании — опциональный follow-up.
