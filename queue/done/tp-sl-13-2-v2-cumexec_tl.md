# TL Review — TP/SL-13.2-v2 (cumExecQty polling)

## Вердикт: ✅ APPROVE (с MINOR-фиксом от TL)

Замена `getAccountBalance + Math.min` на polling `cumExecQty - cumExecFee` корректна в обоих файлах. Подход решает root cause: stale wallet → детерминированный per-order endpoint. Diff чистый, старая логика удалена, SELL-ветка не задета, fallback (gross qty) безопасен.

## Согласие с QA

Согласен с обоими MINOR. Решения:

- **MINOR #1 (orderId undefined guard)** — НЕ применяю. QA сам отметил «orderId всегда возвращается при успешном privatePost»; если ответ кривой — хуже не станет, пустой list, тихий fallback. Доп. ветка ради 2с в нереалистичном edge case = anti-KISS.
- **MINOR #2 (warn-лог при exhausted polling)** — ПРИМЕНИЛ сам. Это критично для проды: fallback после exhausted polling = тот самый gross qty, который изначально вызывал 170131. Без лога диагностика следующего рецидива слепая.

## Что применил сам

1. `backend/src/services/bybit/rest.js:467-469` — после loop: `if (realQty === qty) logger.warn('placeManualOrder: cumExecQty polling exhausted, using gross qty (170131 risk)', { orderId, symbol })`.
2. `backend/src/services/indicators/engine.js:279-281` — после loop, BUY-only: `if (side === 'BUY' && confirmedFilledQty === 0) logger.warn('Phase 1: cumExecQty polling exhausted, Phase 2 will use gross qty (170131 risk)', ...)`.

Однострочные additions, рантайм не меняют.

## Архитектурный взгляд (KISS)

- **2× polling (rest.js + engine.js)** — НЕ выношу в shared util. Логика похожая, но не идентичная (engine ловит avgPrice + cumExec, rest только cumExec; разные endpoints — privateGet vs getOrderHistory). KISS: 3 места — да, 2 — нет. Подтверждаю.
- **placeOrder не возвращает cumExec** — оставляем. Расширение сигнатуры ради экономии одного poll-цикла = премат. абстракция; engine.js уже polls для avgPrice независимо.
- **4×500ms ceiling** — разумен. Bybit p50 fill propagation <500ms; 2s покрывает p99 для typical Spot Market. Если bursty — exhausted-warn даст сигнал тюнить.

## Пост-деплой мониторинг (3 пункта)

1. **Алерт по warn-логам `cumExecQty polling exhausted`** — за 24ч после деплоя. Если ≥1 в день → polling ceiling мал, рассмотреть 6×500ms или экспоненциальный backoff. Если 0 — текущий 4×500ms достаточен.
2. **Счётчик 170131 ошибок (placeTpSl)** — должен обнулиться. Любой 170131 после деплоя = polling вернул некорректный qty (Bybit fee model изменился? округление?) → срочный rollback или patch.
3. **Latency Phase 1→Phase 2 в engine.js** — sample p50/p95. Раньше: 0ms (прямой Math.min). Теперь: до 3s (3×1000ms poll). Если auto-trade window узкий (быстрые рынки) — пересмотреть готовность жертвовать 1-3s ради точности qty.
