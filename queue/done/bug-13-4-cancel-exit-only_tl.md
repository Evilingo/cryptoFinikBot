# BUG-13.4 — TL Report

## Вердикт

✅ **APPROVE** (MINOR применён самим TL)

## Согласие с QA

Согласен. QA-чек чистый: 4 правки корректны, exitSide во всех 3 callsites вычислен правильно (Bybit canonical 'Buy'/'Sell'), импорты обновлены, `cancelAllOpenOrders` оставлен exported для `userDataStream.js`, edge cases (targets=0, allSettled, getOpenOrders throw) обработаны.

Архитектурный вопрос «должна ли cancelExitProtection отменять non-exit-side ордера» — нет. Наши SL/TP всегда на противоположной от entry стороне (это инвариант spot trading). Текущая фильтрация `o.side === exitSide` корректна.

## Что применил сам (MINOR)

1. **INFO-лог при успешной полной отмене** в `cancelExitProtection` — для observability. `cancelAllOpenOrders` логирует success, новая функция теперь тоже:
   ```js
   } else {
     logger.info('cancelExitProtection: cancelled all targets', { symbol, exitSide, cancelled: succeeded });
   }
   ```

2. **BUG-37 занесён в BACKLOG** (Раздел 9, перед BUG-36) — future improvement: тегировать наши protection-ордера через `orderLinkId` prefix и матчить по нему вместо `isSlOrder`/`isTpOrder`, чтобы полностью не трогать manual Stop-Market юзера на той же exit-side. LOW priority, не регрессия (cancelAllOpenOrders делал то же самое).

## Пост-деплой мониторинг

1. **Логи `cancelExitProtection`** — следить за частотой `warn` (partial cancel failures) на проде. Если >5% вызовов даёт failed>0 — расследовать (rate limit, race с биржевым автозакрытием).
2. **Reverse-сигнал flow (engine.js:165)** — убедиться что после fix старая позиция корректно закрывается и новая открывается без orphan SL/TP от старой стороны. Глянуть Trade table + getOpenOrders на парах с реальным reverse за первую неделю.
3. **Manual Stop-Market юзера** — если кто-то из юзеров ставит ручные Stop-Market на тех же символах (на той же exit-side что и бот), мониторить жалобы — это вход в BUG-37 ROI.

## Future improvement

**BUG-37** — занесён в BACKLOG (Раздел 9). orderLinkId tagging для полной изоляции от user-orders. Реализовать когда: (а) появится юзкейс с ручными Stop-Market на тех же символах, или (б) при следующем рефакторе `placeSeparateTpSl` (он уже использует `tp-`/`sl-` prefix — нужно лишь распространить на cancel-side).
