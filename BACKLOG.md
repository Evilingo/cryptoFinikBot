# BACKLOG

Баги и задачи, выявленные тестировщиком (ui-coverage.js), KISS-аудитором и ручным анализом.

---

## Раздел 0 — Backend баги (логические)

Источник: ручной анализ кода.

---

### ~~BUG-00~~ — WAIT-сигналы навсегда остаются PENDING ✅ FIXED
**Файл:** `backend/src/services/signals/tracker.js:12-17`
**Проблема:** `trackSignalOutcomes` фильтрует только сигналы с `suggestedSl != null`. WAIT-сигналы имеют `suggestedSl: null`, поэтому трекер их никогда не подбирает. Они вечно висят в БД с `outcome: null` (PENDING). Не влияет на статистику, но засоряет таблицу сигналов и сбивает с толку в UI.
**Исправление:** При сохранении WAIT-сигнала сразу выставлять `outcome: 'WAIT'` (или специальное значение), чтобы не путать с реально открытыми позициями.

---

## Раздел 1 — UI баги (функциональные)

Источник: `backend/tests/ui-coverage.js` — 8 упавших тестов.

---

### BUG-01 — "Remember me" не работает
**Файл:** `frontend/src/pages/Login.jsx:95`
**Проблема:** `<input type="checkbox" defaultChecked/>` — нет `onChange`, нет state, нет логики. `login(username, password)` в `useAuth.jsx` не принимает параметр `remember`. Чекбокс полностью декоративный.
**Исправление:** Добавить `useState(true)` → `remember`, передать в `login()`, в `useAuth` — если `!remember`, удалять refresh-token cookie при закрытии вкладки (sessionStorage вместо persistent cookie).

---

### BUG-02 — "Change password" не работает
**Файл:** `frontend/src/pages/Settings.jsx:472`
**Проблема:** `<button className="btn btn-ghost">Change password</button>` — нет `onClick`. Кнопка декоративная.
**Исправление:** Добавить форму смены пароля + `PUT /api/auth/change-password` на бэкенде.

---

### BUG-03 — Emergency Stop не работает
**Файл:** `frontend/src/pages/Settings.jsx:337`
**Проблема:** `<button className="btn btn-short">Stop all trading</button>` — нет `onClick`. Автоторговлю нельзя экстренно остановить из UI.
**Исправление:** `onClick` → `api.put('/settings/autotrade', { autoTrade: false })` + WS-сообщение об остановке.

---

### BUG-04 — "Test prompt" не работает
**Файл:** `frontend/src/pages/Settings.jsx:432`
**Проблема:** `<button className="btn btn-ghost">Test prompt</button>` — нет `onClick`. Протестировать промпт из UI невозможно.
**Исправление:** `onClick` → `api.post('/settings/test-prompt')` → показать ответ Claude в модале.

---

### BUG-05 — "Send test" Telegram ничего не отправляет
**Файл:** `frontend/src/pages/Settings.jsx:453`
**Проблема:** `onClick={() => {}}` — пустой обработчик. Telegram-тест не работает.
**Исправление:** `onClick` → `api.post('/telegram/test')` → показать статус отправки.

---

### BUG-06 — Account: Username нельзя сохранить
**Файл:** `frontend/src/pages/Settings.jsx:466`
**Проблема:** `<input defaultValue={settings.username || 'admin'}/>` — uncontrolled input без `onChange`. Изменения не сохраняются. Нет кнопки Save.
**Исправление:** Перевести в controlled input + `PUT /api/auth/profile`.

---

### BUG-07 — Account: Email нельзя сохранить
**Файл:** `frontend/src/pages/Settings.jsx:470`
**Проблема:** `<input defaultValue={settings.email || ''}/>` — uncontrolled input без `onChange`. Поле email вообще не хранится в БД (`Settings` модель не имеет поля `email`).
**Исправление:** Добавить `email` в модель `User` + controlled input + Save.

---

### BUG-08 — Account секция: нет кнопки Save
**Файл:** `frontend/src/pages/Settings.jsx:460-475`
**Проблема:** В секции Account нет ни одного `onClick` — даже если исправить inputs на controlled, сохранить данные некуда.
**Исправление:** Добавить `<button onClick={saveAccount}>Save</button>` + соответствующий эндпоинт.

---

### ~~BUG-12~~ — OCO-ордер падает после успешного MARKET входа ✅ FIXED
**Файл:** `backend/src/services/exchange/index.js` → `placeOrder()`
**Проблема:** `placeOrder()` сначала выставляет MARKET entry, потом OCO. Если OCO отклоняется биржей (минимальный размер, недостаточный отрыв SL/TP от цены, временная ошибка), MARKET вход уже исполнен — позиция открыта без стопа. Бот логирует `warn: OCO failed after entry fill` и продолжает, Trade сохраняется без реального SL/TP. Закрывать вручную.
**Исправление:** При падении OCO после входа — немедленно выставить MARKET выход (закрыть позицию). Или: предварительно валидировать SL/TP против биржевых ограничений (min notional, min price step) до размещения входного ордера.

