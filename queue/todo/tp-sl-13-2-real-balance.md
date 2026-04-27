# TP/SL-13.2 — Use real balance after Market fill for placeTpSl (fixes Bybit 170131)

**Priority:** HIGH — прод-блокер Place Order с SL/TP.

## Проблема

Market BUY списывает 0.1% fee с базовой монеты → фактический free-баланс ниже запрошенного qty на ~0.1%. `placeTpSl(qty=исходный)` пытается зарезервировать 0.001 BTC для TP Limit sell, но на балансе 0.000999 → Bybit отвергает с `170131: Insufficient balance`.

**Два места:**
1. `backend/src/services/bybit/rest.js:434+` — `placeManualOrder` при `orderType='Market'` зовёт `placeTpSl(qty=исходный)` → в проде блокирует Place Order с SL/TP (подтверждено 2026-04-24 скриншотом).
2. `backend/src/services/indicators/engine.js:276,314` — `executeAutoTrade` Phase 2: `confirmedQty = quantity` (исходный), потом `placeTpSl(confirmedQty)`. Для крошечных bot-qty (0.000116) fee < qtyPrecision и округляется к нулю → не видно. Для больших qty тот же баг.

## Готовый паттерн

`backend/src/routes/portfolio.js:96-105` (close-trade route):
```js
const baseAsset = trade.symbol.replace(/USDT$|USDC$/, '');
let qty = trade.quantity;
try {
  const coins = await getAccountBalance();
  const coin = coins.find(c => c.asset === baseAsset);
  const realQty = parseFloat(coin?.free || coin?.total || 0);
  if (realQty > 0) { qty = realQty; }
} catch { /* fallback to DB qty */ }
```

## Решение

### Файл 1: `backend/src/services/bybit/rest.js` — `placeManualOrder` (Market-branch)

После `const data = await privatePost(...)` и ДО `if (orderType === 'Market' && (stopLoss || takeProfit))`:

- `baseAsset = symbol.replace(/USDT$|USDC$/, '')`
- `realQty = qty` (fallback default)
- try { getAccountBalance → найти coin по baseAsset → `free = parseFloat(coin?.free || coin?.total || 0)` → `realQty = Math.floor(free * 10^qtyPrecision) / 10^qtyPrecision` при `free > 0` } catch { оставить fallback, `logger.warn` }
- Использовать `realQty` в `placeTpSl(..., realQty)`.

`qtyPrecision` уже есть в локальной переменной `info`.

### Файл 2: `backend/src/services/indicators/engine.js` — Phase 2 (только BUY-entry)

Перед `await placeTpSl(..., confirmedQty)` на строке ~314:
- Вычислить `tpSlQty`: при `side === 'BUY'` — через `getAccountBalance` и floor-округление (точно как в Файле 1); при `side === 'SELL'` — оставить `confirmedQty` (SHORT закрытие покупает базу, там другая модель — отдельная задача 13.6).
- Передать `tpSlQty` в `placeTpSl`.
- `confirmedQty` в остальных местах (Phase 3 log, Telegram) НЕ менять.

## KISS

- **Не выносить в хелпер** — используется в 2 местах, inline допустимо (стандарт проекта).
- Не менять сигнатуру `placeTpSl`.
- Не рефакторить `placeManualOrder`/`executeAutoTrade` целиком — точечные вставки.
- Без новых файлов. Без async-хелперов.
- Не трогать `placeOrder` — он не зовёт placeTpSl.

## Типичные ошибки

- `parseFloat(coin?.free || coin?.total || 0)` — guard от null.
- `Math.floor`, не `round` — иначе снова может не хватить.
- Проверить что `getAccountBalance` импортирован в обоих файлах (в engine.js — почти наверняка нет).
- `qtyPrecision` всегда > 0 (ожидается 4-8 для криптопар). Если fallback `symbolInfo.qtyPrecision = 6` — ок.
- Минимальная qty на Bybit: если после floor осталось 0 — placeTpSl с qty=0 или null некорректно. Guard: `if (realQty > 0)` перед использованием, иначе fallback.

## Файлы

- `backend/src/services/bybit/rest.js` (placeManualOrder Market-branch, ~4-8 добавленных строк)
- `backend/src/services/indicators/engine.js` (Phase 2 перед placeTpSl, ~6-10 строк + возможный import)

## Ожидаемый результат

- Place Order (manual) BUY 0.001 BTC + SL + TP → успех, оба ордера на бирже.
- Auto-trade (когда бот откроет следующую сделку) — тоже идёт через реальный баланс.
- `Bybit 170131: Insufficient balance` больше не появляется в логах.

## Отчёт Dev

В `queue/qa/tp-sl-13-2-real-balance_dev.md`:
- Одно предложение что сделал.
- Для каждого из 2 мест: короткий snippet (до/после).
- Ссылка на close-trade паттерн как на источник.
