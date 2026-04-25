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

### ~~BUG-01~~ — "Remember me" не работает ✅ FIXED
**Файл:** `frontend/src/pages/Login.jsx:95`
**Проблема:** `<input type="checkbox" defaultChecked/>` — нет `onChange`, нет state, нет логики. `login(username, password)` в `useAuth.jsx` не принимает параметр `remember`. Чекбокс полностью декоративный.
**Исправление:** Добавить `useState(true)` → `remember`, передать в `login()`, в `useAuth` — если `!remember`, удалять refresh-token cookie при закрытии вкладки (sessionStorage вместо persistent cookie).

---

### ~~BUG-02~~ — "Change password" не работает ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:472`
**Проблема:** `<button className="btn btn-ghost">Change password</button>` — нет `onClick`. Кнопка декоративная.
**Исправление:** Добавить форму смены пароля + `PUT /api/auth/change-password` на бэкенде.

---

### ~~BUG-03~~ — Emergency Stop не работает ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:337`
**Проблема:** `<button className="btn btn-short">Stop all trading</button>` — нет `onClick`. Автоторговлю нельзя экстренно остановить из UI.
**Исправление:** `onClick` → `api.put('/settings/autotrade', { autoTrade: false })` + WS-сообщение об остановке.

---

### ~~BUG-04~~ — "Test prompt" не работает ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:432`
**Проблема:** `<button className="btn btn-ghost">Test prompt</button>` — нет `onClick`. Протестировать промпт из UI невозможно.
**Исправление:** `onClick` → `api.post('/settings/test-prompt')` → показать ответ Claude в модале.

---

### ~~BUG-05~~ — "Send test" Telegram ничего не отправляет ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:453`
**Проблема:** `onClick={() => {}}` — пустой обработчик. Telegram-тест не работает.
**Исправление:** `onClick` → `api.post('/telegram/test')` → показать статус отправки.

---

### ~~BUG-06~~ — Account: Username нельзя сохранить ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:466`
**Проблема:** `<input defaultValue={settings.username || 'admin'}/>` — uncontrolled input без `onChange`. Изменения не сохраняются. Нет кнопки Save.
**Исправление:** Перевести в controlled input + `PUT /api/auth/profile`.

---

### ~~BUG-07~~ — Account: Email нельзя сохранить ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:470`
**Проблема:** `<input defaultValue={settings.email || ''}/>` — uncontrolled input без `onChange`. Поле email вообще не хранится в БД (`Settings` модель не имеет поля `email`).
**Исправление:** Добавить `email` в модель `User` + controlled input + Save.

---

### ~~BUG-08~~ — Account секция: нет кнопки Save ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:460-475`
**Проблема:** В секции Account нет ни одного `onClick` — даже если исправить inputs на controlled, сохранить данные некуда.
**Исправление:** Добавить `<button onClick={saveAccount}>Save</button>` + соответствующий эндпоинт.

---

### ~~BUG-12~~ — OCO-ордер падает после успешного MARKET входа ✅ FIXED
**Файл:** `backend/src/services/exchange/index.js` → `placeOrder()`
**Проблема:** `placeOrder()` сначала выставляет MARKET entry, потом OCO. Если OCO отклоняется биржей (минимальный размер, недостаточный отрыв SL/TP от цены, временная ошибка), MARKET вход уже исполнен — позиция открыта без стопа. Бот логирует `warn: OCO failed after entry fill` и продолжает, Trade сохраняется без реального SL/TP. Закрывать вручную.
**Исправление:** При падении OCO после входа — немедленно выставить MARKET выход (закрыть позицию). Или: предварительно валидировать SL/TP против биржевых ограничений (min notional, min price step) до размещения входного ордера.

---

### ~~BUG-11~~ — Статусы сигналов непонятны человеку ✅ FIXED
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

### ~~KISS-16~~ — 10 PUT-маршрутов в settings.js с одинаковым паттерном ✅ FIXED
**Файл:** `backend/src/routes/settings.js:36-176`
**Проблема:** 10 функций с идентичной структурой: валидация поля из req.body → prisma.settings.update → res.json({ok:true}). Изменение паттерна (логирование, rate limit, аудит) требует правки в 10 местах.
**Исправление:** Фабрика `createSettingRoute(field, validator)` или единый PUT `/settings` с map валидаторов по ключу.

---

### ~~KISS-17~~ — prisma.settings.findUnique({ where: { id: 1 } }) в 14+ файлах ✅ FIXED
**Файлы:** `binance/rest.js`, `bybit/rest.js`, `bybit/userDataStream.js`, `exchange/index.js`, `ofiEngine.js`, `engine.js`, `notifier.js`, `telegramBot.js`, `prompts.js`, `server.js`, `routes/settings.js` и др.
**Проблема:** Доступ к singleton Settings разбросан по всему коду без кеширования. При изменении схемы нужно менять в 14+ местах.
**Исправление:** `getSettings()` в `db/prisma.js` с кешем и TTL — аналог уже существующего `getDipThreshold()` в engine.js.

