# Cost optimization step 2 — JS pre-filter перед Claude

**Цель:** отсечь очевидные WAIT-случаи в JS до вызова Claude. Экономия ~60-70% Claude-вызовов.

## Файл

- `backend/src/services/claude/orchestrator.js` — две helper-функции inline + ранний return в `analyzeOfiSignal` и `analyzeSignal`

## Helper 1: `obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m)`

Returns reason string or null.

```js
function obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m) {
  // Rule 1: extremely low volatility — market is asleep
  if (atr15m?.pct != null && atr15m.pct < 0.15) {
    return `ATR(15m) ${atr15m.pct}% < 0.15% — рынок спит, не торгуем`;
  }
  // Rule 2: OFI in neutral zone (defense in depth — OFI service usually filters this earlier)
  if (ofiRatio >= 35 && ofiRatio <= 65) {
    return `OFI ratio ${ofiRatio}% в нейтральной зоне (35-65%) — не сигнал`;
  }
  // Rule 3: no momentum + low volatility
  if (
    trend5m?.direction === 'FLAT' &&
    trend15m?.direction === 'FLAT' &&
    atr15m?.pct != null && atr15m.pct < 0.30
  ) {
    return `Оба ТФ FLAT + ATR ${atr15m.pct}% < 0.30% — момента нет`;
  }
  return null;
}
```

## Helper 2: `obviousWaitForObd(atr15m)`

Returns reason string or null. OBD сигнал сильнее — только одно правило.

```js
function obviousWaitForObd(atr15m) {
  if (atr15m?.pct != null && atr15m.pct < 0.15) {
    return `ATR(15m) ${atr15m.pct}% < 0.15% — слишком низкая волатильность для OBD mean-reversion`;
  }
  return null;
}
```

## Применение

### `analyzeOfiSignal` — после Promise.all, до callClaude

```js
const reason = obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m);
if (reason) {
  logger.info('OFI signal pre-filtered as WAIT (no Claude call)', {
    symbol: pair.monitorSymbol,
    ofiRatio,
    reason,
  });
  return {
    direction: 'WAIT',
    confidence: 0,
    analysis: `[Pre-filter] ${reason}`,
    suggestedSl: null,
    suggestedTp: null,
    rsi: tech.rsi ?? null,  // если tech уже вычислен; иначе null
    trend5m: trend5m?.direction ?? null,
    trend15m: trend15m?.direction ?? null,
    atr: atr15m?.value ?? null,
    atrPct: atr15m?.pct ?? null,
  };
}
```

### `analyzeSignal` — после fetchHigherTimeframes, до calcTechnicals

```js
const reason = obviousWaitForObd(atr15m);
if (reason) {
  logger.info('OBD signal pre-filtered as WAIT (no Claude call)', {
    symbol: pair.monitorSymbol,
    reason,
  });
  return {
    direction: 'WAIT',
    confidence: 0,
    analysis: `[Pre-filter] ${reason}`,
    suggestedSl: null,
    suggestedTp: null,
    rsi: null,
    trend5m: trend5m?.direction ?? null,
    trend15m: trend15m?.direction ?? null,
    atr: atr15m?.value ?? null,
    atrPct: atr15m?.pct ?? null,
  };
}
```

## KISS

- Inline functions в orchestrator.js
- Нет новых файлов
- Нет конфигурации в settings — пороги hardcoded
- Не трогать validateSlTp, prompts.js, callClaude

## Edge cases / типичные ошибки

- `atr15m` может быть `null` (fetchHigherTimeframes failed) → `atr15m?.pct < 0.15` вернёт `undefined < 0.15` = `false`. **НО**: безопаснее явно проверить `atr15m?.pct != null && atr15m.pct < 0.15` — что и сделано в snippet'ах.
- `ofiRatio` всегда число (от 0 до 100) — приходит из caller. Безопасно.
- `trend5m?.direction === 'FLAT'` — безопасно для null/undefined
- Не возвращать null из обеих helper'ов одновременно с разной формой — оба возвращают string|null

## Отчёт Dev

В `queue/qa/cost-prefilter_dev.md`:
- Одно предложение что сделал
- Snippet каждой helper-функции
- Где именно вставлен ранний return
- Sanity:
  1. Все возвращаемые поля совпадают по форме с обычным return (`rsi/trend5m/trend15m/atr/atrPct`)
  2. `atr15m=null` не вызывает false positive
  3. Pre-filter применяется ДО callClaude
