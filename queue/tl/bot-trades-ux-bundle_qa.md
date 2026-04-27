# QA Report: bot-trades-ux-bundle

QA: чисто.

## Проверено

1. **Backend диффы** (`userDataStream.js:148`, `reconciliation.js:84`) — `tradeId: trade.id` добавлен в оба broadcast, `trade.id` гарантированно известен (не `trade?.id`). Tracker.js не тронут, SIGNAL_OUTCOME оттуда без `tradeId`, фронт его теперь игнорирует — соответствует ТЗ.

2. **WS handler** (Portfolio.jsx:62-68) — условие на `msg.tradeId` (truthy-check, id всегда ≥1), матчинг по `t.id === msg.tradeId`. Events от tracker без tradeId игнорируются корректно.

3. **Колонки таблицы** — thead 12 колонок (Time, Symbol, Side, Entry, SL, TP, Current, Qty, Status, Protection, PnL, action), tbody 12 колонок (td для каждой). Совпадают.

4. **Формат времени** — `Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour12: false, ... }).formatToParts()` с ручной склейкой `${day}.${month} ${hour}:${minute}:${second}` → даёт ровно `DD.MM HH:MM:SS` без года/запятой. С явным `hour12: false` полуночь рендерится как `00`, а не `24` (проверено).

5. **Live PnL формулы** — BUY/SHORT направления корректные, комиссия `-0.2` вычитается только из `livePct` (USD без комиссии — как в ТЗ). Знак `liveUsd` по `(curPrice - t.price)` для BUY, `(t.price - curPrice)` для SELL — согласован с направлением.

6. **Edge cases** —
   - `parseFloat(t.quantity) || 0` защищает от NaN (хотя Prisma отдаёт Float).
   - `currentPrices[t.symbol]` падает в falsy при 0/undefined → `isLive=false` → fallback на `t.pnl` или `—`.
   - `t.price > 0` защищает от деления на 0.
   - CLOSED сделки: `isLive=false` (статус не OPEN/CLOSING) → `t.pnl` из БД как раньше.
   - `t.price`/`t.quantity` в Prisma — `Float`, приходят числами в JSON.

7. **Цвет PnL** — `pnlForColor = livePct ?? t.pnl` → цвет считается от live-значения для OPEN, от БД для CLOSED. Корректно.

8. **Комиссия 0.2%** — вычитается только из процента, совпадает с round-trip fee в `userDataStream.js:125`. Единообразно.

Блокеров нет.