---

### ~~KISS-18~~ — Паттерн saveXxx в Settings.jsx повторяется 10+ раз ✅ FIXED
**Файл:** `frontend/src/pages/Settings.jsx:77-193`
**Проблема:** Каждая из 10 save-функций: `try { await api.put(...); showStatus(true, msg) } catch { showStatus(false, err) }`. Идентичная структура, только endpoint и поля разные.
**Исправление:** `const apiSave = (endpoint, payload, msg) => api.put(endpoint, payload).then(...)` — переиспользовать вместо 10 копий.

---

### ~~KISS-19~~ — showStatus (ok, msg) + setTimeout дублируется в 3 компонентах ✅ FIXED
**Файлы:** `Dashboard.jsx:60-63`, `Settings.jsx:77-80`, `SignalModal.jsx:53-56`
**Проблема:** Идентичная функция в трёх местах. При изменении таймаута (3000ms) нужно менять в трёх файлах.
**Исправление:** `useStatusToast()` хук → `{ status, showStatus }`.

---

### ~~KISS-20~~ — Сложные fallback-цепочки в SignalModal ✅ FIXED
**Файл:** `frontend/src/components/SignalModal.jsx:24-31`
**Проблема:** `signal.claudeAnalysis || signal.analysis || ''`, `signal.suggestedSl || signal.stopLoss || signal.sl` — признак нестабильного формата. KISS-06 нормализовал `/signals` роут, но SignalModal получает сигналы из WS (broadcast) и из модала открытого вручную — разные форматы.
**Исправление:** Нормализовать WS SIGNAL_UPDATE broadcast в том же формате что и REST `/signals`. Тогда SignalModal получает один стабильный формат.

---

### ~~KISS-21~~ — Дублированная логика кеширования Settings в engine.js и ofiEngine.js ✅ FIXED
**Файлы:** `engine.js:25-33`, `ofiEngine.js:31-39`
**Проблема:** `getDipThreshold()` и `isOfiEnabled()` — одинаковый паттерн: cachedValue + lastFetch + TTL + try/catch. Третья такая функция создаст антипаттерн.
**Исправление:** `makeSettingCache(fieldName, defaultValue, ttl)` — фабрика кешированного геттера.

---

### ~~KISS-22~~ — Дублированная валидация дат в stats.js ✅ FIXED
**Файл:** `backend/src/routes/stats.js`
**Проблема:** Блок `new Date(from/to)` + `isNaN` + `fromDate >= toDate` повторяется в `/backtest` и `/optimize`.
**Исправление:** `validateDateRange(from, to)` → `{ ok, error, fromDate, toDate }`.

---

### ~~KISS-23~~ — Паттерн showStatus в SignalModal идентичен Dashboard/Settings ✅ FIXED
**Файл:** `frontend/src/components/SignalModal.jsx:53-56`
**Проблема:** Третья копия `showStatus` + `setTimeout 3000`. См. KISS-19.
**Исправление:** То же — `useStatusToast()` хук.

---

## Раздел 5 — Инфраструктура торговли (trading improvements)

---

### ~~TRADE-01~~ — Принудительный выход при обратном сигнале ✅ FIXED
**Приоритет:** Medium
**Проблема:** Если открыт LONG на ETH и OBD генерирует SHORT сигнал — система либо игнорирует его (лимит позиций), либо открывает вторую позицию. Нет механизма "умного выхода" при смене рыночной структуры.
**Исправление:** В `executeAutoTrade` при direction != направления открытой Trade на этом символе — принудительно закрыть открытую позицию (market sell/buy) до размещения новой. По сути: обратный сигнал = сигнал выхода из текущей позиции.
**Примечание:** На Spot SHORT — это продажа актива. Отдельная "шорт-позиция" не создаётся — просто закрываем LONG. Реализация: проверять `openTrade.side !== side` → вызвать `cancelAllOpenOrders` + market close.
**Зависимости:** Требует TRADE-02 (один символ — одна позиция).

---

### ~~TRADE-02~~ — maxOpenTrades per symbol вместо глобального ✅ FIXED
**Приоритет:** High
**Проблема:** `openCount = prisma.trade.count({ where: { status: 'OPEN' } })` — глобальный счётчик. Позволяет иметь несколько OPEN Trade на одном символе, что ломает `findFirst` в userDataStream и делает `cancelAllOpenOrders` опасным (отменяет TP/SL всех позиций по символу).
**Исправление:** Заменить проверку на `{ status: 'OPEN', symbol: pair.tradeSymbol }`. Один символ = максимум одна позиция. Глобальный `maxOpenTrades` сохранить для ограничения суммарной экспозиции по всем символам.

---

### ~~TRADE-03~~ — Reconciliation job: сверка открытых Trade с биржей ✅ FIXED
**Приоритет:** Medium
**Проблема:** Если fill-событие пропущено (WS разрыв) — Trade навсегда остаётся `status='OPEN'` в DB. Нет механизма периодической сверки.
**Исправление:** Cron каждые 5 минут: для каждой OPEN Trade запросить `/v5/order/history` по `binanceOrderId` — если биржа показывает исполненный exit ордер → закрыть Trade в DB с реальным PnL.

