# BUG-39 (HIGH): Detect dead SL / hit TP before placing → emergency close instead

**Critical prod bug.** Сегодня обнаружено: 3 из 4 OPEN трейдов (SOL/ETH/BTC) имеют SL "✓" в UI, но фактически **dead SL** — цена уже ниже SL trigger, Bybit держит ордер untriggered (ждёт пересечения сверху-вниз, которого не будет, потому что цена уже ниже). Положение -3.69% / -3.90% при настроенном SL на -0.4%.

## Корень

User clicks Fix (или reconcileTpSl автоматически) когда price уже past SL trigger. Bybit принимает Stop-Market но он dead. Никаких ошибок, всё "успешно", галочка в UI.

## Решение

**Перед placeTpSl** в `fix-protection` route и `reconcileTpSl` — проверить:
- Для BUY: если `currentPrice ≤ trade.stopLoss` → SL мёртв
- Для BUY: если `currentPrice ≥ trade.takeProfit` → TP уже сработал бы
- Для SELL: инвертировано

Если **SL мёртв** → emergency market close (защита бесполезна, ограничиваем убыток).
Если **TP уже за**: тот же emergency market close (зафиксируем прибыль).

## Файлы

### `backend/src/services/indicators/engine.js`

Добавить **module-scope** helper-функции (рядом с другими helpers):

```js
function isSlDead(side, currentPrice, slPrice) {
  if (!slPrice || !currentPrice) return false;
  if (side === 'BUY') return currentPrice <= slPrice;
  return currentPrice >= slPrice; // SELL
}

function isTpHit(side, currentPrice, tpPrice) {
  if (!tpPrice || !currentPrice) return false;
  if (side === 'BUY') return currentPrice >= tpPrice;
  return currentPrice <= tpPrice; // SELL
}
```

Экспортировать обе.

### `backend/src/services/bybit/rest.js`

Уже есть `getMidPrice(symbol)` (строка ~145). Будем использовать.

### `backend/src/services/indicators/engine.js` — `reconcileTpSl` (строки ~395+)

После определения `slPlaced/tpPlaced`, ДО `placeTpSl`:

```js
// Check if SL/TP would be dead/already-hit at current price
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
      const coin = coins.find(c => c.asset === baseAsset);
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
    continue; // skip placeTpSl, trade closure handled by userDataStream on fill
  }
}

// existing placeTpSl call ...
```

### `backend/src/routes/portfolio.js` — `/trades/:id/fix-protection` (строки ~125+)

После определения `slPlaced/tpPlaced`, ДО placeTpSl:

```js
// Check dead protection
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
      const coin = coins.find(c => c.asset === baseAsset);
      const realQty = parseFloat(coin?.free || 0);
      if (realQty > 0) qty = realQty;
    } catch {}
    
    const result = await placeManualOrder({
      symbol: trade.symbol, side: closeSide, orderType: 'Market', qty,
    });
    return res.json({ ok: true, action: 'emergency_closed', reason, orderId: result?.orderId });
  }
}

// existing pre-shrink + retry placeTpSl ...
```

Импорты в portfolio.js: добавить `getMidPrice`, `isSlDead`, `isTpHit`. Imports в engine.js: добавить `getMidPrice` из rest.js (если ещё нет).

## KISS

- Helpers inline в engine.js (используются в 2 местах — допустимо).
- Не выносить в отдельный модуль.
- Не трогать `validateSlTp` (там другая семантика — это PRE-trade проверка).
- Не трогать executeAutoTrade Phase 2 (отдельный кейс — race окно мало).

## Edge cases

- `currentPrice = null` (getMidPrice failed) → пропускаем dead check, идём по обычному пути. Это лучше чем заблокировать всю logic.
- `trade.stopLoss = null` → `isSlDead` возвращает false. Безопасно.
- Цена ровно равна SL: `currentPrice <= slPrice` для BUY → true → emergency close. Это **правильно** — на такой цене SL должен сработать, не оставлять живым.
- `currentPrice` от midPrice может быть на 0.01% от LastPrice — небольшой разрыв допустим, не критично для emergency решений.

## Файлы

- `backend/src/services/indicators/engine.js` — helpers + reconcile case
- `backend/src/routes/portfolio.js` — fix-protection case + imports

## Отчёт Dev

В `queue/qa/bug-39-dead-protection-detect_dev.md`:
- Одно предложение что сделал
- Snippet helper-функций
- Snippet двух early-close-блоков
- Sanity:
  1. Helpers инвариантны для null/undefined
  2. Emergency close использует placeOrder (engine) или placeManualOrder (route) — корректные функции
  3. cancelExitProtection вызывается ПЕРЕД market close (избегаем double-fill)
  4. Telegram alert только в reconcile path (auto), в fix-protection — через response (user уже инициировал)
  5. `continue` в reconcile loop корректно пропускает placeTpSl
