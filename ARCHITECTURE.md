# ARCHITECTURE.md — BestTrader Trading Pipeline

Документ описывает полный жизненный цикл сигналов и сделок на основе реального кода проекта.
Дата последнего обновления: 2026-04-19.

> **Правило:** Этот документ должен обновляться при любом изменении кода, которое затрагивает торговый пайплайн — порядок создания Signal/Trade, логику exit-детекции, типы ордеров на бирже, Telegram-уведомления, поля в DB. Если код и схема расходятся — схема устарела и вводит в заблуждение. Обновляй сразу, в том же коммите что и код.

---

## A. Полный жизненный цикл сигнала

### A.1 OBD-сигнал

**Триггер**

Источник: Bybit WebSocket order book (depth stream, ~100ms обновления).
Файл: `services/indicators/engine.js:processObdUpdate()`.

Каждый тик обновляет in-memory структуру `obdState` (последние 120 снапшотов на символ).
`detectSignal()` запускается на каждом тике.

Условие LONG:
- В последних 12 снапшотах минимум OBD-значений упал более чем на `dipThreshold%` от максимума предшествующих 12–24 снапшотов (≥3 из 4 уровней OBD).
- Текущие значения восстанавливаются: `current[k] > recentMin[k] + 2` (≥3 из 4).
- EMA-20 по midPrice показывает тренд UP (иначе NEUTRAL → сигнал не генерируется).

Условие SHORT: зеркально — спайк вверх + начало падения + тренд DOWN.

Кулдаун: 15 минут на символ (`SIGNAL_COOLDOWN = 15 * 60 * 1000`). Хранится в Map `lastSignalTime`.

---

**Шаг 1 — Запись Signal в БД (немедленно, до Claude)**

```js
prisma.signal.create({
  data: {
    pairId,
    direction: signal,   // 'LONG' или 'SHORT'
    obd1, obd2, obd3, obd4,
    price: midPrice,     // midPrice на момент детекции
    claudeAnalysis: '',  // пустая строка — ещё нет ответа
  }
})
```

Поля `confidence`, `suggestedSl`, `suggestedTp`, `outcome` — NULL.

---

**Шаг 2 — Broadcast SIGNAL (немедленно)**

```js
broadcast({ type: 'SIGNAL', signal: { ..., confidence: null, claudeAnalysis: 'Analyzing...' } })
```

Frontend получает сигнал мгновенно с заглушкой "Analyzing...".

---

**Шаг 3 — Асинхронный вызов Claude**

Запускается через `analyzeWithClaude()` → `runClaudePipeline()` → `getAnalysis()` → `analyzeSignal()`.

Claude получает (user message):
- Пара: monitorSymbol → tradeSymbol
- Цена: midPrice на момент детекции
- OBD: obd1, obd2, obd3, obd4
- Тренд: trend5m и trend15m (вычисляются из Bybit klines 5m/15m)
- Технические индикаторы: RSI(14), ATR(1m), volume trend, паттерны последних свечей
- ATR(14) на 15m с пометкой "ИСПОЛЬЗУЙ ДЛЯ РАСЧЁТА SL/TP"
- Последние 20 свечей 1m в JSON

Системный промпт: `Settings.claudePrompt` (OBD-специфичный). Hash-синк: если `DEFAULT_PROMPT` != `Settings.promptHash`, DB обновляется автоматически при старте.

Модель: `claude-sonnet-4-5`, max_tokens: 1024. Ретраи: 3 попытки с задержками 5s/10s/20s (только на 529/503/timeout).

Claude возвращает JSON: `{ direction, confidence, analysis, suggestedSl, suggestedTp }`.

После парсинга JSON запускается `validateSlTp()`:
- Если SL/TP перепутаны по направлению → ATR-fallback (1.5×ATR SL, 3.5×ATR TP) или WAIT (если ATR нет).
- Если чистый TP (после ROUND_TRIP_FEE=0.2%) < 0.4% → принудительный WAIT.
- Если чистый RR < 2.0 → TP расширяется до минимального значения.

---

**Шаг 4 — Обновление цены входа (только если direction ≠ WAIT)**

```js
entryPrice = await getMidPrice(pair.tradeSymbol)  // свежий bid/ask mid с Bybit
```