---

### ~~TRADE-04~~ — PnL в userDataStream не учитывает комиссии ✅ FIXED
**Приоритет:** Low
**Проблема:** В `userDataStream.js` PnL считается как чистая разница цен без вычета 0.2% round-trip fee. Бэктест вычитает комиссии, реальные сделки — нет. Статистика реальных сделок выглядит лучше бэктеста искусственно.
**Исправление:** `pnl = roundedPnl - 0.2` (или точнее — вычитать 0.1% на вход + 0.1% на выход).

---

### ~~TRADE-05~~ — placeSeparateTpSl fire-and-forget: ошибка SL не останавливает Trade ✅ FIXED
**Файл:** `backend/src/services/bybit/rest.js:placeSeparateTpSl()`
**Приоритет:** High
**Проблема:** `placeSeparateTpSl()` вызывается как fire-and-forget (`.catch(err => logger.warn(...))`). Если SL stop-ордер не создался (ошибка API, precision issue, rate limit) — Trade записывается в DB со статусом OPEN, позиция куплена, но стоп-лосса на бирже нет. Логируется warn, основной поток не прерывается.
**Исправление:** Ждать результата `placeSeparateTpSl` (await + try/catch). Если SL не создался — либо выходить из позиции немедленно (market sell), либо бросать ошибку и не создавать Trade запись. Минимум — Telegram алерт с требованием ручного вмешательства.

---

### ~~TRADE-06~~ — Exit ордера матчатся по symbol+side, не по orderId ✅ FIXED
**Файл:** `backend/src/services/bybit/userDataStream.js:handleOrderFill()`
**Приоритет:** High
**Проблема:** При получении exit fill-события (TP или SL) система находит Trade через `findFirst({ symbol, status:'OPEN' })` — без привязки к конкретному orderId. `binanceOrderId` хранит entry orderId, но для exit не используется. При нескольких OPEN Trade на одном символе закрывается случайная запись (без ORDER BY в findFirst).
**Исправление:** Для separate TP/SL ордеров (Classic account) — `orderLinkId` содержит `tp-{entryOrderId[-28:]}` или `sl-{...}`. Парсить prefix (`tp-` / `sl-`) + suffix → искать Trade по `binanceOrderId LIKE %suffix`. Это привяжет exit к конкретному Trade.

---

### TRADE-07 — Race condition: fill-событие до Trade.create в DB ⏭ WONTFIX
**Файл:** `backend/src/services/bybit/userDataStream.js`, `backend/src/services/indicators/engine.js`
**Приоритет:** Medium
**Проблема:** `placeOrder()` возвращает orderId → 300ms задержка (avgPrice) → `Trade.create()`. Если fill-событие для entry ордера придёт раньше чем Trade записана в DB (редко, но возможно при быстром исполнении) — entry fill не обновит `trade.price`, exit fill найдёт `openTrade=null` и пропустит закрытие.
**Исправление:** Уменьшить 300ms задержку или сначала создать Trade с `price=0`, потом обновить avgPrice. Entry fill обновляет price если `trade.price === 0` — эта логика уже есть, надо убедиться что Trade существует до того как могут придти fill-события.

---

### ~~TRADE-08~~ — Exit fill пропускается при отсутствии OPEN Trade в DB ✅ FIXED
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

### ~~SEC-03~~ — Telegram token/chatId хранятся незашифрованными в БД ✅ FIXED
**Файл:** `backend/src/services/notifications/notifier.js:18-37`
**Приоритет:** HIGH
**Проблема:** Bybit/Binance ключи шифруются AES-256-GCM перед записью в `Settings`. Telegram token и chat ID хранятся в открытом виде. При утечке БД — полный доступ к боту.
**Исправление:** Шифровать через `encrypt()`/`decrypt()` из `config/crypto.js` аналогично API ключам.

---

### ~~SEC-04~~ — Telegram webhook не верифицирует подпись Telegram ✅ FIXED
**Файл:** `backend/src/routes/telegram.js:8-17`
**Приоритет:** HIGH
**Проблема:** `POST /telegram/webhook` принимает любой запрос. Злоумышленник может подделать webhook и вызвать команды бота.
**Исправление:** Верифицировать запрос через `X-Telegram-Bot-Api-Secret-Token` или HMAC SHA-256 подпись тела по рекомендации Telegram.

---

### ~~SEC-05~~ — Trade order: не валидируются SL/TP на экономический смысл ✅ FIXED
**Файл:** `backend/src/routes/trade.js:10-48`
**Приоритет:** MEDIUM
**Проблема:** `POST /api/trade/order` принимает `stopLoss` и `takeProfit` без проверки: SL ≠ TP, SL < TP для LONG, SL > TP для SHORT. Можно разместить ордер с идентичными или перевёрнутыми уровнями.
**Исправление:** Добавить валидацию перед `placeOrder()`. Вернуть 400 с понятным сообщением.

