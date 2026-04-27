# BUG-39 Dev Report — Detect dead SL / hit TP before placing → emergency close

## Что сделано

Добавлены module-scope helpers `isSlDead` / `isTpHit` в `engine.js` (экспортируются), импортируются в `portfolio.js`; перед `placeTpSl` в `reconcileTpSl` (engine.js) и в роуте `/trades/:id/fix-protection` (portfolio.js) добавлены early-close блоки: при пересечённом SL или достигнутом TP отменяется старая защита и выполняется emergency market close (через `placeOrder` в reconcile, через `placeManualOrder` в роуте); `getMidPrice` импортирован в оба файла.

## Helpers (engine.js, module scope)

```js
export function isSlDead(side, currentPrice, slPrice) {
  if (!slPrice || !currentPrice) return false;
  if (side === 'BUY') return currentPrice <= slPrice;
  return currentPrice >= slPrice;
}

export function isTpHit(side, currentPrice, tpPrice) {
  if (!tpPrice || !currentPrice) return false;
  if (side === 'BUY') return currentPrice >= tpPrice;
  return currentPrice <= tpPrice;
}
```

## Emergency close в `reconcileTpSl` (engine.js)

Контекст: после `slPlaced/tpPlaced`, до warn "Missing TP/SL ... attempting to recreate".

```js
if (slPlaced && tpPlaced) continue;

// Dead protection guard: SL trigger already crossed or TP already hit.
let currentPrice = null;
try { currentPrice = await getMidPrice(trade.symbol); } catch {}
if (currentPrice) {
  const slDead = !slPlaced && isSlDead(trade.side, currentPrice, trade.stopLoss);
  const tpAlreadyHit = !tpPlaced && isTpHit(trade.side, currentPrice, trade.takeProfit);
  if (slDead || tpAlreadyHit) {
    const reason = slDead
      ? `SL trigger ${trade.stopLoss} already crossed (current ${currentPrice})`
      : `TP target ${trade.takeProfit} already reached (current ${currentPrice})`;
    logger.warn('[TpSlReconciliation] Dead protection — emergency close', { tradeId: trade.id, reason });

    const oldExitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
    const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
    await cancelExitProtection(trade.symbol, oldExitSide).catch(() => {});

    const baseAsset = trade.symbol.replace(/USDT$|USDC$/, '');
    let qty = trade.quantity;
    try {
      const coins = await getAccountBalance();
      const coin = coins.find((c) => c.asset === baseAsset);
      const realQty = parseFloat(coin?.free || 0);
      if (realQty > 0) qty = realQty;
    } catch {}

    try {
      await placeOrder({ symbol: trade.symbol, side: closeSide, quantity: qty });
      sendTelegramNotification(
        `🚨 ${trade.symbol} #${trade.id} — ${reason}\nЗакрыто маркетом во избежание dead SL`,
        null,
      ).catch(() => {});
    } catch (err) {
      logger.error('[TpSlReconciliation] Emergency close failed', { tradeId: trade.id, error: err.message });
    }
    continue; // skip placeTpSl; userDataStream closes Trade record on fill
  }
}

logger.warn('[TpSlReconciliation] Missing TP/SL for OPEN trade — attempting to recreate', { ... });
```

## Emergency close в `/trades/:id/fix-protection` (portfolio.js)

Контекст: после `slPlaced/tpPlaced` (early return при protection already present), до `getSymbolInfo` + retry-loop placeTpSl.

```js
if (slPlaced && tpPlaced) return res.json({ ok: true, message: 'Protection already present', slPlaced, tpPlaced });

// Dead protection guard
let currentPrice = null;
try { currentPrice = await getMidPrice(trade.symbol); } catch {}
if (currentPrice) {
  const slDead = !slPlaced && isSlDead(trade.side, currentPrice, trade.stopLoss);
  const tpAlreadyHit = !tpPlaced && isTpHit(trade.side, currentPrice, trade.takeProfit);
  if (slDead || tpAlreadyHit) {
    const reason = slDead
      ? `SL ${trade.stopLoss} уже пересечён (current ${currentPrice})`
      : `TP ${trade.takeProfit} уже достигнут (current ${currentPrice})`;
    logger.warn('Fix protection: dead protection detected, market closing', { tradeId: id, reason });

    const oldExitSide = trade.side === 'BUY' ? 'Sell' : 'Buy';
    const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
    await cancelExitProtection(trade.symbol, oldExitSide).catch(() => {});

    const baseAsset = trade.symbol.replace(/USDT$|USDC$/, '');
    let qty = trade.quantity;
    try {
      const coins = await getAccountBalance();
      const coin = coins.find((c) => c.asset === baseAsset);
      const realQty = parseFloat(coin?.free || 0);
      if (realQty > 0) qty = realQty;
    } catch {}

    const result = await placeManualOrder({
      symbol: trade.symbol, side: closeSide, orderType: 'Market', qty,
    });
    return res.json({ ok: true, action: 'emergency_closed', reason, orderId: result?.orderId });
  }
}

