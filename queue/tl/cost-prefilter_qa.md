# QA Report — cost-prefilter

## Вердикт

QA: чисто.

## Проверено

### 1. Helpers (orchestrator.js:99-121)

- `obviousWaitForOfi`:
  - Rule 1 (`atr15m?.pct != null && atr15m.pct < 0.15`) — guard от null корректен. `atr15m=null` → `undefined != null` false → не срабатывает.
  - Rule 2 (`ofiRatio >= 35 && ofiRatio <= 65`) — нейтральная зона. При `undefined/NaN` сравнения дают false → безопасно.
  - Rule 3 (FLAT+FLAT+ATR<0.30) — оба `?.direction` безопасны для null/undefined; ATR-guard повторно явный.
- `obviousWaitForObd`: одно правило ATR<0.15, тот же явный guard. ОК.

### 2. Early return корректность

OFI (orchestrator.js:274-293) и OBD (orchestrator.js:352-370) возвращают одинаковый набор полей с обычным return: `direction, confidence, analysis, suggestedSl, suggestedTp, rsi, trend5m, trend15m, atr, atrPct`. 

- `rsi: null` корректно (tech ещё не вычислен — pre-filter стоит до `calcTechnicals`).
- `trend5m?.direction ?? null`, `atr15m?.value ?? null` — null-safe.
- `analysis: '[Pre-filter] ${reason}'` — префикс для UI.

### 3. Ordering

- Pre-filter стоит ПОСЛЕ `Promise.all` (где получаем atr15m / trend5m / trend15m) и ДО `calcTechnicals` / `callClaude`. Claude не дёргается при срабатывании.
- В `analyzeOfiSignal`: `getKlines` остался в Promise.all — уйдёт сетевой запрос даже при pre-filter hit. Trade-off (network vs Claude) приемлемый, не блокер.

### 4. Регрессии

- `if (!anthropic) { return ... }` (orchestrator.js:265 для OFI, :343 для OBD) стоит ПЕРЕД `Promise.all` и pre-filter. При отсутствии API key поведение полностью сохранено (default `direction: ofiDirection` для OFI, `direction: 'LONG'` для OBD). Pre-filter не перехватывает этот путь. ОК.
- Когда helpers возвращают null — выполнение продолжается к Claude как раньше. Нет изменения существующего поведения.

### 5. Edge cases

- `atr15m=null` → `?.pct` = undefined → `undefined != null` = false → guard срабатывает, helper возвращает null. ОК.
- `atr15m.pct=0` → `0 < 0.15` true → return reason. Корректно (нулевая волатильность = WAIT).
- `ofiRatio=NaN` → все сравнения false → не срабатывает по Rule 2. ОК.
- `tech.rsi` (обычный return) vs `null` (pre-filter) — оба `null|number`, формально совместимы. Не баг.

## Багов не найдено

Реализация соответствует ТЗ. Можно мерджить.