---

### ~~ARCH-01~~ — Signal создаётся до Claude — возможен permanent "Analyzing..." ✅ FIXED
**Файл:** `backend/src/services/indicators/ofiEngine.js:41-121`
**Приоритет:** HIGH
**Проблема:** OFI сигнал сохраняется в БД с пустым `claudeAnalysis`, затем Claude анализирует асинхронно. При падении бэкенда между созданием и Claude-ответом — сигнал навсегда остаётся без анализа (PENDING). OBD pipeline тоже создаёт Signal до Claude (`claudePipeline.js`).
**Исправление:** Рассмотреть паттерн "создать Signal только после ответа Claude". Или добавить TTL-cleanup для сигналов без `claudeAnalysis` старше 5 минут.

---

### ~~ARCH-02~~ — Таймаут Signal в tracker.js: принудительный исход некорректен ✅ FIXED
**Файл:** `backend/src/services/signals/tracker.js:50-54`
**Приоритет:** MEDIUM
**Проблема:** Если за 1 час цена не достигла SL/TP — сигнал форсируется в WIN/LOSS/BREAKEVEN по текущей цене. Это создаёт ложные исходы в статистике. OBD-сигналы на mean-reversion — нормально. Но принцип "закрыть по таймауту по midPrice" может маскировать реальную неэффективность системы.
**Исправление:** Добавить `outcome: 'TIMEOUT'` как отдельный статус. Или вынести таймаут как настраиваемый параметр в Settings.

---

### ~~ARCH-03~~ — symbolInfoCache растёт неограниченно ✅ FIXED
**Файлы:** `binance/rest.js:95-117`, `bybit/rest.js:213-244`
**Приоритет:** LOW
**Проблема:** `symbolInfoCache` — глобальная `Map` без LRU и без TTL. При большом количестве уникальных символов (в теории) — утечка памяти.
**Исправление:** Максимальный размер 100 записей или TTL 24 часа (символы не меняются часто).

---

### ~~ARCH-04~~ — WS авто-реконнект без exponential backoff ✅ FIXED
**Файлы:** `frontend/src/hooks/useWebSocket.jsx:34-36`
**Приоритет:** LOW
**Проблема:** При отключении сервера клиент пытается переподключиться каждые 3 секунды бесконечно. При долгом downtime — лавина запросов на сервер при его возвращении.
**Исправление:** Exponential backoff: 3s → 6s → 12s → 30s (max).

---

## Раздел 7 — Full code review v2 (2026-04-19)

Источник: полный аудит кодовой базы после TRADE-02..08 и SEC-03 фиксов.

---

### ~~BUG-13~~ — Trade.slOrderFailed — мёртвое поле, никогда не true ✅ FIXED
**Файл:** `backend/src/services/indicators/engine.js:261`, `backend/prisma/schema.prisma`
**Приоритет:** HIGH
**Проблема:** `slOrderFailed: false` записывается при создании Trade. При SL failure функция делает `return` до `trade.create` — Trade не создаётся вообще. Значит поле всегда `false`. При slFailed позиция существует на бирже, но в DB нет — `userDataStream` её никогда не закроет.
**Исправление:** Либо удалить поле из схемы, либо изменить логику: создавать Trade запись даже при slFailed со статусом `'OPEN'` и `slOrderFailed: true` — чтобы `userDataStream` мог её отследить и закрыть.

---

### ~~BUG-14~~ — aggTradeWs нет `stopped` флага — ghost-reconnect при смене биржи ✅ FIXED
**Файлы:** `backend/src/services/binance/aggTradeWs.js`, `backend/src/services/bybit/aggTradeWs.js`
**Приоритет:** HIGH
**Проблема:** При `stopAggTradeWs()` убирается `reconnectTimer`, но если `ws.close()` вызывает `'close'` event до `removeAllListeners` — возникает реконнект. Остальные WS-сервисы используют `stopped = true`. При переключении биржи возможен ghost-reconnect старого aggTrade WS.
**Исправление:** Добавить `stopped` флаг по аналогии с остальными WS-сервисами проекта.

---

### ~~BUG-15~~ — Смена пар при переключении биржи не атомарна ✅ FIXED
**Файл:** `backend/src/routes/settings.js:88-110`
**Приоритет:** MEDIUM
**Проблема:** `updateMany` + цикл upsert без транзакции. При краше посередине — часть пар активна для новой биржи, часть для старой. `switchExchangeWs` уже запущен, `activePairs` несогласован.
**Исправление:** Обернуть в `prisma.$transaction([...])`.

---

### ~~BUG-16~~ — runOptimize блокирует event loop на больших данных ✅ FIXED
**Файл:** `backend/src/services/signals/tracker.js:288`
**Приоритет:** MEDIUM
**Проблема:** `runOptimize` выполняется синхронно. При 4 парах × 7 дней × 72 комбинации — 30-60s блокировки event loop. Нет timeout, нет streaming.
**Исправление:** Разбить на чанки через `setImmediate` между итерациями или вынести в worker thread.

