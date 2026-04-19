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

---

## Раздел 4 — KISS-нарушения (аудит v2, 2026-04-19)

Источник: KISS-агент (автоматический аудит всей кодовой базы).

---

### KISS-16 — 10 PUT-маршрутов в settings.js с одинаковым паттерном
**Файл:** `backend/src/routes/settings.js:36-176`
**Проблема:** 10 функций с идентичной структурой: валидация поля из req.body → prisma.settings.update → res.json({ok:true}). Изменение паттерна (логирование, rate limit, аудит) требует правки в 10 местах.
**Исправление:** Фабрика `createSettingRoute(field, validator)` или единый PUT `/settings` с map валидаторов по ключу.

---

### KISS-17 — prisma.settings.findUnique({ where: { id: 1 } }) в 14+ файлах
**Файлы:** `binance/rest.js`, `bybit/rest.js`, `bybit/userDataStream.js`, `exchange/index.js`, `ofiEngine.js`, `engine.js`, `notifier.js`, `telegramBot.js`, `prompts.js`, `server.js`, `routes/settings.js` и др.
**Проблема:** Доступ к singleton Settings разбросан по всему коду без кеширования. При изменении схемы нужно менять в 14+ местах.
**Исправление:** `getSettings()` в `db/prisma.js` с кешем и TTL — аналог уже существующего `getDipThreshold()` в engine.js.

---

### KISS-18 — Паттерн saveXxx в Settings.jsx повторяется 10+ раз
**Файл:** `frontend/src/pages/Settings.jsx:77-193`
**Проблема:** Каждая из 10 save-функций: `try { await api.put(...); showStatus(true, msg) } catch { showStatus(false, err) }`. Идентичная структура, только endpoint и поля разные.
**Исправление:** `const apiSave = (endpoint, payload, msg) => api.put(endpoint, payload).then(...)` — переиспользовать вместо 10 копий.

---

### KISS-19 — showStatus (ok, msg) + setTimeout дублируется в 3 компонентах
**Файлы:** `Dashboard.jsx:60-63`, `Settings.jsx:77-80`, `SignalModal.jsx:53-56`
**Проблема:** Идентичная функция в трёх местах. При изменении таймаута (3000ms) нужно менять в трёх файлах.
**Исправление:** `useStatusToast()` хук → `{ status, showStatus }`.

---

### KISS-20 — Сложные fallback-цепочки в SignalModal
**Файл:** `frontend/src/components/SignalModal.jsx:24-31`
**Проблема:** `signal.claudeAnalysis || signal.analysis || ''`, `signal.suggestedSl || signal.stopLoss || signal.sl` — признак нестабильного формата. KISS-06 нормализовал `/signals` роут, но SignalModal получает сигналы из WS (broadcast) и из модала открытого вручную — разные форматы.
**Исправление:** Нормализовать WS SIGNAL_UPDATE broadcast в том же формате что и REST `/signals`. Тогда SignalModal получает один стабильный формат.

---

### KISS-21 — Дублированная логика кеширования Settings в engine.js и ofiEngine.js
**Файлы:** `engine.js:25-33`, `ofiEngine.js:31-39`
**Проблема:** `getDipThreshold()` и `isOfiEnabled()` — одинаковый паттерн: cachedValue + lastFetch + TTL + try/catch. Третья такая функция создаст антипаттерн.
**Исправление:** `makeSettingCache(fieldName, defaultValue, ttl)` — фабрика кешированного геттера.

---

### KISS-22 — Дублированная валидация дат в stats.js
**Файл:** `backend/src/routes/stats.js`
**Проблема:** Блок `new Date(from/to)` + `isNaN` + `fromDate >= toDate` повторяется в `/backtest` и `/optimize`.
**Исправление:** `validateDateRange(from, to)` → `{ ok, error, fromDate, toDate }`.

---

### KISS-23 — Паттерн showStatus в SignalModal идентичен Dashboard/Settings
**Файл:** `frontend/src/components/SignalModal.jsx:53-56`
**Проблема:** Третья копия `showStatus` + `setTimeout 3000`. См. KISS-19.
**Исправление:** То же — `useStatusToast()` хук.

---

## Раздел 5 — Инфраструктура торговли (trading improvements)

---

### TRADE-01 — Принудительный выход при обратном сигнале
**Приоритет:** Medium
**Проблема:** Если открыт LONG на ETH и OBD генерирует SHORT сигнал — система либо игнорирует его (лимит позиций), либо открывает вторую позицию. Нет механизма "умного выхода" при смене рыночной структуры.
**Исправление:** В `executeAutoTrade` при direction != направления открытой Trade на этом символе — принудительно закрыть открытую позицию (market sell/buy) до размещения новой. По сути: обратный сигнал = сигнал выхода из текущей позиции.
**Примечание:** На Spot SHORT — это продажа актива. Отдельная "шорт-позиция" не создаётся — просто закрываем LONG. Реализация: проверять `openTrade.side !== side` → вызвать `cancelAllOpenOrders` + market close.
**Зависимости:** Требует TRADE-02 (один символ — одна позиция).

