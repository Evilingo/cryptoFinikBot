# Trade-state pre-filter — skip Claude when result is guaranteed no-op

**Priority:** PERF (optimization, не critical bug)
**Цель:** дополнительный pre-filter перед Claude — не платить за вызов когда результат заведомо не приведёт ни к открытию новой сделки, ни к закрытию существующей.

## Текущая проблема

В [engine.js processObdUpdate](backend/src/services/indicators/engine.js) и в OFI-handler'е:
1. Detect signal
2. Save Signal в БД
3. Broadcast SIGNAL (без analysis) на UI
4. **Call Claude → платим $$**
5. Update Signal с analysis
6. executeAutoTrade(analysis):
   - existingTrade guard → return early
   - maxOpenTrades guard → return early

Если уже открыт трейд (любая пара) при `maxOpenTrades=1`, шаг 6 заблокирует. Шаг 4 (Claude) **впустую**.

## Правило skip (вариант B)

Пропустить Claude когда **ВСЕ** условия:
1. `settings.autoTrade === true` (если auto-trade выключен — сохраняем analytics, Claude нужен)
2. Есть `OPEN` или `PENDING` trade в БД
3. `openCount >= settings.maxOpenTrades`
4. **ОДНО из:**
   - **a)** существующий trade.symbol **≠** `pair.tradeSymbol` (другая пара — не сможем ни открыть, ни закрыть reverse'ом)
   - **b)** существующий trade.symbol **===** `pair.tradeSymbol` И existing direction совпадает с signal direction:
     - existing.side === 'BUY' && signalDirection === 'LONG'
     - existing.side === 'SELL' && signalDirection === 'SHORT'

   (опциональное **c**, для агрессивности): пропускать только при confidence-floor — но не в этом фиксе

## Что делать при skip

```js
await prisma.signal.update({
  where: { id: signalId },
  data: {
    direction: 'WAIT',
    confidence: 0,
    claudeAnalysis: `[Pre-filter] ${reason}`,
  },
});

broadcast({ type: 'SIGNAL_UPDATE', signal: { ...пересобрать минимум полей... } });

logger.info('Trade-state pre-filter: skipping Claude call', {
  signalId,
  pair: pair.tradeSymbol,
  signalDirection,
  reason,
});
// НЕ вызывать executeAutoTrade
return;
```

Reason-строки:
- a) `Already ${existing.side} on ${existing.symbol}, maxOpenTrades reached`
- b) `Already ${existing.side} on ${pair.tradeSymbol}, same direction (${signalDirection})`

## Где применить

Два места — оба пути к Claude:

### 1. OBD путь — `analyzeWithClaude` в engine.js
Сейчас вызывает `runClaudePipeline` (из `services/signals/claudePipeline.js`).
Pre-filter ДО `runClaudePipeline`.

### 2. OFI путь — найти где `analyzeOfiSignal` (orchestrator.js) вызывается, применить аналогично.
Скорее всего это в `services/signals/ofi.js` или `services/binance/ofiEngine.js` — Dev пусть найдёт по grep.

**ВАЖНО:** pre-filter должен сработать ПЕРЕД любым Claude-call, но ПОСЛЕ того как Signal сохранён в БД (чтобы UI знал о сигнале и его исходе).

## KISS

- Один helper `shouldSkipClaude(pair, signalDirection)` → `{skip: boolean, reason: string}` в engine.js (module scope, exportable)
- Inline вызов в обоих путях
- Не выносить в отдельный файл (используется в 2 местах)

## Edge cases

- `settings.autoTrade === false` → не пре-фильтруем (Claude нужен для аналитики)
- `maxOpenTrades > 1`, openCount < max → не пре-фильтруем (есть место для новой сделки)
- Race: trade закрывается между pre-check и обработкой → могли бы открыть новую, но скипнули. Acceptable trade-off — следующий сигнал через 15 мин обработается.
- `existingTrade.status === 'PENDING'` → считаем как занятое место (он скоро станет OPEN или FAILED)

## Файлы

- `backend/src/services/indicators/engine.js` — helper + OBD pre-filter
- `backend/src/services/signals/[OFI handler]` — OFI pre-filter (Dev grepнёт)
- (возможно) другие места если есть

## Тестовые сценарии (mental check)

| Сценарий | Ожидаемое |
|---|---|
| maxOpenTrades=1, BTC trade open, ETH SHORT signal | SKIP (другая пара) |
| maxOpenTrades=1, BTC BUY open, BTC LONG signal | SKIP (та же пара, та же сторона) |
| maxOpenTrades=1, BTC BUY open, BTC SHORT signal | call Claude (потенциальный reverse-close) |
| Нет открытых трейдов | call Claude (нормальный flow) |
| autoTrade=false, всё что угодно | call Claude (analytics) |
| maxOpenTrades=2, openCount=1 | call Claude (есть место) |

## Ожидаемая экономия

- Бот держит позицию ~30% времени (примерно из observed)
- Сигналы по 4 парам равномерно
- Скип ~3/4 сигналов когда заняты другой парой = ~22% всех Claude-вызовов
- Плюс ~5-10% same-symbol-same-direction = 27-32% economy

В деньгах: $0.04/день → ~$0.028/день. Мизер, но принцип чистый.

## Отчёт Dev

В `queue/qa/cost-trade-state-prefilter_dev.md`:
- Одно предложение что сделал
- Snippet helper'а `shouldSkipClaude`
- Где именно вставлен pre-filter (OBD путь, OFI путь — указать file:line)
- Sanity:
  1. Pre-filter ПОСЛЕ сохранения Signal в БД
  2. Pre-filter ДО callClaude / runClaudePipeline
  3. При skip — Signal обновляется (direction=WAIT, conf=0, analysis с reason), broadcast SIGNAL_UPDATE, executeAutoTrade НЕ вызывается
  4. autoTrade=false → не пре-фильтруем
  5. Same-symbol opposite-direction → НЕ пре-фильтруем (нужен Claude для reverse-close)
