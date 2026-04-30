# TL verdict — cost-trade-state-prefilter

## Вердикт: APPROVE

Согласен с QA — реализация чистая, KISS-compliant.

## Архитектурно

- `shouldSkipClaude` + `applyPreFilterSkip` — single source of truth, оба пути (OBD/OFI) используют общие хелперы. Дублирования нет.
- Pre-filter ПОСЛЕ `Signal.create` + broadcast SIGNAL, ДО `runClaudePipeline` — порядок корректный, UI получает событие, статистика сохраняется.
- Same-symbol opposite-direction → НЕ скипается (нужен Claude для reverse-close decision) — корректно.
- Размер изменений: +69 в engine.js, +9 в ofiEngine.js. Компактно.

## Минор (в BACKLOG)

`ARCH-07` — `outcome: 'WAIT'` нестандартное значение, аналитика сейчас отфильтровывает через `direction != 'WAIT'`. Если расширят фильтры — нужно добавить `'WAIT'` в `outcome.notIn` явно. Не блокер, future-proofing.

## Пост-деплой мониторинг

1. **Логи:** `grep "Trade-state pre-filter: skipping Claude call"` в логах backend — должны появляться когда есть открытый трейд и приходит сигнал по другой паре или той же паре + same direction.
2. **Доля скипов:** % записей с `claudeAnalysis LIKE '[Pre-filter]%'` от всех Signals за сутки — целевое 20-30% (из расчёта: бот держит позицию ~30% времени × 3/4 пар без слота + ~5-10% same-symbol-same-direction). Сильно ниже 15% → pre-filter не срабатывает (баг). Сильно выше 35% → бот слишком долго в позиции.
3. **Same-symbol opposite-direction:** убедиться, что normal reverse-close сигналы (existing BUY + signal SHORT, existing SELL + signal LONG) проходят в Claude и доводятся до `runClaudePipeline`. Проверить grep'ом по логам что для `existing.symbol === pair.tradeSymbol` и противоположной стороны pre-filter не срабатывает (по `claudeAnalysis` без `[Pre-filter]` префикса).

Готово к merge.
