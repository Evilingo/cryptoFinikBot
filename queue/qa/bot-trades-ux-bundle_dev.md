# Dev Report: bot-trades-ux-bundle

Реализованы три связанных изменения в таблице Bot Trades: фикс призрачного закрытия по WS, новая колонка времени открытия, live-PnL для OPEN позиций.

## Изменённые файлы

### `backend/src/services/bybit/userDataStream.js:148`
- Добавлено поле `tradeId: trade.id` в broadcast `SIGNAL_OUTCOME`. Источник — реальный FILLED с биржи, поэтому `trade.id` гарантированно известен.

### `backend/src/services/bybit/reconciliation.js:84`
- То же самое — добавлено `tradeId: trade.id` в broadcast. Источник — догнанный FILLED.

### `frontend/src/pages/Portfolio.jsx`
1. **WS handler (строки 62-69)** — условие изменено с `msg.type === 'SIGNAL_OUTCOME' && msg.symbol` на `msg.type === 'SIGNAL_OUTCOME' && msg.tradeId`. Матчинг с `t.symbol === msg.symbol && t.status === 'OPEN'` заменён на `t.id === msg.tradeId`. События от `tracker.js` (без `tradeId`) фронт теперь игнорирует — как задумано.

2. **Таблица — колонка Time (thead строка 468, tbody строка 517)** — добавлен `<th>Time</th>` первым. В tbody — первая `<td>` содержит `DD.MM HH:MM:SS` по Europe/Moscow, собранный через `Intl.DateTimeFormat('ru-RU', {...}).formatToParts()` (так можно опустить год и запятую из дефолтного `ru-RU` вывода). Стиль — моноширный, серый, как другие "метаданные" ячейки.

3. **PNL cell (строка ~590)** — для `OPEN/CLOSING` с доступным `currentPrices[t.symbol]` считается:
   - `livePct = (isBuy ? (cur-entry)/entry : (entry-cur)/entry) * 100 - 0.2` (0.2% — round-trip fee, совпадает с userDataStream.js:125)
   - `liveUsd = qty * (cur - entry)` (инвертировано для SELL)
   - Формат: `+0.52% (+$4.52)`, цвет — по `livePct` (long/short/neutral > 0.1 / < -0.1).
   - CLOSED берёт `t.pnl` из БД как раньше.
   - Если `currentPrices` ещё не загружен для OPEN — fallback на `t.pnl` или `—`.

## Нюансы/решения

1. **`formatToParts` вместо ручных `getHours()/getUTCHours()`** — так корректно учитывается DST Europe/Moscow (технически Москва в фиксированном UTC+3 без DST с 2014, но API безопаснее). Склейка сделана вручную, потому что `ru-RU` по умолчанию даёт `24.04.2026, 19:09:45` — не подходит.

2. **Комментарий в WS handler сохранён** — объясняет почему условие именно на `tradeId`, а не на `symbol`. Это WHY-ошибка, которую легко повторно ввести.

3. **Не тронут `tracker.js`** — как явно указано в задаче. Он по-прежнему шлёт SIGNAL_OUTCOME без `tradeId` — фронт его игнорирует, а Stats-страница (если подписана) продолжит получать события для статистики Signal.

4. **Live-PnL пересчитывается на каждый рендер**, но `currentPrices` обновляется только раз в 4 с — значит пересчёт дешёвый. Без мемоизации (KISS).
