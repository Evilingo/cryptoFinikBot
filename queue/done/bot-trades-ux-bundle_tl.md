# TL Report: bot-trades-ux-bundle

## Вердикт: APPROVE (с MINOR, применил сам)

## Комментарий к QA

Согласен с QA по всем 8 пунктам. Код Dev'а соответствует ТЗ, edge cases и формулы корректны. Но QA (и сам Dev, и сама задача) упустили архитектурную симметрию:

**Найденный MINOR (применил сам):** `backend/src/services/binance/userDataStream.js:83-90` — это **четвёртый** источник `SIGNAL_OUTCOME` (Binance-вариант реального FILLED), параллельный `bybit/userDataStream.js`. Задача перечислила только три источника (tracker / bybit userDataStream / bybit reconciliation), но `wsManager.js:32-37` переключает между биржами, и Binance-ветка всё ещё активна как fallback. Без `tradeId` там — на Binance-бирже фронт будет **игнорировать реальное закрытие сделки** (новое условие `msg.tradeId && ...`), и trade будет висеть OPEN/CLOSING до ручного refresh. Зеркально применил тот же фикс: добавил `tradeId: trade.id` в broadcast.

Консистентность `SIGNAL_OUTCOME` теперь такая:
- `tracker.js` (simulated по midPrice) — **без** `tradeId` → фронт игнорирует (correct, это Signal-событие, не Trade)
- `bybit/userDataStream.js` — **c** `tradeId` ✅
- `bybit/reconciliation.js` — **c** `tradeId` ✅
- `binance/userDataStream.js` — **c** `tradeId` ✅ (применил сам)

## Архитектурные проверки (всё чисто)

1. **Stats.jsx / Signals.jsx / Trades.jsx** — ни одна из этих страниц не подписана на WS (`useWebSocket` не импортируется), все данные тянут по REST. Игнорирование tracker-событий на фронте их не ломает.
2. **Dashboard.jsx** — подписан на WS, но обрабатывает только `OBD_UPDATE`/`KLINE`/`SIGNAL`. На `SIGNAL_OUTCOME` никак не реагирует — live-banner сигналов не страдает.
3. **Статистика сигналов** — считается на бэке из БД (`tracker.js:getEnhancedStats`, `/api/stats/*`), не зависит от того, слушает ли фронт `SIGNAL_OUTCOME`.
4. **Live-PnL пересчёт на каждый рендер** — действительно дешёвый (4 pairs × несколько trade rows), мемоизация лишняя (KISS соблюдён).

## Что применил сам

- `backend/src/services/binance/userDataStream.js:86` — добавил `tradeId: trade.id` в broadcast `SIGNAL_OUTCOME` для симметрии с Bybit-веткой.

## Что проверить в проде / ревью (не блокирует)

1. **Если юзер когда-нибудь снова запустит Binance-ветку** — убедиться, что реальное закрытие сделки теперь корректно обновляет UI (а не висит OPEN до refresh). Раньше работало случайно — старый matcher по `symbol+status='OPEN'` ловил broadcast без `tradeId`.
2. **Два одновременных trade на одном символе** — теперь закроется только правильный (ровно это и было целью задачи), но стоит прогнать вручную, чтобы подтвердить: entry двух позиций BTCUSDT → закрываем одну → вторая остаётся OPEN.
3. **`Intl.DateTimeFormat` каждый рендер на каждый ряд** — микро-оптимизация: можно вынести formatter в useMemo/модульный const, если таблица разрастётся до 100+ строк. Сейчас (≤10-20 рядов) несущественно.