Обновляется `signal.price`. Используется `tradeSymbol` (USDT пара), а не `monitorSymbol` (USDC).

---

**Шаг 5 — Обновление Signal в БД**

```js
prisma.signal.update({
  data: {
    direction: analysis.direction,  // может стать 'WAIT'
    confidence: Math.round(analysis.confidence),
    claudeAnalysis: analysis.analysis,
    suggestedSl, suggestedTp,
    price: entryPrice,
    // BUG-00 fix: WAIT сразу получает outcome='WAIT', иначе tracker оставит его PENDING вечно
    ...(direction === 'WAIT' ? { outcome: 'WAIT' } : {}),
    // OBD-специфичные поля (extraDbFields):
    rsi, trend5m, trend15m, atr, atrPct, tpPct, slPct,
  }
})
```

---

**Шаг 6 — direction=WAIT: что происходит**

- Signal в DB: `direction='WAIT'`, `outcome='WAIT'` (немедленно), `confidence` и `claudeAnalysis` заполнены.
- `suggestedSl` и `suggestedTp` — могут быть NULL (Claude не предложил) или заполнены (но RR/комиссии провалили валидацию).
- Telegram: НЕ отправляется (условие `direction !== 'WAIT'` в `claudePipeline.js`).
- autoTrade: НЕ запускается.
- Broadcast: `SIGNAL_UPDATE` отправляется всегда (включая WAIT) для обновления UI.
- tracker.js: WAIT сигналы пропускает (`if (signal.direction === 'WAIT') continue`).

---

**Шаг 7 — direction ≠ WAIT: Telegram + autoTrade**

```js
// Telegram (условие: direction !== 'WAIT')
sendTelegramNotification(formatSignalMessage(updated), analysis.confidence)
// → внутри: пропуск если confidence < Settings.minConfidence

// autoTrade (условие: direction !== 'WAIT')
executeAutoTrade(signalId, pair, analysis, entryPrice)
```

Telegram отправляется до проверки confidence — но внутри `sendTelegramNotification` есть второй фильтр по `minConfidence`. Таким образом Telegram отправляется только если `confidence >= Settings.minConfidence` (default 65).

---

### A.2 OFI-сигнал

**Триггер**

Источник: Bybit aggTrade stream (реальные исполненные сделки).
Файл: `services/indicators/ofiEngine.js:processAggTrade()`.

Включён только если `Settings.ofiEnabled = true` (кеш 60s).

Скользящее окно 60 секунд. Объём каждой сделки = `qty × price`. Определяется направление: `isBuyerMaker=false` → сделка инициирована байером (BUY давление).

Условие LONG: `buyVol / totalVol > 0.65` при минимум 15 сделках в окне.
Условие SHORT: `buyVol / totalVol < 0.35`.

Кулдаун: 90 минут (`SIGNAL_COOLDOWN = 90 * 60 * 1000`).

**Запись Signal в БД:**

```js
prisma.signal.create({
  data: {
    pairId,
    direction,           // 'LONG' или 'SHORT'
    price: midPrice,     // getMidPrice(pair.tradeSymbol) — уже USDT
    claudeAnalysis: '',
    strategy: 'OFI',     // отличает от OBD
    ofiRatio,            // Math.round(ratio * 100) — целое %
    // obd1-obd4: NULL (не OBD сигнал)
  }
})
```

**Claude для OFI:**

Функция `analyzeOfiSignal()`. Claude получает:
- Пара, цена
- OFI направление + ratio%
- Тренд 5m/15m
- ATR(14) на 15m

Системный промпт: `Settings.ofiClaudePrompt`. Хранит тренд-скоринг (в отличие от OBD-промпта, который убрал тренд-скоринг как концептуально неверный для mean-reversion).

**После Claude:** тот же `runClaudePipeline()` — идентичный флоу: обновление цены, DB update, SIGNAL_UPDATE broadcast, Telegram, autoTrade.

**extraDbFields для OFI:** пуст (не передаётся) — `rsi`, `trend5m`, `trend15m`, `atr`, `atrPct` остаются NULL.

---

## B. Полный жизненный цикл сделки (Trade)

