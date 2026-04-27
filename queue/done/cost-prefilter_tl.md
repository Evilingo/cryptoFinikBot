# TL Verdict — cost-prefilter

## Вердикт: APPROVE

Согласен с QA (чисто). Реализация соответствует ТЗ, код KISS, поля return-ов совпадают, null-guard'ы корректные. Pre-filter стоит ДО `callClaude` в обеих функциях — экономия Claude-вызовов подтверждена.

## MINOR

Не применял ничего. Код достаточно чистый, чтобы не трогать.

## Архитектурные решения (зафиксированы, не реализованы)

- **Hardcoded thresholds (0.15 / 0.30 / 35-65)** — оставляем inline. Через 1-2 недели, когда наберётся статистика по `[Pre-filter]` analysis, посмотрим — нужно ли вынести в `Settings` (адаптивный ATR threshold по volatility regime). Сейчас YAGNI.
- **`getKlines` в `Promise.all` для OFI** — остаётся (network call впустую при pre-filter hit). Перестановка pre-filter ДО `Promise.all` усложнила бы код двумя последовательными await'ами. Trade-off: +1 Bybit REST на отсеянный сигнал vs читаемость. KISS побеждает.
- **Counter "X% pre-filtered за N минут"** — не делаем. Анализ через grep по логам (`OFI signal pre-filtered as WAIT`) достаточен на первое время.

## Пост-деплой мониторинг (3 пункта)

1. **Доля pre-filtered за 24ч** — посчитать через логи (`grep "pre-filtered as WAIT" | wc -l` vs общее число OFI/OBD сигналов). Цель из ТЗ: 60-70% Claude-вызовов сэкономлено. Если меньше 40% — пороги слишком мягкие, если больше 85% — рискуем отсечь edge-cases.
2. **Ложно-позитивный pre-filter** — раз в 3 дня просмотреть выборку `[Pre-filter]` сигналов: совпадает ли с тем, что Claude всё равно дал бы WAIT? Проверка через ручной A/B: 1-2 дня отключить pre-filter, сравнить распределение confidence по тем же условиям.
3. **Частота правила #1 (ATR<0.15) vs #3 (FLAT+FLAT+ATR<0.30)** — из логов вытащить `reason`. Если правило #2 (OFI 35-65%) почти не срабатывает — значит OFI service уже фильтрует, можно убрать. Если правило #3 редко — порог 0.30 слишком жёсткий.

## Backlog

- **ARCH-07** — вынести pre-filter thresholds в `Settings` (ATR thresholds + neutral OFI band) с UI-редактированием. Трогать только если статистика покажет потребность в адаптивных значениях по pair/volatility regime.
- **PERF-03** — рефакторинг `analyzeOfiSignal`: вынести pre-filter ДО `Promise.all` (сначала fetchHigherTimeframes отдельно, потом если pre-filter не сработал — getKlines+systemPrompt). Экономит 1 Bybit REST на pre-filter hit. Делать только если упрёмся в Bybit rate-limit.
- **OBSV-04** — periodic stats log (раз в час: `pre-filtered: X/Y, %` per signal type). Реализовать когда понадобится дашборд cost-savings.
