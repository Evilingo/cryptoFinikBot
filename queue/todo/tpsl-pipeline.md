# Task: Правильная транзакция открытия позиции (TP/SL pipeline)

## Контекст проблемы

Система торгует на Bybit UTA Spot. Постоянные проблемы: позиции открыты в DB,
но на бирже нет защитных ордеров. Причина — код доверяет ответу API и не верифицирует
что SL/TP реально созданы.

## Текущий сломанный флоу (engine.js executeAutoTrade)

```
placeOrder()  → POST /v5/order/create (market + inline tp/sl params)
             → if retCode=0 → prisma.trade.create(status: 'OPEN')  ← конец
```

Проблемы:
- `slFailed` hardcoded `false` — нет детекции провала
- Bybit может молча проигнорировать inline TP/SL параметры
- Нет верификации что TP/SL реально появились на бирже
- Нет reconciliation для уже открытых сделок

## Требуемая схема — 4 фазы

### Фаза 1: Entry
- Сохранить Trade с `status: 'PENDING'` в DB (до ордера)
- Разместить market order БЕЗ inline tp/sl (убрать takeProfit/stopLoss из body)
- Ждать fill confirmation: слушать WS event ИЛИ poll `/v5/order/history` до 5s
- Получить confirmed `avgPrice` и `cumExecQty` из fill
- Обновить `trade.price` и `trade.quantity` реальными значениями

### Фаза 2: Защита (до 3 попыток, backoff 500ms→1s→2s)
- Разместить явные раздельные ордера: TP Limit + SL StopMarket (НЕ inline)
- Через delay проверить `getOpenOrders(symbol)`
- Проверить наличие sell-side ордеров с нужным stopOrderType
- Если НЕ найдены: retry (max 3)
- Если провал после 3 попыток:
  - Аварийное закрытие позиции (market order exitSide)
  - `trade.status = 'FAILED'`
  - Telegram: 🚨 "Позиция закрыта аварийно: SL не создан"
  - RETURN (не открывать)

### Фаза 3: Коммит
- `trade.status = 'OPEN'`, `trade.slOrderFailed = false`
- Telegram: ✅ "Сделка открыта, SL/TP активны"

### Фаза 4: Reconciliation job
- Запускается при старте сервера
- Каждые 60 секунд: для каждой OPEN сделки с `age < 55min`
- `getOpenOrders(symbol)` → проверить есть ли sell-side защита
- Если нет: одна попытка пересоздать TP/SL
- Если провал: Telegram 🚨 + `trade.slOrderFailed = true`
- Экспортировать `startReconciliation()` / `stopReconciliation()`

## Файлы для изменения

### 1. `backend/src/services/bybit/rest.js`
- `placeOrder()`: убрать inline tp/sl параметры (только Market order)
- Добавить `placeTpSl(symbol, side, qty, stopLoss, takeProfit, info)`:
  - Принимает уже рассчитанные qty/price строки (или сырые числа + info)
  - Параллельно размещает TP Limit + SL StopMarket
  - Возвращает `{ tpOrderId, slOrderId }` или бросает
- `getOpenOrders` — уже обновлён, включает OcoOrder фильтр

### 2. `backend/src/services/indicators/engine.js`
- `executeAutoTrade()`: переписать под 4-фазную схему
- Добавить `startReconciliation()` / `stopReconciliation()`
- Экспортировать оба

### 3. `backend/src/server.js` (или где стартуют сервисы)
- Вызвать `startReconciliation()` при старте
- Вызвать `stopReconciliation()` при graceful shutdown

## Ограничения

- KISS — минимум новых абстракций
- Не трогать userDataStream.js (он корректно обрабатывает fills)
- Не трогать фронтенд
- Не добавлять новые npm пакеты
- Bybit category: 'spot' везде
- TP ордер: orderType='Limit', orderFilter='tpSlOrder' (или без фильтра)
- SL ордер: orderType='Market', triggerPrice=stopLoss, orderFilter='StopOrder'
- exitSide для BUY позиции = 'SELL', для SELL = 'BUY'

## Проверка корректности (для QA)

1. При провале fill confirmation (timeout) — Trade должен остаться PENDING, не OPEN
2. При провале защиты — Trade должен стать FAILED, позиция закрыта
3. При успехе — Trade OPEN только после confirmed TP/SL на бирже
4. slFailed никогда не hardcoded false
5. Reconciliation не трогает сделки старше 55 минут (близко к timeout)
6. Параллельный старт нескольких executeAutoTrade для одного symbol невозможен (проверить guard)