---

### ~~BUG-17~~ — Binance userDataStream закрывает ручные сделки по symbol ✅ FIXED
**Файл:** `backend/src/services/binance/userDataStream.js:33-35`
**Приоритет:** MEDIUM
**Проблема:** Поиск открытой сделки по `symbol` без привязки к `binanceOrderId`. Ручная LIMIT-сделка на том же символе может быть закрыта как auto-trade. Bybit `userDataStream.js` это исправляет, Binance — нет.
**Исправление:** Добавить фильтр по `binanceOrderId` аналогично Bybit.

---

### ~~BUG-18~~ — Signal таблица без индекса по createdAt — slow queries в Stats ✅ FIXED
**Файл:** `backend/src/routes/stats.js:11-13`, `backend/prisma/schema.prisma`
**Приоритет:** MEDIUM
**Проблема:** `GET /stats` загружает все сигналы без date-filter. `Signal` не имеет индекса по `createdAt` — при >1000 сигналов полный seq scan.
**Исправление:** Добавить `@@index([createdAt])` в модель `Signal`. Добавить `since` параметр в `/stats` эндпоинт.

---

### ~~BUG-19~~ — useWebSocket не обновляет токен перед реконнектом ✅ FIXED
**Файл:** `frontend/src/hooks/useWebSocket.jsx:14-16`
**Приоритет:** HIGH
**Проблема:** При реконнекте берётся `getAccessToken()` из модуля. Если WS закрылся из-за истёкшего токена — клиент реконнектится с тем же expired токеном. Нет явного refresh перед WS-реконнектом.
**Исправление:** Перед реконнектом вызвать `refreshAccessToken()` или проверить expiry токена.


---

### BUG-20 — USDT иконка в Portfolio Holdings — пустой кружок неправильного цвета
**Файл:** `frontend/src/components/primitives.jsx:1-6,69-81`
**Приоритет:** LOW
**Проблема:** `CoinGlyph` делает `symbol.replace(/USDC$|USDT$/, '')`. Для ассета `USDT` → `base = ''`. `COIN_COLORS[''] = undefined` → дефолтный оранжевый `#d4a574`. Буква: `''[0] = undefined` → ничего не показывается внутри кружка.
**Исправление:**
1. Добавить `USDT: '#26a17b'` в `COIN_COLORS`
2. В `CoinGlyph`: если `base === ''` — использовать оригинальный `symbol` как `base`

---

### BUG-21 — Portfolio Holdings: Free/Locked колонки всегда 0, total считается неправильно
**Файлы:** `backend/src/services/bybit/rest.js:111-129`, `backend/src/routes/portfolio.js:16-26`, `frontend/src/pages/Portfolio.jsx`
**Приоритет:** MEDIUM
**Проблема:** В Bybit UTA `walletBalance` — это total баланс. `getAccountBalance()` маппит `free: c.walletBalance` (неправильно — это total, не free). В `portfolio.js` `total = free + locked` — неправильно, должно быть `walletBalance` напрямую. В UTA free/locked всегда 0 (средства в unified pool). В UI колонки Free и Locked не несут смысла — запутывают.
**Исправление:**
1. `getAccountBalance()`: добавить поле `total: c.walletBalance`, исправить `free: c.availableToWithdraw || '0'`
2. `portfolio.js` `/balance`: возвращать `{ asset, total }` вместо `{ asset, free, locked, total }`
3. `Portfolio.jsx` Holdings таблица: убрать Free/Locked колонки, оставить только Asset + Total

---

### BUG-22 — Portfolio: нет аудита открытых позиций vs биржевые ордера (Sync)
**Файлы:** `frontend/src/pages/Portfolio.jsx`, новый endpoint
**Приоритет:** HIGH
**Проблема:** Система считает сделку "под контролем" пока она OPEN в DB — но на бирже может не быть ни SL ни TP ордеров. У пользователя 4 OPEN Bot Trades, на бирже 1 ордер. Разрыв не виден и не алертится — ложное чувство безопасности. Незащищённый капитал остаётся открытым бесконечно.
**Исправление:**
1. Добавить endpoint `GET /api/portfolio/sync-check` — для каждого OPEN Trade в DB проверить есть ли на бирже хотя бы один ордер по этому символу (SL или TP). Вернуть список "проблемных" позиций.
2. Добавить кнопку "Sync" в Bot Trades секцию — при нажатии вызывает endpoint и показывает алерт с перечнем позиций без защиты (не закрывает автоматически — только информирует).

---

## Раздел 8 — Оптимизация затрат (cost efficiency)

---

### FEAT-01 — Пропускать Claude-анализ если по символу уже открыта сделка

