# BUG-13.4 — QA Report

QA: чисто.

## Проверено

1. **Diff корректен** — 4 правки (rest.js: новая функция + import; engine.js ×2 call-sites + import; portfolio.js call-site + import).
2. **exitSide правильность:**
   - engine.js reverse (~166): `existingTrade.side === 'BUY' ? 'Sell' : 'Buy'` — exit-side старой позиции, корректно.
   - engine.js Phase 2 emergency (~369): использует существующий `exitSide` (стр. 309 = `side === 'BUY' ? 'Sell' : 'Buy'`) — это exit-side только что открытого трейда (existingTrade guard выше), который и закрываем emergency. Корректно.
   - portfolio.js (~93): `trade.side === 'BUY' ? 'Sell' : 'Buy'` — exit-side трейда, корректно.
3. **Bybit canonical case** ('Buy'/'Sell') передаётся в `cancelExitProtection`, что совпадает с `o.side` из getOpenOrders. Локальный `exitSide` в snake-uppercase ('SELL'/'BUY') в portfolio.js и engine.js используется для placeOrder/placeManualOrder — не пересекается.
4. **Импорты:**
   - rest.js: `import { isSlOrder, isTpOrder } from './orderMatchers.js'` добавлен (стр. 7).
   - engine.js: `cancelAllOpenOrders` убран из exchange-import; `cancelExitProtection` добавлен в bybit-import. grep подтверждает: больше нет вызовов `cancelAllOpenOrders` в engine.js.
   - portfolio.js: `cancelAllOpenOrders` заменён на `cancelExitProtection`. grep подтверждает: больше нет вызовов в portfolio.js.
5. **Sanity:**
   - `cancelAllOpenOrders` остался exported в `bybit/rest.js` (стр. 257).
   - Используется в `userDataStream.js` (стр. 15) — не часть задачи, не затронуто. ОК.
   - `Promise.allSettled` корректно — частичные отказы логируются, не валят flow.
   - Edge cases (targets=0, getOpenOrders throw, allSettled rejections) обработаны как в спеке.

## Заметка для TL / ROADMAP (не баг)

Предикат `isSlOrder` ловит любой Stop-Market (`triggerPrice>0 && price===0`), включая manual SL юзера на той же exit-side. Это **не регрессия** vs `cancelAllOpenOrders` (тот тоже сносил), но фикс не полностью решает «не трогать user-side ордера», если юзер своими руками поставил Stop-Market. TP-предикат строже (требует `orderType === 'Limit'` + price + triggerPrice), там риск ниже. Возможный future-improvement: помечать наши protection-ордера через `orderLinkId` префикс и матчить по нему.
