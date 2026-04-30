# QA report — cost-trade-state-prefilter

QA: чисто.

## Проверено

1. **`shouldSkipClaude` логика (engine.js:49-71)** — корректна.
   - autoTrade=false → skip:false (Claude нужен для analytics) ✓
   - Нет existing OPEN/PENDING → skip:false ✓
   - openCount < maxOpenTrades → skip:false (есть слот) ✓
   - Другая пара при maxReached → skip ✓
   - Та же пара + same direction (BUY+LONG / SELL+SHORT) → skip ✓
   - Та же пара + opposite direction → skip:false (Claude нужен для reverse-close decision) ✓

2. **`applyPreFilterSkip` (engine.js:73-104)** — корректен.
   - `outcome: 'WAIT'` — НЕ баг: тот же паттерн уже используется в `claudePipeline.js:57` при Claude WAIT-ответе.
   - Tracker.js:70 обрабатывает только `outcome: null` → pre-filtered сигнал не попадает в WIN/LOSS симуляцию ✓
   - Analytics-фильтры (`tracker.js:109,426,469`) используют `outcome: { notIn: [null, 'EXPIRED', 'TIMEOUT'] }` И `direction: { not: 'WAIT' }`. Поскольку pre-filter ставит `direction:'WAIT'`, сигнал отфильтрован по direction-условию, в винрейт НЕ попадает ✓
   - Broadcast SIGNAL_UPDATE — поля совпадают с тем что фронт ожидает (id, monitorSymbol, tradeSymbol, direction, confidence, claudeAnalysis, suggestedSl/Tp, price + extra).

3. **OBD-путь (engine.js:190-197)** — pre-filter ПОСЛЕ Signal.create (:159) + broadcast SIGNAL (:182), ДО runClaudePipeline (:198). ✓

4. **OFI-путь (ofiEngine.js:124-131)** — pre-filter ПОСЛЕ Signal.create (:84) + broadcast SIGNAL (:100), ДО runClaudePipeline (:132). Импорт корректен (:12). ✓

5. **Регрессии** — не выявлены. autoTrade=false / нет open trades / есть слот / opposite-direction reverse → все проходят в Claude как раньше.

## Минор (не блокирует merge)

- `outcome: 'WAIT'` — нестандартное значение в схеме (`WIN|LOSS|BREAKEVEN|TIMEOUT|EXPIRED|null`), но уже используется в claudePipeline. Если когда-нибудь решат расширить аналитику и снять фильтр `direction != 'WAIT'`, нужно будет добавить `'WAIT'` в `outcome.notIn` явно. Сейчас — безопасно.

Готово к merge.
