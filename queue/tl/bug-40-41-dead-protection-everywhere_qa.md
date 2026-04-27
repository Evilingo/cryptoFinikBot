# BUG-40 + BUG-41 — QA отчёт

QA: чисто.

## Что проверено

### 1. `engine.js` reconcileTpSl (строки 434–522)

- Dead-check стоит ПЕРВЫМ внутри `for` (строки 436–475), ДО `AGE_LIMIT` skip (строка 477). Старые трейды (>55 мин) теперь покрываются emergency close. Корректно.
- Старый inline dead-check (после `if (slPlaced && tpPlaced) continue`) полностью удалён — в текущем коде один dead-check на путь, без guard `!slPlaced`.
- `continue` после emergency close (строка 473) корректно пропускает AGE_LIMIT skip, fetch orders, slPlaced/tpPlaced compute и recreate.
- `getMidPrice` импортирован (строка 7).
- `cancelExitProtection`, `getAccountBalance`, `placeOrder`, `sendTelegramNotification` — все импортированы.

### 2. `portfolio.js` fix-protection (строки 126–209)

- Dead-check стоит ПЕРВЫМ после валидации трейда (строки 135–168), ДО `if (slPlaced && tpPlaced) return` (строка 177). Placed-but-dead SL теперь корректно эмердженси-клозится.
- Старый inline dead-check (с guard `!slPlaced && isSlDead`) удалён, дублей нет.
- Guard `!slPlaced`/`!tpPlaced` снят — обрабатывает placed-but-dead (BUG-40 фикс).
- `getMidPrice`, `isSlDead`, `isTpHit` импортированы (строки 14, 17).

### 3. `Portfolio.jsx` UI (строки 459–553)

- `slDeadInUi`/`tpHitInUi` computed (461–467) ДО рендера protection-бейджей (530–537).
- Использует `currentPrices[t.symbol]`, без сетевого вызова.
- Guard `cur && t.stopLoss` (соотв. `cur && t.takeProfit`) корректно скипает при undefined цене или отсутствии SL/TP.
- DIR-aware: `isBuy ? cur <= t.stopLoss : cur >= t.stopLoss` для SL и зеркальная логика для TP.
- Бейджи `SL ⚠ DEAD` (badge-loss) и `TP ⚠ HIT` (badge-warn) добавлены, классы соответствуют заданию.
- Условие Fix-кнопки расширено: `slNeedsAttention || tpNeedsAttention`, где `slNeedsAttention = t.stopLoss && (!hasSlOrder || slDeadInUi)`. Tooltip обновлён.
- Когда оба placed и не dead — кнопки нет, рендер прежний (`SL ✓ TP ✓`).

### 4. Регрессии

- Свежий трейд (<55мин) с живым SL: dead-check вернёт false, AGE_LIMIT не сработает, slPlaced=true, tpPlaced=true → continue. Идентично прежнему поведению.
- Свежий трейд с missing SL: dead-check skip (живой), AGE_LIMIT pass, slPlaced=false → recreate. Прежнее поведение.
- Fix-protection без protection и без dead: dead-check skip, slPlaced=false → pre-shrink + retry. Прежнее поведение.
- Healthy трейд (BNBUSDT case): hasSlOrder && !slDeadInUi → SL ✓; slNeedsAttention=false, tpNeedsAttention=false → нет Fix-кнопки.

### 5. Edge cases

- `currentPrice = null` (Bybit недоступен): `if (currentPrice)` false → пропуск dead-check, идём дальше. И в reconcile, и в fix-protection.
- Trade без stopLoss и без takeProfit: `isSlDead`/`isTpHit` возвращают false (helper-guard `if (!slPrice || !currentPrice) return false`). В reconcile дополнительно отсечётся валидацией fix-protection (`!trade.stopLoss && !trade.takeProfit → 400`). В reconcile loop dead-check вернёт false, идём дальше — не входим в block.
- `currentPrices[t.symbol]` undefined: `cur && ...` → falsy → `slDeadInUi=false`, бейдж SL ✓ показывается, Fix-кнопка не показывается. OK.
- `currentPrices` пустой стартом: `currentPrices[t.symbol]` = undefined → guard корректно срабатывает, рендер не падает.

## Минорное наблюдение (не баг, не блокер)

Reconcile теперь делает `getMidPrice` для каждого OPEN трейда на каждом 60-секундном тике (раньше только для трейдов <55мин с отсутствующей protection). При 1–3 одновременно открытых трейдах overhead незаметен; при росте лимита `maxOpenTrades` стоит держать в голове. Не требует изменений сейчас.