---

### BUG-11 — Статусы сигналов непонятны человеку
**Файл:** `frontend/src/components/primitives.jsx:100-107`
**Проблема:** `OutcomeBadge` показывает сырые DB-значения: "OPEN" (= PENDING, позиции нет), "NO TRADE" (= старый WAIT до фикса BUG-00), "WAIT" (= Claude отказал), "WIN"/"LOSS"/"BREAKEVEN". Пользователь не понимает разницу между "OPEN" (трекер ещё не проверил) и реально открытой позицией.
**Исправление:** Переименовать метки: OPEN → "TRACKING", NO TRADE → "SKIPPED (legacy)", WAIT → "SKIPPED". Добавить tooltip/hint с расшифровкой на hover. Также рассмотреть отдельный бейдж для сигналов с реальным Trade (linkage через `signalId`).

---

## Раздел 2 — KISS-нарушения (рефакторинг)

Источник: KISS-аудитор. Приоритет по критичности.

---

### ~~KISS-01~~ — detectSignal / detectSignalFromHistory — 95% одинаковый код ✅ FIXED
**Файл:** `backend/src/services/indicators/engine.js:338-409`
**Проблема:** Две функции с почти идентичной логикой детекции сигнала. Изменение алгоритма требует обновления в двух местах — основной риск расхождения.
**Исправление:** Выделить чистую функцию `runDetection(history, thresholdPct)`, которую вызывают обе.

---

### ~~KISS-02~~ — WS инициализация и переключение повторяются 3 раза ✅ FIXED
**Файл:** `backend/src/services/exchange/wsManager.js:22-95`
**Проблема:** Блоки `if (exchange === 'bybit') { startBybitXxx() } else { startBinanceXxx() }` встречаются в `initExchangeWs`, `switchExchangeWs` (старт) и `switchExchangeWs` (стоп).
**Исправление:** Вынести в `startExchangeServices(exchange)` и `stopExchangeServices(exchange)`.

---

### ~~KISS-03~~ — exchange/index.js: 5 функций с одинаковым if/else паттерном ✅ FIXED
**Файл:** `backend/src/services/exchange/index.js:33-81`
**Проблема:** `getAccountBalance`, `getMidPrice`, `getKlines`, `placeOrder`, `getOrderBook` — у каждой идентичная структура: если bybit — импортируем bybit/rest, иначе binance/rest.
**Исправление:** Вынести в `getAdapter(exchange)` → `{ getKlines, getMidPrice, ... }`.

---

### ~~KISS-04~~ — Расчёт SL/TP цен дублируется в Dashboard и SignalModal ✅ FIXED
**Файлы:** `frontend/src/pages/Dashboard.jsx:176-177`, `frontend/src/components/SignalModal.jsx:34-35`
**Проблема:** Идентичная формула в двух компонентах:
```js
price * (side === 'BUY' ? (1 - parseFloat(slPct)/100) : (1 + parseFloat(slPct)/100))
```
**Исправление:** Вынести в `frontend/src/utils/trade.js` → `calcSlTp(price, side, slPct, tpPct)`.

---

### ~~KISS-05~~ — Settings.jsx: saveBybitKeys повторяет testConnection ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:79-102, 168-188`
**Проблема:** Разбор `data.permissions` и построение `permLine`/`balLine` — полный copy-paste в двух функциях.
**Исправление:** Вынести `formatBybitTestResult(data)` → `{ ok, msg }`.

---

### ~~KISS-06~~ — Нормализация сигналов на фронтенде вместо бэкенда ✅ FIXED
**Файл:** `frontend/src/pages/Signals.jsx:23-34`
**Проблема:** Сложные fallback-цепочки `s.pair?.monitorSymbol || s.monitorSymbol || (typeof s.pair === 'string' ? s.pair : '') || ''` говорят о нестабильном формате API.
**Исправление:** Нормализовать поля сигнала в `routes/signals.js` перед отдачей клиенту.

---

### ~~KISS-07~~ — Повторяющиеся useEffect-паттерны загрузки в Stats ✅ SKIP
**Файл:** `frontend/src/pages/Stats.jsx:77-83`
**Проблема:** Три отдельных `useEffect(() => api.get(url).then(setter).catch(() => {}), [])` — одинаковая структура.
**Исправление:** Вынести в хук `useApiData(endpoint, setter)` или объединить в один `useEffect` с `Promise.all`.

---

### ~~KISS-08~~ — PnL-расчёт в tracker.js: дублированная формула ✅ FIXED
**Файл:** `backend/src/services/signals/tracker.js:38-58`
**Проблема:** Расчёт `outcomePnl` для LONG и SHORT — одинаковая формула, только знак меняется.
**Исправление:** `pnl = ((isLong ? current - entry : entry - current) / entry) * 100`.

