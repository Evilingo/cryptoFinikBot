# Bot Trades UX bundle — 3 связанные задачи в одном файле фронта

Все три изменения трогают `frontend/src/pages/Portfolio.jsx` (таблица Bot Trades). Делаются одним Dev-проходом, чтобы избежать конфликтов.

---

## Задача 1 — Fix phantom-close bug (SIGNAL_OUTCOME)

### Проблема
`SIGNAL_OUTCOME` шлётся из трёх источников с **одинаковым форматом**, но **разной семантикой**:

| Источник | Trade в БД |
|---|---|
| `backend/src/services/signals/tracker.js:82` | **OPEN** (симуляция по midPrice) |
| `backend/src/services/bybit/userDataStream.js:145` | CLOSED (реальный FILLED) |
| `backend/src/services/bybit/reconciliation.js:81` | CLOSED (догнали пропущенный FILLED) |

Фронт [Portfolio.jsx:62-69](frontend/src/pages/Portfolio.jsx) слепо помечает все OPEN trades по символу как CLOSED при любом SIGNAL_OUTCOME → призрачное закрытие до refresh. Плюс матчинг по `symbol` без `tradeId` закрывает **оба** trade если на символе открыто две позиции.

### Решение
**Backend** — в `userDataStream.js:145` и `reconciliation.js:81` добавить `tradeId: trade.id` в broadcast (они уже знают `trade.id` в локальной переменной). `tracker.js:82` **не трогать** — он про Signal, не Trade.

**Frontend** — в `Portfolio.jsx:62-69` заменить матчинг:
- Обрабатывать только если `msg.tradeId` присутствует
- Матчить по `t.id === msg.tradeId` (не по symbol+status)
- Если `msg.tradeId` нет — игнорировать (tracker-события фронту неинтересны)

### Файлы
- `backend/src/services/bybit/userDataStream.js:145` — добавить `tradeId: trade.id`
- `backend/src/services/bybit/reconciliation.js:81` — добавить `tradeId: trade.id`
- `frontend/src/pages/Portfolio.jsx:62-69` — перематчить логику

---

## Задача 2 — Колонка Opening Time в Bot Trades

### Что
Новая колонка "Time" перед "Symbol" (или после — на усмотрение Dev, главное видно в таблице). Источник данных — `t.createdAt`.

### Формат
```
24.04 19:09:45
```
Timezone: Europe/Moscow (UTC+3, постоянный).

Реализация:
```js
new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(t.createdAt))
```

Дефолтный вывод `ru-RU` даст `24.04.2026, 19:09:45`. Нужен формат без года и запятой — `24.04 19:09:45`. Проще вручную собрать:
```js
const d = new Date(t.createdAt);
const pad = n => String(n).padStart(2, '0');
// через toLocaleString с timeZone и потом вручную форматировать — либо Intl.DateTimeFormat и склейка
```

Выбор реализации — за Dev, но результат должен быть ровно `DD.MM HH:MM:SS` по Москве.

### Стиль
Как остальные ячейки таблицы — `fontFamily: 'var(--font-mono)'`, `fontSize: 12`, `color: 'var(--text-3)'`.

### Файлы
- `frontend/src/pages/Portfolio.jsx` — добавить `<th>` в thead (ссылка на строку ~467) и `<td>` в tbody (~505).

---

## Задача 3 — Live PnL для OPEN trades в колонке PNL

### Что
Сейчас колонка PNL ([Portfolio.jsx:562-564](frontend/src/pages/Portfolio.jsx)) показывает `t.pnl` только для CLOSED — для OPEN рендерится `—`. Нужно: для OPEN/CLOSING считать PnL в реальном времени от текущей цены.

### Формулы
- BUY: `pnlPct = (current - entry) / entry * 100 - 0.2`
- SHORT/SELL: `pnlPct = (entry - current) / entry * 100 - 0.2`
- `pnlUsd` (оба направления): `qty * (current - entry)` для BUY, `qty * (entry - current)` для SELL
- Знак `-0.2` совпадает с round-trip fee в `userDataStream.js:125` — единая модель.

### Формат
`+0.52% (+$4.52)` — процент жирнее/крупнее, доллары в скобках мельче серым. Или как подскажет текущий стиль колонки.

Цвет тот же: `var(--long)` если pnlPct > 0.1, `var(--short)` если < -0.1, иначе `var(--text-3)`.

### Источник current
Использовать `currentPrices[t.symbol]` (уже пулится каждые 4с через [Portfolio.jsx:91-114](frontend/src/pages/Portfolio.jsx)). Не создавать отдельный запрос.

Если `currentPrices[t.symbol]` ещё не загружен — показать `—` (как сейчас).

### Поведение по статусам
- `OPEN` / `CLOSING` — считать live PnL от current
- `CLOSED` — брать `t.pnl` из БД (как сейчас)
- Если `currentPrices[t.symbol]` отсутствует для OPEN — `—`

### Файлы
- `frontend/src/pages/Portfolio.jsx:562-564` — заменить рендер ячейки PNL.

---

## Ограничения для Dev

- KISS. Всё в одном файле фронта + два мелких add в бэке.
- Без новых хелперов/утилит, если используется один раз.
- Без комментариев кроме одной строки для non-obvious WHY (где уместно).
- Без изменений в других компонентах/страницах.
- Не трогать `tracker.js` (задача явно говорит — не добавлять туда tradeId).

## Формат отчёта Dev

В `queue/qa/bot-trades-ux-bundle_dev.md`:
- Одно предложение что сделал
- Список изменённых файлов с построчным описанием