### B.1 Создание Trade

**Trade создаётся ПОСЛЕ placeOrder()**, в `executeAutoTrade()`:

```js
const result = await placeOrder({ symbol, side, quantity, stopLoss, takeProfit })

await prisma.trade.create({
  data: {
    signalId,
    symbol: pair.tradeSymbol,
    side,                        // 'BUY' или 'SELL'
    quantity,
    price: result.price || entryPrice,  // avgPrice из Bybit order history (300ms задержка)
    stopLoss: suggestedSl || null,
    takeProfit: suggestedTp || null,
    binanceOrderId: result.orderId,     // orderId входного Market ордера
    status: 'OPEN',
  }
})
```

`quantity = Settings.autoTradeAmount / entryPrice` (в базовом активе).

Ручное создание Trade (через `POST /api/trade/order`) имеет идентичную логику: placeOrder → trade.create, но без `signalId`.

---

### B.2 placeOrder — что размещается на бирже

1. Запрашивается precision символа (`/v5/market/instruments-info`), кешируется.
2. Размещается **Market ордер** (`/v5/order/create`, `orderType: 'Market'`, `marketUnit: 'baseCoin'`).
3. Если SL/TP указаны — добавляются inline в тот же запрос:
   - `body.stopLoss` — стоп-цена
   - `body.takeProfit` — тейк-профит цена
4. Через 300ms запрашивается `avgPrice` из `/v5/order/history`.

---

### B.3 UTA vs Classic аккаунт (inline vs separate TP/SL)

**UTA (Unified Trading Account):** Bybit принимает `stopLoss` и `takeProfit` прямо в теле Market ордера. Один API вызов. Это путь по умолчанию.

**Classic аккаунт:** inline TP/SL отклоняются биржей (ошибка). Поток:

```
try { placeOrder с inline TP/SL } catch (err) {
  // повторный запрос без TP/SL:
  placeOrder без TP/SL → получаем orderId
  // асинхронно (fire-and-forget):
  placeSeparateTpSl(symbol, exitSide, qty, sl, tp, orderId, info)
}
```

`placeSeparateTpSl()` создаёт два ордера параллельно (`Promise.allSettled`):

| Ордер | Тип на Bybit | Детали |
|-------|-------------|--------|
| TP Limit | `orderType: 'Limit'`, `timeInForce: 'GTC'` | `exitSide`, цена = TP |
| SL Stop Market | `orderType: 'Market'`, `orderFilter: 'StopOrder'` | `triggerPrice` = SL, `triggerBy: 'LastPrice'`, `triggerDirection`: Sell=2, Buy=1 |

`orderLinkId` для обоих ордеров формируется как `tp-{последние 28 символов entryOrderId}` и `sl-{...}`.

⚠️ `placeSeparateTpSl` вызывается как fire-and-forget (`.catch(err => logger.warn(...))`). Ошибки не останавливают основной поток — Trade записывается в DB даже если отдельные TP/SL не создались.

---

### B.4 Поле `binanceOrderId`

Поле содержит **orderId входного Market ордера** (строка, `String(orderData.result?.orderId)`).

В `userDataStream.js` используется для матчинга entry fill-а:

```js
const trade = await prisma.trade.findFirst({
  where: {
    OR: [{ binanceOrderId: orderId }, { binanceOrderId: orderLinkId }],
    status: 'OPEN',
  }
})
```

Но для exit ордеров (TP/SL) он НЕ используется — exit определяется через `isInlineTpSl` или `isOpposingSide` (см. раздел C).

---

## C. Как закрывается сделка

### Путь 1 — Bybit Private WebSocket (реальный fill с биржи)

**Подключение:**

`startBybitUserDataStream()` → WebSocket `wss://stream.bybit.com/v5/private`.

HMAC-аутентификация при открытии: подписывается строка `'GET/realtime' + expires` (expires = now+1000ms).

После успешного `auth` → подписка на топик `order`.

Ping каждые 20 секунд (`{ op: 'ping' }`). При разрыве → реконнект через 10 секунд.

**Формат события:**