**Файлы:** `backend/src/services/indicators/engine.js` (+ `ofiEngine.js`)
**Приоритет:** MEDIUM
**Контекст:** Сейчас Claude-анализ запускается на каждый OBD/OFI сигнал, даже если по данному символу уже открыта Trade. Однако `executeAutoTrade` имеет guard `existingTrade → return` — реальный вход всё равно не произойдёт. Claude-токены тратятся впустую.
**Единственная текущая польза от анализа при открытой позиции** — сигнал сохраняется в БД со всеми метаданными (RSI, ATR, direction, confidence), что полезно для сбора статистики и бэктестинга. Это реальная ценность пока данных мало.
**Когда имеет смысл внедрить:** когда накоплено достаточно сигналов для бэктеста (>200-300 на символ) — ценность дополнительной статистики снижается, а экономия токенов растёт.
**Предлагаемая реализация:**
1. Добавить настройку `skipAnalysisOnOpenTrade: Boolean` в `Settings` (default: `false`)
2. В `engine.js` перед `analyzeSignal()` / `runClaudePipeline()`: если `settings.skipAnalysisOnOpenTrade && openTradeExists` → пропустить Claude, не создавать Signal, логировать info
3. Или более мягкий вариант: создавать Signal с `direction: 'SKIP'` без Claude-вызова — статистика сохраняется, токены не тратятся
**Трейдофф:** вариант с `SKIP` не позволяет видеть "а что бы сказал Claude" при открытой позиции, но это ок для этапа production с достаточной статистикой.

---

### BUG-24 — orderLinkId suffix collision при orderId < 28 символов
**Файлы:** `backend/src/services/bybit/rest.js:258`, `backend/src/services/bybit/userDataStream.js:101`
**Приоритет:** MEDIUM
**Проблема:** `placeSeparateTpSl` использует `entryOrderId.slice(-28)` как suffix orderLinkId. При поиске Trade в `handleOrderFill` используется `{ binanceOrderId: { endsWith: entrySuffix } }`. Если два orderId заканчиваются одинаково (теоретически), возможна коллизия — закроется не та сделка.
**Исправление:** Изменить поиск с `endsWith` на точное совпадение. Для этого нужно убедиться что suffix всегда равен полному orderId (или использовать другой механизм привязки exit к entry).

---

### BUG-25 — Race condition двойного заполнения TP+SL одновременно
**Файлы:** `backend/src/services/bybit/userDataStream.js:82-148`
**Приоритет:** HIGH
**Проблема:** TP и SL могут заполниться почти одновременно (например, при gap). Два `handleOrderFill` вызова запускаются параллельно, оба видят Trade.status='OPEN', оба пытаются закрыть Trade и обновить Signal. Текущий guard `{ outcome: null }` в `signal.updateMany` частично защищает Signal, но `trade.update` вызывается дважды без atomicity — второй вызов перезаписывает PnL первого.
**Исправление:** Добавить промежуточный статус `CLOSING`: обновлять Trade через `updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSING' } })`, проверять `count === 0` → уже обрабатывается, выходить. Финально обновлять до `CLOSED`.

---

### BUG-26 — closeTrade застревает в CLOSING при разрыве WS
**Файлы:** `frontend/src/pages/Portfolio.jsx:129-142`
**Приоритет:** MEDIUM
**Проблема:** Пользователь нажимает Close → frontend устанавливает status='CLOSING' → backend выставил market ордер → ордер заполнился → но WS разорвалось до прихода SIGNAL_OUTCOME события. Статус остаётся 'CLOSING' вечно (до ручного обновления страницы).
**Исправление:** Добавить таймаут 10-15 сек в `closeTrade`: если статус не обновился до CLOSED — перезапросить `/trade` из API и обновить state. Или добавить кнопку "Refresh trades".

---

### BUG-27 — Fetch timeout отсутствует — зависший network call блокирует весь chain
**Файлы:** `backend/src/services/bybit/rest.js` (все `fetch()` вызовы)
**Приоритет:** HIGH
**Проблема:** Все `fetch()` вызовы к Bybit API (placeOrder, getSymbolInfo, getAccountBalance и т.д.) не имеют AbortController timeout. При зависании сетевого соединения на 30+ сек — весь chain (placeOrder → placeSeparateTpSl → Trade.create) подвисает. Особо опасно: если frontend timeout 30s сработает раньше, пользователь видит ошибку, но backend продолжает выполнение и может разместить дублирующий ордер.
**Исправление:** Добавить `AbortController` с таймаутом 10-15 сек в `privatePost`/`privateGet`. При AbortError — выбрасывать понятную ошибку вместо зависания.

---

### BUG-28 — tracker.js и userDataStream.js могут закрыть одну Trade одновременно
**Файлы:** `backend/src/services/signals/tracker.js:68-101`, `backend/src/services/bybit/userDataStream.js:116-148`
**Приоритет:** MEDIUM
**Проблема:** tracker проверяет midPrice каждые 5 сек — если midPrice >= suggestedTp, он выставляет outcome='WIN' и обновляет Signal. Одновременно может прийти реальный WS fill event. Signal защищён guard `{ outcome: null }` в updateMany, поэтому двойного обновления Signal нет. Но Trade обновляется в обоих местах — если tracker успел первым, userDataStream обновит Trade с более точным exitPrice. Двух записей не будет, но логика немного рассогласована. Долгосрочно: tracker не должен закрывать Signal если для него уже есть активный Trade на бирже (SL/TP ещё висят).
**Исправление:** В tracker.js перед обновлением Signal проверять: если для сигнала есть OPEN Trade с `slOrderFailed=false` — пропускать (реальное закрытие придёт через WS).