---

### TRADE-02 — maxOpenTrades per symbol вместо глобального
**Приоритет:** High
**Проблема:** `openCount = prisma.trade.count({ where: { status: 'OPEN' } })` — глобальный счётчик. Позволяет иметь несколько OPEN Trade на одном символе, что ломает `findFirst` в userDataStream и делает `cancelAllOpenOrders` опасным (отменяет TP/SL всех позиций по символу).
**Исправление:** Заменить проверку на `{ status: 'OPEN', symbol: pair.tradeSymbol }`. Один символ = максимум одна позиция. Глобальный `maxOpenTrades` сохранить для ограничения суммарной экспозиции по всем символам.

---

### TRADE-03 — Reconciliation job: сверка открытых Trade с биржей
**Приоритет:** Medium
**Проблема:** Если fill-событие пропущено (WS разрыв) — Trade навсегда остаётся `status='OPEN'` в DB. Нет механизма периодической сверки.
**Исправление:** Cron каждые 5 минут: для каждой OPEN Trade запросить `/v5/order/history` по `binanceOrderId` — если биржа показывает исполненный exit ордер → закрыть Trade в DB с реальным PnL.

---

### TRADE-04 — PnL в userDataStream не учитывает комиссии
**Приоритет:** Low
**Проблема:** В `userDataStream.js` PnL считается как чистая разница цен без вычета 0.2% round-trip fee. Бэктест вычитает комиссии, реальные сделки — нет. Статистика реальных сделок выглядит лучше бэктеста искусственно.
**Исправление:** `pnl = roundedPnl - 0.2` (или точнее — вычитать 0.1% на вход + 0.1% на выход).

---

### TRADE-05 — placeSeparateTpSl fire-and-forget: ошибка SL не останавливает Trade
**Файл:** `backend/src/services/bybit/rest.js:placeSeparateTpSl()`
**Приоритет:** High
**Проблема:** `placeSeparateTpSl()` вызывается как fire-and-forget (`.catch(err => logger.warn(...))`). Если SL stop-ордер не создался (ошибка API, precision issue, rate limit) — Trade записывается в DB со статусом OPEN, позиция куплена, но стоп-лосса на бирже нет. Логируется warn, основной поток не прерывается.
**Исправление:** Ждать результата `placeSeparateTpSl` (await + try/catch). Если SL не создался — либо выходить из позиции немедленно (market sell), либо бросать ошибку и не создавать Trade запись. Минимум — Telegram алерт с требованием ручного вмешательства.

---

### TRADE-06 — Exit ордера матчатся по symbol+side, не по orderId
**Файл:** `backend/src/services/bybit/userDataStream.js:handleOrderFill()`
**Приоритет:** High
**Проблема:** При получении exit fill-события (TP или SL) система находит Trade через `findFirst({ symbol, status:'OPEN' })` — без привязки к конкретному orderId. `binanceOrderId` хранит entry orderId, но для exit не используется. При нескольких OPEN Trade на одном символе закрывается случайная запись (без ORDER BY в findFirst).
**Исправление:** Для separate TP/SL ордеров (Classic account) — `orderLinkId` содержит `tp-{entryOrderId[-28:]}` или `sl-{...}`. Парсить prefix (`tp-` / `sl-`) + suffix → искать Trade по `binanceOrderId LIKE %suffix`. Это привяжет exit к конкретному Trade.

---

### TRADE-07 — Race condition: fill-событие до Trade.create в DB
**Файл:** `backend/src/services/bybit/userDataStream.js`, `backend/src/services/indicators/engine.js`
**Приоритет:** Medium
**Проблема:** `placeOrder()` возвращает orderId → 300ms задержка (avgPrice) → `Trade.create()`. Если fill-событие для entry ордера придёт раньше чем Trade записана в DB (редко, но возможно при быстром исполнении) — entry fill не обновит `trade.price`, exit fill найдёт `openTrade=null` и пропустит закрытие.
**Исправление:** Уменьшить 300ms задержку или сначала создать Trade с `price=0`, потом обновить avgPrice. Entry fill обновляет price если `trade.price === 0` — эта логика уже есть, надо убедиться что Trade существует до того как могут придти fill-события.

---

### TRADE-08 — Exit fill пропускается при отсутствии OPEN Trade в DB
**Файл:** `backend/src/services/bybit/userDataStream.js:handleOrderFill()`
**Приоритет:** Medium
**Проблема:** Если `openTrade = null` (Trade удалена вручную, или ещё не создана — см. TRADE-07), то `isOpposingSide = false`. Для classic-аккаунта `stopOrderType = ''`, значит `isInlineTpSl = false`. `isExitOrder = false` → fill обрабатывается как entry fill, Trade не закрывается, Telegram не отправляется. Silent skip.
**Исправление:** Логировать warn при получении Filled ордера с Sell-направлением если нет OPEN Trade на символе — чтобы хотя бы видеть проблему в логах.