```json
{
  "topic": "order",
  "data": [{
    "symbol": "BTCUSDT",
    "orderStatus": "Filled",
    "avgPrice": "94500.5",
    "stopOrderType": "TakeProfit",  // или "StopLoss", или ""
    "side": "Sell",
    "orderId": "...",
    "orderLinkId": "tp-..."
  }]
}
```

Обрабатываются только события с `orderStatus === 'Filled'`.

---

**Определение entry vs exit:**

```js
const isInlineTpSl = ['TakeProfit', 'StopLoss'].includes(stopOrderType);

const openTrade = await prisma.trade.findFirst({ where: { symbol, status: 'OPEN' } });

const isOpposingSide = openTrade && (
  (side === 'Sell' && openTrade.side === 'BUY') ||
  (side === 'Buy'  && openTrade.side === 'SELL')
);

const isExitOrder = isInlineTpSl || isOpposingSide;
```

| Условие | Результат |
|---------|-----------|
| `stopOrderType` = TakeProfit или StopLoss | EXIT (UTA inline TP/SL) |
| Сторона заполненного ордера противоположна стороне открытой Trade | EXIT (classic separate TP/SL или ручное закрытие) |
| Ни то ни другое | ENTRY → обновить `trade.price` если `trade.price === 0` |

---

**⚠️ Edge cases в логике isOpposingSide:**

1. Если на символе нет открытой Trade в DB (`openTrade = null`) — `isOpposingSide = false`. Exit-ордер будет ошибочно интерпретирован как entry. `handleOrderFill` вернётся без закрытия (trade не найден по orderId/orderLinkId → silent skip).

2. Для classic-аккаунта SL Stop Market имеет `stopOrderType = ''` или другой тип (не `StopLoss`). Если open trade существует, срабатывает `isOpposingSide`. Если нет — пропуск.

3. Если несколько Trade OPEN на одном символе — `findFirst` возвращает произвольную запись (без ORDER BY). Может быть закрыта не та сделка.

---

**cancelAllOpenOrders при exit:**

```js
cancelAllOpenOrders(symbol).catch(() => {})
```

Вызывает два параллельных POST:
```
/v5/order/cancel-all  { category: 'spot', symbol }                       → отменяет Limit ордера
/v5/order/cancel-all  { category: 'spot', symbol, orderFilter: 'StopOrder' } → отменяет Stop ордера
```

⚠️ Отменяет ВСЕ open ордера на символе. Если на одном символе открыто несколько Trade с разными TP/SL — все они будут отменены при закрытии любой из них.

---

**Расчёт PnL:**

```js
const pnl = trade.side === 'BUY'
  ? ((exitPrice - trade.price) / trade.price) * 100
  : ((trade.price - exitPrice) / trade.price) * 100;
const outcome = roundedPnl > 0.1 ? 'WIN' : roundedPnl < -0.1 ? 'LOSS' : 'BREAKEVEN';
```

Комиссии в PnL **не учитываются** (в отличие от бэктеста где вычитается 0.2%).

---

**Запись в БД при закрытии через userDataStream:**

Trade:
```js
prisma.trade.update({ data: { status: 'CLOSED', pnl: roundedPnl, closedAt: new Date() } })
```

Signal (если `trade.signalId` не null):
```js
prisma.signal.updateMany({
  where: { id: trade.signalId, outcome: null },  // guard от race condition с tracker
  data: { outcome, outcomePnl, outcomePrice, outcomeAt: new Date() }
})
```

Broadcast: `SIGNAL_OUTCOME` (через WS hub).

Telegram: отправляется безусловно (confidence=null → фильтр по confidence не применяется).

---

### Путь 2 — tracker.js (симуляция по midPrice)

**Файл:** `services/signals/tracker.js:trackSignalOutcomes()`

Вызывается каждые 5 секунд (из polling цикла).

**Что делает с Signal:**

1. Находит все Signal с `outcome=null`, `suggestedSl != null`, `suggestedTp != null` для текущего символа.
2. Пропускает WAIT (`direction === 'WAIT' → continue`).
3. Обновляет `maxPrice`/`minPrice` непрерывно.
4. Проверяет касание TP/SL текущей ценой (midPrice).
5. Если Signal старше 1 часа (`TRACKING_TIMEOUT = 60 * 60 * 1000`) и outcome не установлен — принудительно закрывает:
   - `outcomePnl > 0.1% → WIN`
   - `outcomePnl < -0.1% → LOSS`
   - иначе → BREAKEVEN