---

## Раздел 9 — Full review v3 (2026-04-22, DEV+QA+TL агенты)

Источник: параллельный аудит трёх агентов (DEV, QA, TL).

---

### BUG-29 — TRADE-02 guard не атомарен — два одновременных сигнала открывают обе позиции
**Файл:** `backend/src/services/indicators/engine.js:147-286`
**Приоритет:** HIGH
**Проблема:** Pre-check (счёт OPEN trades) и `Trade.create` не обёрнуты в транзакцию. Два сигнала на один символ с интервалом ~50ms оба проходят pre-check (оба видят count=0), оба вызывают `placeOrder`, оба создают Trade. TRADE-02 post-check (строка 276) смягчает это, закрывая вторую позицию, но сам post-check тоже не атомарен — при высокой нагрузке оба могут пройти и его.
**Исправление:** Добавить per-symbol advisory lock через `prisma.$transaction(SERIALIZABLE)`, или заменить post-check на DB unique constraint `(symbol, status='OPEN')` + catch uniqueness error → закрыть лишнюю позицию.

---

### BUG-30 — Нет fetch() timeout — зависший Bybit API вызов блокирует chain и может создать дубль ордера
**Файл:** `backend/src/services/bybit/rest.js` (все `fetch()`)
**Приоритет:** HIGH
**Проблема:** Все вызовы к Bybit API (placeOrder, getSymbolInfo, getAccountBalance и т.д.) используют `fetch()` без `AbortController` timeout. Node.js по умолчанию не имеет таймаута на TCP соединение. При зависании >30 сек — frontend таймаутится и пользователь видит ошибку, но backend продолжает выполнение. Повторный запрос от пользователя создаст дублирующий ордер пока первый ещё выполняется.
**Исправление:**
```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);
const res = await fetch(url, { ..., signal: controller.signal });
clearTimeout(timer);
```
Добавить в `privatePost` и `privateGet` функции в rest.js.

---

### BUG-31 — Нет reconciliation при старте сервера — orphaned OPEN trades после рестарта
**Файлы:** `backend/src/server.js`, `backend/src/services/bybit/reconciliation.js`
**Приоритет:** HIGH
**Проблема:** При рестарте сервера Bybit WS не переотправляет исторические fill-события. Если fill пришёл пока сервер был недоступен — Trade навсегда остаётся OPEN в DB хотя позиция закрыта на бирже. Существующий reconciliation job запускается раз в 5 мин — этого достаточно для периодической сверки, но не для восстановления после рестарта.
**Исправление:** В `server.js` при старте вызывать `reconcileOpenTrades()` один раз до начала WS подключений. Это гарантирует что стартуем с корректным состоянием DB.

---

### BUG-32 — tracker.js закрывает Signal по midPrice не зная об активных биржевых ордерах
**Файлы:** `backend/src/services/signals/tracker.js:68-101`
**Приоритет:** MEDIUM
**Проблема:** tracker проверяет midPrice каждые 5 сек. Если currentPrice >= suggestedTp — выставляет outcome='WIN'. Но для сигналов с реальной Trade (SL/TP ордера живые на бирже) это неправильно: реальное закрытие ещё не произошло, tracker использует рыночную цену вместо цены исполнения ордера. Signal получает неточный outcomePrice/outcomePnl.
**Исправление:** В tracker.js перед обновлением Signal проверять: если `signal.Trade` с `status='OPEN'` и `slOrderFailed=false` — пропускать итерацию (реальное закрытие придёт через userDataStream WS fill event).

---

### BUG-33 — hasSlOrder в Portfolio.jsx: условие `orderType='Market' && triggerPrice>0` требует верификации
**Файл:** `frontend/src/pages/Portfolio.jsx:492-498`
**Приоритет:** MEDIUM
**Проблема:** Условие `(o.orderType === 'Market' && parseFloat(o.triggerPrice) > 0)` для определения SL-ордера написано исходя из того что Bybit возвращает `orderType='Market'` для StopOrder. Это нужно подтвердить на реальных данных — Bybit может возвращать другой `orderType` для untriggered stop orders (например, `'UNKNOWN'` до триггера). Если условие неверное — SL-ордера не будут распознаны, badge всегда будет "No orders".
**Исправление:** Залогировать реальные поля (`orderType`, `stopOrderType`, `triggerPrice`) приходящих ордеров через WS и REST чтобы подтвердить/опровергнуть условие. Добавить логирование в `normalizePortfolioOrder` при `triggerPrice > 0`.

---

