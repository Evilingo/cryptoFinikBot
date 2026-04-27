# Dev Report: tp-sl-13-2-real-balance

Перед `placeTpSl` после Market-филла читается реальный free-баланс базовой монеты через `getAccountBalance` и используется как qty (с округлением вниз до qtyPrecision); fallback — исходный qty при ошибке.

## Изменения

### `backend/src/services/bybit/rest.js` — `placeManualOrder` (Market-branch)

В блоке `if (orderType === 'Market' && (stopLoss || takeProfit))`, ДО `try { await placeTpSl(...) }`:

```js
// Use real wallet balance — Market BUY deducts ~0.1% fee from base asset, DB qty > free (Bybit 170131)
const baseAsset = symbol.replace(/USDT$|USDC$/, '');
let realQty = qty;
try {
  const coins = await getAccountBalance();
  const coin = coins.find((c) => c.asset === baseAsset);
  const free = parseFloat(coin?.free || coin?.total || 0);
  if (free > 0) {
    const factor = Math.pow(10, info.qtyPrecision);
    const floored = Math.floor(free * factor) / factor;
    if (floored > 0) realQty = floored;
  }
} catch (err) {
  logger.warn('placeManualOrder: failed to fetch balance, using original qty', { symbol, error: err.message });
}
```

Затем `placeTpSl(symbol, exitSide, ..., info, realQty)`.

`getAccountBalance` уже определён в этом же файле (строка 111) — импорт не нужен.

### `backend/src/services/indicators/engine.js` — `executeAutoTrade` Phase 2 (BUY-entry)

После `getSymbolInfo` блока и ДО `for (let attempt = 0; attempt < 3; attempt++)`:

```js
// BUY-entry: Market BUY deducts ~0.1% fee from base asset, DB qty > free (Bybit 170131).
// SELL-entry: SHORT-close model differs — leave confirmedQty (task 13.6).
let tpSlQty = confirmedQty;
if (side === 'BUY') {
  const baseAsset = pair.tradeSymbol.replace(/USDT$|USDC$/, '');
  try {
    const coins = await getAccountBalance();
    const coin = coins.find((c) => c.asset === baseAsset);
    const free = parseFloat(coin?.free || coin?.total || 0);
    if (free > 0) {
      const factor = Math.pow(10, symbolInfo.qtyPrecision);
      const floored = Math.floor(free * factor) / factor;
      if (floored > 0) tpSlQty = floored;
    }
  } catch (err) {
    logger.warn('Phase 2: failed to fetch balance, using confirmedQty', { symbol: pair.tradeSymbol, error: err.message });
  }
}
```

`placeTpSl(..., tpSlQty)` вместо `confirmedQty`. `confirmedQty` в остальных местах (Phase 3 log, Telegram) не тронут.

`getAccountBalance` уже импортирован в engine.js из `'../exchange/index.js'` (строка 6).

## Почему так

Тот же паттерн используется в `backend/src/routes/portfolio.js:96-105` (close-trade route). Симметричное решение там и здесь — KISS, не выносится в хелпер при использовании в 3 местах (граница приемлемости). Идея — биржа "знает правду" о балансе после fee, БД хранит то что мы запросили.

## Sanity checks

- **SELL-entry не тронут:** условие `if (side === 'BUY')` гарантирует, что SHORT-entry оставляет `tpSlQty = confirmedQty`. SHORT — отдельная задача 13.6.
- **Fallback при ошибке:** оба места ловят ошибку `getAccountBalance` и оставляют `realQty`/`tpSlQty` равным исходному qty. Логгируется warn.
- **`Math.floor` (не round):** избегает overshoot, который снова бы привёл к 170131 на 1 сатоши.
- **Guard на `floored > 0`:** если после floor получится 0 (баланс ниже precision), используется fallback вместо placeTpSl с qty=0.
- **`info.qtyPrecision` всегда определён:** в обоих файлах есть fallback `{ pricePrecision: 2, qtyPrecision: 6 }` если getSymbolInfo упадёт.