Запись защищена от race condition:
```js
prisma.signal.updateMany({ where: { id: signal.id, outcome: null }, data: { ... } })
```

**Что делает с Trade: ничего.**

Комментарий в коде явно указывает:
```js
// Trade closure is handled exclusively by userDataStream (real FILLED events from exchange).
// Do not auto-close here — tracker resolves Signal outcome by midPrice simulation,
// but the actual exchange order may still be open (OCO pending).
```

**Когда Signal vs Trade получают outcome/CLOSED:**

| Путь | Signal outcome | Trade status=CLOSED |
|------|---------------|---------------------|
| userDataStream (fill) | После fill, `updateMany` | В тот же момент |
| tracker.js (midPrice sim) | Через 0–60 мин по цене | НИКОГДА через tracker |

⚠️ Возможна ситуация: Signal получает outcome='WIN'/'LOSS' через tracker, но Trade остаётся `status='OPEN'` в БД вечно — если fill-событие с биржи не пришло (WS разрыв, ошибка, classic-аккаунт edge case).

---

## D. Текущие известные проблемы архитектуры

### D.1 Несколько открытых Trade на одном символе

`prisma.trade.findFirst({ where: { symbol, status: 'OPEN' } })` — без `orderBy`. PostgreSQL возвращает произвольную строку из heap.

Последствия:
- При exit fill закрывается **случайная** из нескольких открытых сделок на том же символе.
- `cancelAllOpenOrders(symbol)` отменяет TP/SL ордера **всех** сделок на символе, не только закрываемой.

Смягчение: `Settings.maxOpenTrades` (default: 1) ограничивает авто-сделки. Но ручные сделки через `/api/trade/order` не проверяют лимит.

### D.2 `binanceOrderId` и матчинг fill-событий

`binanceOrderId` содержит orderId входного Market ордера.

Для entry fill — используется:
```js
OR: [{ binanceOrderId: orderId }, { binanceOrderId: orderLinkId }]
```

Для exit fill (TP/SL) — `binanceOrderId` **не используется**. Exit матчится только по `symbol + status=OPEN`. Это значит `binanceOrderId` не помогает при нескольких Trade на одном символе.

### D.3 Edge cases в определении exit ордера

| Сценарий | Поведение |
|----------|-----------|
| Exit fill пришёл, но Trade в DB уже удалён вручную | `findFirst` вернул null → signal/trade не закрыты, Telegram не отправлен |
| WS переподключился и пропустил fill-событие | Trade навсегда остаётся OPEN (tracker сигнал закроет, но не Trade) |
| Classic-аккаунт, SL-ордер с нестандартным `stopOrderType` | Зависит от `isOpposingSide` — должно работать если Trade существует |
| Ручное закрытие позиции на бирже (не через bot) | `isOpposingSide` сработает корректно если стороны совпадают |
| Fill пришёл до записи Trade в DB (race condition) | Trade не найден → entry-fill создаёт пропуск, exit-fill не закрывает |

### D.4 Trade навсегда OPEN после реального закрытия на бирже

Если fill-событие пропущено (разрыв WS, ошибка парсинга) — Trade остаётся `status='OPEN'`. Signal может получить outcome от tracker'а через 1 час.

Нет механизма периодической сверки: отсутствует reconciliation job который бы проверял открытые Trade через `/v5/order/history` и закрывал их если биржа показывает исполненные exit ордера.

---

## E. Sequence Diagrams

### Happy Path: OBD → Claude → Signal → autoTrade → Fill → Close