---

## Раздел 6 — Безопасность и архитектура (full code review, 2026-04-19)

Источник: полный аудит кодовой базы (агент).

---

### ~~SEC-01~~ — WebSocket не проверяет JWT токен ✅ FIXED
**Файл:** `backend/src/ws/hub.js:8-39`
**Приоритет:** CRITICAL
**Проблема:** Токен принимается из URL (`/ws?token=...`) но JWT не верифицируется. Любой клиент (без авторизации) может подключиться и получать live SIGNAL, SIGNAL_UPDATE, SIGNAL_OUTCOME — реальные торговые сигналы с ценами SL/TP.
**Исправление:** Добавить `jwt.verify(token, JWT_SECRET)` при upgrade, отклонять соединение при ошибке.

---

### ~~SEC-02~~ — Публичные API без аутентификации ✅ FIXED
**Файлы:** `routes/balance.js`, `routes/pairs.js`, `routes/signals.js`, `routes/stats.js`, `routes/klines.js`
**Приоритет:** CRITICAL
**Проблема:** Эндпоинты `/api/balance`, `/api/pairs`, `/api/signals`, `/api/stats*`, `/api/klines` не имеют `authMiddleware`. Любой пользователь может получить баланс аккаунта, историю сигналов, P&L статистику без логина.
**Исправление:** Добавить `authMiddleware` на все эти роуты. `/api/klines` можно оставить публичным (это рыночные данные), остальные — закрыть.

---

### SEC-03 — Telegram token/chatId хранятся незашифрованными в БД
**Файл:** `backend/src/services/notifications/notifier.js:18-37`
**Приоритет:** HIGH
**Проблема:** Bybit/Binance ключи шифруются AES-256-GCM перед записью в `Settings`. Telegram token и chat ID хранятся в открытом виде. При утечке БД — полный доступ к боту.
**Исправление:** Шифровать через `encrypt()`/`decrypt()` из `config/crypto.js` аналогично API ключам.

---

### SEC-04 — Telegram webhook не верифицирует подпись Telegram
**Файл:** `backend/src/routes/telegram.js:8-17`
**Приоритет:** HIGH
**Проблема:** `POST /telegram/webhook` принимает любой запрос. Злоумышленник может подделать webhook и вызвать команды бота.
**Исправление:** Верифицировать запрос через `X-Telegram-Bot-Api-Secret-Token` или HMAC SHA-256 подпись тела по рекомендации Telegram.

---

### SEC-05 — Trade order: не валидируются SL/TP на экономический смысл
**Файл:** `backend/src/routes/trade.js:10-48`
**Приоритет:** MEDIUM
**Проблема:** `POST /api/trade/order` принимает `stopLoss` и `takeProfit` без проверки: SL ≠ TP, SL < TP для LONG, SL > TP для SHORT. Можно разместить ордер с идентичными или перевёрнутыми уровнями.
**Исправление:** Добавить валидацию перед `placeOrder()`. Вернуть 400 с понятным сообщением.

---

### ARCH-01 — Signal создаётся до Claude — возможен permanent "Analyzing..."
**Файл:** `backend/src/services/indicators/ofiEngine.js:41-121`
**Приоритет:** HIGH
**Проблема:** OFI сигнал сохраняется в БД с пустым `claudeAnalysis`, затем Claude анализирует асинхронно. При падении бэкенда между созданием и Claude-ответом — сигнал навсегда остаётся без анализа (PENDING). OBD pipeline тоже создаёт Signal до Claude (`claudePipeline.js`).
**Исправление:** Рассмотреть паттерн "создать Signal только после ответа Claude". Или добавить TTL-cleanup для сигналов без `claudeAnalysis` старше 5 минут.

---

### ARCH-02 — Таймаут Signal в tracker.js: принудительный исход некорректен
**Файл:** `backend/src/services/signals/tracker.js:50-54`
**Приоритет:** MEDIUM
**Проблема:** Если за 1 час цена не достигла SL/TP — сигнал форсируется в WIN/LOSS/BREAKEVEN по текущей цене. Это создаёт ложные исходы в статистике. OBD-сигналы на mean-reversion — нормально. Но принцип "закрыть по таймауту по midPrice" может маскировать реальную неэффективность системы.
**Исправление:** Добавить `outcome: 'TIMEOUT'` как отдельный статус. Или вынести таймаут как настраиваемый параметр в Settings.

---