### BUG-34 — partial fills не отслеживаются — Trade.quantity и PnL некорректны при частичном исполнении
**Файлы:** `backend/src/services/bybit/userDataStream.js:44`, `backend/src/services/bybit/reconciliation.js`
**Приоритет:** LOW
**Проблема:** Bybit может вернуть WS событие с `cumExecQty < qty` (partial fill). `handleOrderFill` проверяет только `orderStatus === 'Filled'` — при полном заполнении это правильно. Но если маркет-ордер заполнился частично (редко на spot, но возможно при недостаточной ликвидности) — `avgPrice` будет неполным, `Trade.quantity` не обновится до реального `cumExecQty`.
**Исправление:** При partial fill entry: обновлять `Trade.quantity = cumExecQty` и `Trade.price = avgPrice` если `cumExecQty > 0`. Для partial fill exit: аналогично учитывать только исполненную часть.

---

### ARCH-05 — Отсутствует startup reconciliation — DB может быть рассинхронизирована с биржей после рестарта
**Файлы:** `backend/src/server.js`, `backend/src/services/bybit/reconciliation.js`
**Приоритет:** HIGH
**Проблема:** Reconciliation job запускается каждые 5 минут но не при старте. За время downtime позиции могли закрыться на бирже, новые ордера появиться/исчезнуть. Первые 5 минут после рестарта система работает на потенциально устаревших данных.
**Исправление:** Вызвать `reconcileOpenTrades()` в `server.js` при старте (до подключения WS потоков). См. BUG-31 — это один и тот же фикс.

---

### ARCH-06 — Нет circuit breaker для Bybit API — каскадные ошибки при outage биржи
**Файлы:** `backend/src/services/bybit/rest.js`
**Приоритет:** LOW
**Проблема:** При временном outage Bybit API все pending запросы зависают, затем все одновременно падают с timeout. Engine продолжает генерировать сигналы, каждый пытается вызвать Bybit API, нагружая и без того перегруженный endpoint. Нет механизма "отключиться на N минут после X последовательных ошибок".
**Исправление:** Простой счётчик ошибок: если 3+ consecutive ошибки Bybit API → pause autoTrade на 60 сек + Telegram алерт. Сброс при успешном запросе.

---

### BUG-23 — TP ордер не размещается (или отменяется) тихо — нет Telegram алерта
**Файл:** `backend/src/services/exchange/index.js` (или `bybit/rest.js` — placeOrder)
**Приоритет:** HIGH
**Проблема:** При размещении OCO (SL + TP), если TP ордер не разместился (Bybit отклонил, или исключение после SL), — только `warn` в логах. Пользователь не знает. Позиция остаётся без потолка прибыли и автоматического закрытия по TP — её закроет только SL (убыток) или таймаут (по текущей цене). Аналогично TRADE-05 для SL — та же логика применима к TP.
**Исправление:** После неудачного размещения TP ордера — `sendTelegramNotification` с явным предупреждением о позиции без TP. По аналогии с TRADE-05 (SL failure уже алертится).

---

### BUG-35 — `placeManualOrder` для Market SELL без guard по `bybitSide` — мутная семантика балансной проверки
**Файл:** `backend/src/services/bybit/rest.js` (placeManualOrder, Market+SL/TP ветка)
**Приоритет:** MEDIUM
**Проблема:** Логика `Math.min(free, qty)` с `getAccountBalance(baseAsset)` вставлена в Market ветку без условия по направлению. Для BUY работает корректно (после покупки нужно залочить базу под TP/SL). Для SELL семантика мутная: после Market SELL базовая монета продана, exit-side='Buy' будет покупать обратно за USDT — балансовая проверка на `baseAsset` нерелевантна (Bybit чекает USDT для Buy). Не приводит к багу (Math.min с qty + fallback на исходный qty), но логика вводит в заблуждение и тратит API call впустую при SELL.
**Исправление:** Обернуть весь блок в `if (bybitSide === 'Buy')` — для SELL оставить `realQty = qty` и пропустить getAccountBalance. Аналогично в `engine.js` Phase 2 уже есть `if (side === 'BUY')` гард — выровнять оба места.

---

### BUG-36 — `maxOpenTrades > 1` на одной базовой монете → race на free balance в Phase 2
**Файлы:** `backend/src/services/indicators/engine.js` (Phase 2), `backend/src/services/bybit/rest.js` (placeManualOrder)
**Приоритет:** MEDIUM (latent — пока `maxOpenTrades=1` неактивен)
**Проблема:** Сейчас `maxOpenTrades=1` глобально, но если расширить до >1, и две сделки откроются параллельно на одной базовой монете (например, BTC из двух разных пар или повторный сигнал), в Phase 2 обоих трейдов `getAccountBalance().free` будет видеть только не-залоченный остаток. Один из трейдов может получить `free < qty` → fallback к `qty` → 170131. Второй в это же время — то же самое.
**Исправление:** Mutex per baseAsset (in-memory `Map<baseAsset, Promise>`) вокруг секции `getAccountBalance + placeTpSl`. Альтернатива: семафор/очередь по символу. Перед увеличением `maxOpenTrades` — обязательно сделать.
