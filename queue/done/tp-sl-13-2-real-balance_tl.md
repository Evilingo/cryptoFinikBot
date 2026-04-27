# TL Verdict: tp-sl-13-2-real-balance

## Verdict: APPROVE

Dev iter 2 (`Math.min(free, qty)` clamp в обоих местах) корректно закрывает CRITICAL от QA. Готово к пушу.

## Согласие с QA

- **CRITICAL (walletBalance = полный кошелёк)** — согласен полностью. Без `Math.min` код бы залочил все существующие холдинги BTC/ETH/SOL/BNB под TP/SL одной свежей сделки. Реальный риск, не теоретический.
- **Фикс через `Math.min(free, qty)`** — минимальный, точный, без новых абстракций. Соответствует KISS.
- **HIGH (race на maxOpenTrades>1)** — согласен с оценкой. После `Math.min` race даёт деградацию (TP/SL на меньший qty), а не overshoot чужих холдингов. Полный mutex — out of scope.
- **MEDIUM (async gap wallet update)** — согласен, не блокер. Worst case — TP/SL на старый, доfee qty (мизерная разница).

## Что применил сам

Ничего — Dev iter 2 уже применён до меня. Финальный diff проверен: оба места симметричны, `Math.floor` сохраняет защиту снизу, `if (free > 0) / if (floored > 0)` дают двойной fallback к исходному qty.

## Замечания (не блокирующие, на мониторинг)

1. **Manual SELL Market + SL/TP в `placeManualOrder`** не ограничен по `bybitSide`. Для SELL-входа `Math.min(free_после_продажи, qty)` = `qty`, передаётся в `placeTpSl(exitSide='Buy', qty)`. Bybit для Buy-side TP/SL конвертирует qty базы в USDT по цене триггера — баланс чекается отдельно, qty в базе ОК. Семантика мутная (мы только что продали → ставим Buy-back), но это поведение было до фикса. Не регрессия. Если в логах появится 170131 на manual SELL — отдельная задача.
2. **`maxOpenTrades > 1` + одна базовая монета** — два параллельных BUY на BTCUSDT: оба прочитают одинаковый walletBalance, оба сделают `Math.min(free, qty)` = qty (т.к. free > qty каждого). TP/SL поставится на полный qty каждого — суммарно > free → у второго `170131`, словится в `placeTpSl attempt failed` warn. Известное ограничение, оставить в BACKLOG (mutex по baseAsset).
3. **Engine.js SELL-entry оставлен на `confirmedQty`** — корректно: задача 13.6 (SHORT-close модель). Не регрессировать при текущем фиксе.

## Дублирование паттерна

3 места (`portfolio.js` close-trade, `rest.js` placeManualOrder, `engine.js` Phase 2), но семантики **разные**:
- close-trade: "продай всё что есть" (без `Math.min`)
- placeManualOrder/Phase 2: "залочь под конкретную сделку" (с `Math.min`)

Общий хелпер потребовал бы флаг-параметр → нарушение KISS. Inline-копии оправданы. Не выносить.

## После пуша — мониторинг

- Логи `placeTpSl attempt N failed` с `170131` — должны исчезнуть для manual BUY и auto-BUY на популярных монетах.
- Логи `placeManualOrder: failed to fetch balance` / `Phase 2: failed to fetch balance` — не должны появляться часто; если появятся — `getAccountBalance` проблемы, отдельный фикс.
- Скриншот юзера от 2026-04-24 (Place Order BUY 0.001 BTC + SL+TP) — повторить для регрессии.