---

### ~~KISS-09~~ — hashPrompt() вызывается один раз ✅ FIXED
**Файл:** `backend/src/server.js:18-20`
**Проблема:** Функция-обёртка на одну строку, используется ровно один раз.
**Исправление:** Инлайнить: `const currentHash = crypto.createHash('sha256').update(DEFAULT_PROMPT).digest('hex').slice(0, 16)`.

---

### ~~KISS-10~~ — SettingRow паттерн повторяется 4+ раза в Settings ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx`
**Проблема:** Структура `<div.row-setting><div.row-setting-info><strong/><span/></div><input/><button>Save</button></div>` повторяется для threshold, confidence, autoTradeAmount, maxOpenTrades.
**Исправление:** Компонент `<SettingRow label description value onChange onSave/>`.

---

### ~~KISS-11~~ — calculateDelta повторяется в инициализации и onWsMessage ✅ FIXED
**Файл:** `frontend/src/pages/Dashboard.jsx:86-92, 148-152`
**Проблема:** Расчёт `((lastClose - firstOpen) / firstOpen) * 100` дублируется.
**Исправление:** `const calculateDelta = (candles) => ((candles.at(-1)?.c - candles[0]?.o) / candles[0]?.o) * 100`.

---

### ~~KISS-12~~ — Нормализация kline в двух местах Dashboard ✅ FIXED
**Файл:** `frontend/src/pages/Dashboard.jsx:79-97, 127-133`
**Проблема:** Разбор `{o, h, l, c, v}` из массива и из WS-объекта — два похожих блока без общей функции.
**Исправление:** `normalizeCandle(k)` → `{ o, h, l, c, v }`.

---

### ~~KISS-13~~ — Toggle — компонент из одной строки ✅ SKIP (4 places, keeping)
**Файл:** `frontend/src/components/primitives.jsx:106-108`
**Проблема:** `Toggle` — это `<div onClick={() => onChange(!on)} className={toggle on}/>`. Оправдан только если используется в 5+ местах.
**Исправление:** Оставить если мест много, иначе инлайнить.

---

### ~~KISS-14~~ — Возможный мёртвый импорт в balance.js ✅ SKIP (queryApiPermissions used in /test-bybit)
**Файл:** `backend/src/routes/balance.js:1-4`
**Проблема:** Импорт `queryApiPermissions` — проверить, используется ли напрямую или только внутри `getBybitBalance`.
**Исправление:** Убрать если не используется.

---

## Раздел 3 — OFI баги (из code review)

Источник: /review после реализации OFI стратегии.

---

### ~~BUG-09~~ — Float drift в sliding window OFI ✅ FIXED
**Файл:** `backend/src/services/indicators/ofiEngine.js:56-70`
**Приоритет:** Medium
**Проблема:** `buyVol` и `sellVol` накапливаются через `+=` / `-=` над тысячами float-операций. За несколько часов работы IEEE 754-округление приводит к тому, что сумма вычитаний не равна точно сумме сложений → `total` может уйти в отрицательное или дать ratio > 1. Guard `total === 0` отрицательный total не поймает.
**Исправление:** Пересчитывать `buyVol`/`sellVol` из самого массива `trades` на каждом чеке вместо инкрементального учёта:
```js
const buyVol = state.trades.reduce((s, t) => s + (t.isBuyerMaker ? 0 : t.vol), 0);
const sellVol = state.trades.reduce((s, t) => s + (t.isBuyerMaker ? t.vol : 0), 0);
```

---

### ~~BUG-10~~ — OFI ratio не сохраняется в БД ✅ FIXED
**Файл:** `backend/src/services/indicators/ofiEngine.js:100-112`
**Приоритет:** Low (observability)
**Проблема:** `ofiRatio` передаётся только в WS-broadcast и Telegram. Исторический OFI-сигнал в БД не содержит данных о силе сигнала — невозможно ни отфильтровать, ни проанализировать задним числом.
**Исправление:** Добавить `ofiRatio Float?` в модель `Signal` в schema.prisma, сохранять при `prisma.signal.create`.

---

### ~~KISS-15~~ — analyzeOfiWithClaude дублирует analyzeWithClaude ✅ FIXED
**Файл:** `backend/src/services/indicators/ofiEngine.js:139-194` vs `backend/src/services/indicators/engine.js:122-205`
**Проблема:** Обе функции выполняют идентичный flow: вызов Claude / skip, fetchEntryPrice, update signal в БД, broadcast SIGNAL_UPDATE, Telegram, executeAutoTrade. Разница только в вызове Claude и паре доп. полей в объекте broadcast.
**Исправление:** Вынести общий flow в `backend/src/services/signals/claudePipeline.js` → `runClaudePipeline(signalId, pair, midPrice, getAnalysis)` где `getAnalysis` — функция-параметр.
