# Dev Report — cost-prefilter

## Что сделал

Добавил две module-scope helper-функции (`obviousWaitForOfi`, `obviousWaitForObd`) в `backend/src/services/claude/orchestrator.js` рядом с `formatHigherTf`, и два ранних return в `analyzeOfiSignal` / `analyzeSignal` сразу после `Promise.all` (до `calcTechnicals`), чтобы скипать Claude-вызов на очевидных WAIT-кейсах.

## Helper 1 — `obviousWaitForOfi`

```js
function obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m) {
  if (atr15m?.pct != null && atr15m.pct < 0.15) {
    return `ATR(15m) ${atr15m.pct}% < 0.15% — рынок спит, не торгуем`;
  }
  if (ofiRatio >= 35 && ofiRatio <= 65) {
    return `OFI ratio ${ofiRatio}% в нейтральной зоне (35-65%) — не сигнал`;
  }
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

## Helper 2 — `obviousWaitForObd`

```js
function obviousWaitForObd(atr15m) {
  if (atr15m?.pct != null && atr15m.pct < 0.15) {
    return `ATR(15m) ${atr15m.pct}% < 0.15% — слишком низкая волатильность для OBD mean-reversion`;
  }
  return null;
}
```

## Куда вставлен ранний return

### `analyzeOfiSignal` — после Promise.all, ДО `calcTechnicals(candles)`

Файл: `backend/src/services/claude/orchestrator.js`, строки ~272-294.

Контекст (3-5 строк до + сам ранний return):

```js
  const [systemPrompt, { trend5m, trend15m, atr15m }, candles] = await Promise.all([
    getOfiSystemPrompt(),
    fetchHigherTimeframes(pair.monitorSymbol),
    getKlines(pair.monitorSymbol, pair.timeframe || '1m', 20).catch(() => []),
  ]);

  const ofiPrefilterReason = obviousWaitForOfi(ofiRatio, trend5m, trend15m, atr15m);
  if (ofiPrefilterReason) {
    logger.info('OFI signal pre-filtered as WAIT (no Claude call)', {
      symbol: pair.monitorSymbol,
      ofiRatio,
      reason: ofiPrefilterReason,
    });
    return {
      direction: 'WAIT',
      confidence: 0,
      analysis: `[Pre-filter] ${ofiPrefilterReason}`,
      suggestedSl: null,
      suggestedTp: null,
      rsi: null,
      trend5m: trend5m?.direction ?? null,
      trend15m: trend15m?.direction ?? null,
      atr: atr15m?.value ?? null,
      atrPct: atr15m?.pct ?? null,
    };
  }

  const tech = candles.length ? calcTechnicals(candles) : {};
```

### `analyzeSignal` (OBD) — после Promise.all, ДО `calcTechnicals(candles)`

Файл: `backend/src/services/claude/orchestrator.js`, строки ~327-347.

Контекст:

```js
  const [systemPrompt, { trend5m, trend15m, atr15m }] = await Promise.all([
    getSystemPrompt(),
    fetchHigherTimeframes(pair.monitorSymbol),
  ]);

  const obdPrefilterReason = obviousWaitForObd(atr15m);
  if (obdPrefilterReason) {
    logger.info('OBD signal pre-filtered as WAIT (no Claude call)', {
      symbol: pair.monitorSymbol,
      reason: obdPrefilterReason,
    });
    return {
      direction: 'WAIT',
      confidence: 0,
      analysis: `[Pre-filter] ${obdPrefilterReason}`,
      suggestedSl: null,
      suggestedTp: null,
      rsi: null,
      trend5m: trend5m?.direction ?? null,
      trend15m: trend15m?.direction ?? null,
      atr: atr15m?.value ?? null,
      atrPct: atr15m?.pct ?? null,
    };
  }

  const tech = calcTechnicals(candles);
```

## Sanity checks

### 1. Все возвращаемые поля совпадают по форме с обычным return

Обычный return (нижний кусок `analyzeOfiSignal`):

```js
return {
  ...validated,
  rsi: tech.rsi ?? null,
  trend5m: trend5m?.direction ?? null,
  trend15m: trend15m?.direction ?? null,
  atr: atr15m?.value ?? null,
  atrPct: atr15m?.pct ?? null,
};
```

Pre-filter return имеет тот же набор ключей: `direction`, `confidence`, `analysis`, `suggestedSl`, `suggestedTp`, `rsi`, `trend5m`, `trend15m`, `atr`, `atrPct`. `rsi` явно `null`, поскольку `tech` ещё не вычислен (pre-filter стоит до `calcTechnicals`). Для `analyzeSignal` (OBD) — тот же набор.

### 2. `atr15m=null` не приводит к false positive

В обоих helper'ах используется явное:

```js
if (atr15m?.pct != null && atr15m.pct < 0.15) { ... }
```

При `atr15m=null` → `atr15m?.pct` это `undefined` → `undefined != null` это `false` → весь конъюнкт `false` → return null (helper не сработает). То же для правила #3 в OFI helper. Правило #2 (OFI ratio) от atr не зависит — корректно. Итог: `atr15m=null` НЕ вызывает ложного pre-filter по ATR-правилам.

### 3. Pre-filter применяется ДО `callClaude`

Ordering в обеих функциях:

```
Promise.all([systemPrompt, fetchHigherTimeframes, ...])
  └── получили atr15m, trend5m, trend15m
  └── pre-filter check → если matched, return WAIT (callClaude НЕ вызывается)
  └── calcTechnicals(candles)
  └── formatTechnicals / userMessage
  └── const text = await callClaude(...)
```

Ранний return `return { direction: 'WAIT', ... }` стоит до строки `const text = await callClaude(systemPrompt, userMessage);` в обеих функциях. Claude-API не дёргается при срабатывании pre-filter — экономия Claude-вызовов подтверждена.
