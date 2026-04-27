# BUG-39 TL Verdict — Detect dead SL / hit TP → emergency close

## Verdict: APPROVE

## Согласие с QA

Согласен. QA-замечание (MEDIUM на фронте: после `emergency_closed` показывалось "already protected") — валидное, было настоящим UX-багом.

Dev iter 2 уже применил фикс в `Portfolio.jsx`:
- ветка `if (data.action === 'emergency_closed')` со status-сообщением `emergency-closed (${reason})`
- бонусом — оптимистичный `setBotTrades(prev => ... { ...t, status: 'CLOSING' })`, чтобы строка немедленно отразила состояние до прихода FILLED через userDataStream. QA не требовал, но это разумное улучшение поверх минимального фикса (строка не исчезнет — её закроет userDataStream — но статус сразу честный).

Build passed.

## Что применил сам

Ничего — Dev iter 2 закрыл MEDIUM. Backend (engine.js reconcile + portfolio.js fix-protection route) и helpers (`isSlDead`/`isTpHit` в engine.js) принимаются как есть, претензий нет:
- `cancelExitProtection` ПЕРЕД market close в обоих путях — защита от double-fill
- `placeOrder` (auto) / `placeManualOrder` (user) — соответствует существующим паттернам (Phase 2 emergency / `/trades/:id/close`)
- `continue` в reconcile loop корректно пропускает `placeTpSl` для уже-закрытой позиции
- Trade.status закрывается через userDataStream FILLED — тот же контракт, что в Phase 2 emergency close (намеренно НЕ дублируем DB-апдейт здесь — KISS)

## Архитектурная ремарка (не блокер)

В reconcile есть теоретическая возможность повторного срабатывания emergency-close на следующем 60s-цикле, если userDataStream пропустил FILLED event: trade.status в БД остаётся OPEN → reconcile снова пытается emergency-close уже несуществующей позиции → `placeOrder` упадёт с insufficient balance, попадёт в `catch` → `logger.error(...)`. Это безопасно (ошибка в логах, не повреждение состояния), и тот же риск уже существует в Phase 2 emergency close. Не чиним сейчас. Если в логах появится паттерн повторных "Emergency close failed" по одному и тому же tradeId — отдельный тикет на reconciliation для застрявших OPEN записей.

## Пост-деплой мониторинг

1. **Логи `[TpSlReconciliation] Dead protection — emergency close`** — ожидаем срабатывания на текущих 3 застрявших трейдах (SOL/ETH/BTC) в первом же 60s-цикле reconcile после деплоя. Если не сработали — проверить, что `getMidPrice` возвращает валидное число (не null).
2. **Telegram-уведомления `🚨 ... Закрыто маркетом во избежание dead SL`** — должны прийти 3 штуки (по числу dead-SL трейдов), потом тишина. Если приходят повторно по тому же tradeId — Trade.status не закрывается через userDataStream → копать в `userDataStream.js` filled-handler.
3. **Логи `Emergency close failed` (error)** — индикатор того, что qty/баланс не сошлись или биржа отклонила. Ожидаем 0 за первые 24ч; ненулевое значение — сразу разбирать конкретный tradeId.