### ARCH-03 — symbolInfoCache растёт неограниченно
**Файлы:** `binance/rest.js:95-117`, `bybit/rest.js:213-244`
**Приоритет:** LOW
**Проблема:** `symbolInfoCache` — глобальная `Map` без LRU и без TTL. При большом количестве уникальных символов (в теории) — утечка памяти.
**Исправление:** Максимальный размер 100 записей или TTL 24 часа (символы не меняются часто).

---

### ARCH-04 — WS авто-реконнект без exponential backoff
**Файлы:** `frontend/src/hooks/useWebSocket.jsx:34-36`
**Приоритет:** LOW
**Проблема:** При отключении сервера клиент пытается переподключиться каждые 3 секунды бесконечно. При долгом downtime — лавина запросов на сервер при его возвращении.
**Исправление:** Exponential backoff: 3s → 6s → 12s → 30s (max).

---

## Раздел 7 — Full code review v2 (2026-04-19)

Источник: полный аудит кодовой базы после TRADE-02..08 и SEC-03 фиксов.

---

### BUG-13 — Trade.slOrderFailed — мёртвое поле, никогда не true
**Файл:** `backend/src/services/indicators/engine.js:261`, `backend/prisma/schema.prisma`
**Приоритет:** HIGH
**Проблема:** `slOrderFailed: false` записывается при создании Trade. При SL failure функция делает `return` до `trade.create` — Trade не создаётся вообще. Значит поле всегда `false`. При slFailed позиция существует на бирже, но в DB нет — `userDataStream` её никогда не закроет.
**Исправление:** Либо удалить поле из схемы, либо изменить логику: создавать Trade запись даже при slFailed со статусом `'OPEN'` и `slOrderFailed: true` — чтобы `userDataStream` мог её отследить и закрыть.

---

### BUG-14 — aggTradeWs нет `stopped` флага — ghost-reconnect при смене биржи
**Файлы:** `backend/src/services/binance/aggTradeWs.js`, `backend/src/services/bybit/aggTradeWs.js`
**Приоритет:** HIGH
**Проблема:** При `stopAggTradeWs()` убирается `reconnectTimer`, но если `ws.close()` вызывает `'close'` event до `removeAllListeners` — возникает реконнект. Остальные WS-сервисы используют `stopped = true`. При переключении биржи возможен ghost-reconnect старого aggTrade WS.
**Исправление:** Добавить `stopped` флаг по аналогии с остальными WS-сервисами проекта.

---

### BUG-15 — Смена пар при переключении биржи не атомарна
**Файл:** `backend/src/routes/settings.js:88-110`
**Приоритет:** MEDIUM
**Проблема:** `updateMany` + цикл upsert без транзакции. При краше посередине — часть пар активна для новой биржи, часть для старой. `switchExchangeWs` уже запущен, `activePairs` несогласован.
**Исправление:** Обернуть в `prisma.$transaction([...])`.

---

### BUG-16 — runOptimize блокирует event loop на больших данных
**Файл:** `backend/src/services/signals/tracker.js:288`
**Приоритет:** MEDIUM
**Проблема:** `runOptimize` выполняется синхронно. При 4 парах × 7 дней × 72 комбинации — 30-60s блокировки event loop. Нет timeout, нет streaming.
**Исправление:** Разбить на чанки через `setImmediate` между итерациями или вынести в worker thread.

---

### BUG-17 — Binance userDataStream закрывает ручные сделки по symbol
**Файл:** `backend/src/services/binance/userDataStream.js:33-35`
**Приоритет:** MEDIUM
**Проблема:** Поиск открытой сделки по `symbol` без привязки к `binanceOrderId`. Ручная LIMIT-сделка на том же символе может быть закрыта как auto-trade. Bybit `userDataStream.js` это исправляет, Binance — нет.
**Исправление:** Добавить фильтр по `binanceOrderId` аналогично Bybit.

---

### BUG-18 — Signal таблица без индекса по createdAt — slow queries в Stats
**Файл:** `backend/src/routes/stats.js:11-13`, `backend/prisma/schema.prisma`
**Приоритет:** MEDIUM
**Проблема:** `GET /stats` загружает все сигналы без date-filter. `Signal` не имеет индекса по `createdAt` — при >1000 сигналов полный seq scan.
**Исправление:** Добавить `@@index([createdAt])` в модель `Signal`. Добавить `since` параметр в `/stats` эндпоинт.

---

### BUG-19 — useWebSocket не обновляет токен перед реконнектом
**Файл:** `frontend/src/hooks/useWebSocket.jsx:14-16`
**Приоритет:** HIGH
**Проблема:** При реконнекте берётся `getAccessToken()` из модуля. Если WS закрылся из-за истёкшего токена — клиент реконнектится с тем же expired токеном. Нет явного refresh перед WS-реконнектом.
**Исправление:** Перед реконнектом вызвать `refreshAccessToken()` или проверить expiry токена.