let symbolInfo;
try { symbolInfo = await getSymbolInfo(trade.symbol); } ...
```

## Импорты

- `engine.js`: `getMidPrice` добавлен в существующий импорт из `../bybit/rest.js`. `placeOrder`, `getAccountBalance`, `cancelExitProtection`, `sendTelegramNotification` уже были.
- `portfolio.js`: `getMidPrice` добавлен в импорт из `../services/bybit/rest.js`; новый импорт `import { isSlDead, isTpHit } from '../services/indicators/engine.js'`. `placeManualOrder`, `cancelExitProtection`, `getAccountBalance` уже были.

## Sanity

1. **Helpers инвариантны для null/undefined.** `isSlDead`/`isTpHit` оба имеют guard `if (!slPrice || !currentPrice) return false` (то же для tpPrice). `null`, `undefined`, `0`, `''` дают false. Значит при `trade.stopLoss=null` или сбое `getMidPrice` (currentPrice=null) — путь dead-close НЕ срабатывает, идём по обычному.
2. **Emergency close корректные функции.** В `reconcileTpSl` (engine.js, авто-контекст без response) — `placeOrder({ symbol, side, quantity })`. В роуте `fix-protection` (portfolio.js, ручное действие) — `placeManualOrder({ symbol, side, orderType: 'Market', qty })`. Это совпадает с существующими паттернами в файлах (Phase 2 emergency close в engine, `/trades/:id/close` в portfolio).
3. **`cancelExitProtection` ПЕРЕД market close.** В обоих местах последовательность: `cancelExitProtection(...).catch(() => {})` → подсчёт qty из реального баланса → market close. Это предотвращает double-fill, если на бирже уже висят dead/limit ордера противоположной стороны.
4. **Telegram alert только в reconcile, не в fix-protection.** В engine.js после успешного `placeOrder` — `sendTelegramNotification(...).catch(() => {})` (auto-путь, юзер не знает). В portfolio.js — `return res.json({ ok: true, action: 'emergency_closed', reason, orderId })` без Telegram (юзер сам нажал Fix, видит результат через UI).
5. **`continue` корректно пропускает placeTpSl в reconcile loop.** Блок dead-protection стоит ВНУТРИ `for (const trade of openTrades)` ПОСЛЕ `if (slPlaced && tpPlaced) continue` и ПЕРЕД `logger.warn('Missing TP/SL...')` + `placeTpSl(...)`. `continue` после emergency-close переходит к следующему трейду — не пытаемся повесить dead SL на уже закрытую позицию. Trade record остаётся OPEN до прихода FILLED события через userDataStream (тот же контракт, что в Phase 2 emergency close).

## Edge cases (проверено)

- `getMidPrice` бросает → `currentPrice=null` → `if (currentPrice)` false → идём в обычный recreate-путь (не блокируем).
- `trade.stopLoss=null` (есть только TP) → `isSlDead` сразу вернёт false благодаря guard, проверится только `isTpHit`.
- `currentPrice === slPrice` для BUY → `<=` true → emergency close (правильно: на цене триггера SL должен сработать, не оставлять dead).
- BUY emergency close с qty из реального wallet (`coin.free`) — то же поведение, что в `/trades/:id/close` и Phase 2 fallback, поэтому совместимо с потерей dust на fee.

## Изменённые файлы

- `/Users/iofinkel/Documents/tradingAlgo/besttrader/backend/src/services/indicators/engine.js` — helpers + import getMidPrice + reconcile early-close
- `/Users/iofinkel/Documents/tradingAlgo/besttrader/backend/src/routes/portfolio.js` — imports + fix-protection early-close