```
Bybit Depth WS
    │
    ▼ ~100ms ticks
processObdUpdate()
    │
    ├─── save ObdSnapshot (каждые 30s)
    │
    ▼ detectSignal() → LONG|SHORT (если ≥3/4 OBD + EMA trend)
    │
    ├─── cooldown check (15 мин)
    │
    ▼ prisma.signal.create({ direction, obd1-4, price=midPrice, claudeAnalysis='' })
    │
    ├─── broadcast SIGNAL (UI немедленно видит "Analyzing...")
    │
    ▼ [async] analyzeWithClaude()
         │
         ├─── getKlines(5m, 15m) + calcTrend + calcAtr  ─┐ параллельно
         ├─── getSystemPrompt()                          ─┘
         │
         ├─── getKlines(1m) + calcTechnicals (RSI, vol)
         │
         ▼ callClaude(systemPrompt, userMessage)  [до 3 ретраев]
              │
              ▼ JSON: { direction, confidence, suggestedSl, suggestedTp }
              │
              ▼ validateSlTp()  →  корректировка TP или WAIT
              │
              ▼ getMidPrice(tradeSymbol)  →  entryPrice (свежая цена)
              │
              ▼ prisma.signal.update({ direction, confidence, sl, tp, price=entryPrice, rsi, trend*, atr* })
              │
              ├─── broadcast SIGNAL_UPDATE (UI обновляется)
              │
              ├─── [direction ≠ WAIT] sendTelegramNotification (если confidence ≥ minConfidence)
              │
              └─── [direction ≠ WAIT] executeAutoTrade()
                        │
                        ├─── Settings.autoTrade check
                        ├─── confidence >= minConfidence check
                        ├─── openCount < maxOpenTrades check
                        ├─── [SELL] balance check
                        │
                        ▼ placeOrder({ symbol, side, quantity, sl, tp })
                             │
                             ├─── [UTA] Market + inline TP/SL → один вызов /v5/order/create
                             │
                             └─── [Classic] Market → /v5/order/create
                                           + placeSeparateTpSl() [async fire-and-forget]
                                                ├─── Limit TP (GTC)
                                                └─── Stop Market SL (triggerPrice)
                             │
                             ▼ +300ms: GET /v5/order/history → avgPrice
                        │
                        ▼ prisma.trade.create({ signalId, symbol, side, qty, price=avgPrice, sl, tp,
                                                binanceOrderId=orderId, status='OPEN' })
                        │
                        └─── sendTelegramNotification("🤖 Авто-сделка открыта...")

Bybit Private WS (stream.bybit.com/v5/private)
    │  topic: 'order', orderStatus: 'Filled'
    │
    ▼ handleOrderFill()
         │
         ├─── isInlineTpSl? (TakeProfit/StopLoss) → EXIT
         ├─── isOpposingSide? (find OPEN trade, check side) → EXIT
         │
         ▼ cancelAllOpenOrders(symbol)  →  /v5/order/cancel-all (Limit + StopOrder)
         │
         ▼ prisma.trade.findFirst({ symbol, status: 'OPEN' })
         │
         ▼ PnL = (exitPrice - trade.price) / trade.price * 100
         │
         ▼ prisma.trade.update({ status: 'CLOSED', pnl, closedAt })
         │
         ▼ prisma.signal.updateMany({ where: { id: signalId, outcome: null }, data: { outcome, pnl, ... } })
         │
         ├─── broadcast SIGNAL_OUTCOME
         │
         └─── sendTelegramNotification("✅/❌ Сделка закрыта...")
```

---

### Failure Cases

**Case 1: Claude возвращает WAIT**

```
analyzeSignal() → { direction: 'WAIT', ... }
validateSlTp() → пропускает (direction=WAIT)
prisma.signal.update({ direction='WAIT', outcome='WAIT', ... })
broadcast SIGNAL_UPDATE (UI видит WAIT)
← Telegram НЕ отправляется
← autoTrade НЕ запускается
tracker.js: пропускает WAIT сигналы (direction check)
Signal остаётся outcome='WAIT' навсегда
```

**Case 2: Classic-аккаунт (SL как separate Stop Market)**

```
placeOrder() → inline TP/SL → ошибка Bybit
→ Market ордер без TP/SL
→ [async] placeSeparateTpSl()
      ├─── Limit TP: /v5/order/create { orderType: 'Limit', GTC }
      └─── Stop Market SL: /v5/order/create { orderType: 'Market', orderFilter: 'StopOrder', triggerPrice }

На бирже: SL-ордер имеет stopOrderType != 'StopLoss' (зависит от Bybit API)
При fill SL-ордера:
  isInlineTpSl = false
  isOpposingSide = true (если Trade OPEN существует) → определяется корректно
```

**Case 3: Fill не пришёл (WS разрыв)**

```
Позиция закрыта на бирже (TP hit)
WS был отключён → fill-событие пропущено
Реконнект через 10s → новые события приходят
Trade в DB: status='OPEN' (навсегда)
Signal в DB: outcome=null → tracker через 1ч устанавливает outcome по midPrice
Расхождение: Signal.outcome='WIN', Trade.status='OPEN'
Нет reconciliation job → ручное исправление
```

---

## F. Таблица: что куда пишется

| Момент | Signal (поля) | Trade (поля) | Telegram | WS Broadcast |
|--------|--------------|--------------|----------|--------------|
| OBD детекция (до Claude) | `direction`, `obd1-4`, `price=midPrice`, `claudeAnalysis=''` | — | — | `SIGNAL` (`confidence=null`, `claudeAnalysis='Analyzing...'`) |
| OFI детекция (до Claude) | `direction`, `price=midPrice`, `strategy='OFI'`, `ofiRatio`, `claudeAnalysis=''` | — | — | `SIGNAL` |
| Claude возвращает WAIT | `direction='WAIT'`, `outcome='WAIT'`, `confidence`, `claudeAnalysis`, `price=entryPrice`, `suggestedSl/Tp` | — | — | `SIGNAL_UPDATE` |
| Claude возвращает LONG/SHORT | `direction`, `confidence`, `claudeAnalysis`, `suggestedSl/Tp`, `price=entryPrice`, `rsi`, `trend5m/15m`, `atr`, `atrPct`, `tpPct`, `slPct` | — | ✅ если `confidence >= minConfidence` | `SIGNAL_UPDATE` |
| placeOrder() вызван | — | — | — | — |
| Trade создана (после placeOrder) | — | `signalId`, `symbol`, `side`, `quantity`, `price=avgPrice`, `stopLoss`, `takeProfit`, `binanceOrderId=entryOrderId`, `status='OPEN'` | ✅ "🤖 Авто-сделка открыта" | — |
| Entry fill (userDataStream) | — | `price=filledPrice` (если было 0) | — | — |
| Exit fill (userDataStream) | `outcome`, `outcomePnl`, `outcomePrice`, `outcomeAt` (через updateMany) | `status='CLOSED'`, `pnl`, `closedAt` | ✅ "✅/❌ Сделка закрыта" | `SIGNAL_OUTCOME` |
| tracker.js: TP/SL hit по midPrice | `outcome`, `outcomePnl`, `outcomePrice`, `outcomeAt`, `maxPrice`, `minPrice` | ❌ НЕ обновляется | — | `SIGNAL_OUTCOME` |
| tracker.js: 1h timeout | `outcome=WIN/LOSS/BREAKEVEN`, `outcomePnl`, `maxPrice`, `minPrice` | ❌ НЕ обновляется | — | `SIGNAL_OUTCOME` |
| tracker.js: обновление max/min (без outcome) | `maxPrice`, `minPrice` | — | — | — |

---

## Приложение: ключевые файлы

| Файл | Роль |
|------|------|
| `services/indicators/engine.js` | OBD in-memory state, детекция сигнала, executeAutoTrade |
| `services/indicators/ofiEngine.js` | OFI sliding window, детекция, Claude pipeline |
| `services/signals/claudePipeline.js` | Общий пайплайн Claude для OBD и OFI |
| `services/claude/orchestrator.js` | Claude API вызов, форматирование промпта, validateSlTp |
| `services/bybit/rest.js` | placeOrder, cancelAllOpenOrders, placeSeparateTpSl, getMidPrice |
| `services/bybit/userDataStream.js` | Bybit Private WS, handleOrderFill, закрытие Trade |
| `services/signals/tracker.js` | Симуляция по midPrice, бэктест, оптимизация параметров |
| `services/notifications/notifier.js` | Telegram отправка, форматирование сообщений |
| `prisma/schema.prisma` | Схема БД: Signal, Trade, Settings, TradingPair, ObdSnapshot |
| `routes/trade.js` | Ручное размещение ордеров через UI |

See ARCHITECTURE.md for the complete trading lifecycle diagram.
