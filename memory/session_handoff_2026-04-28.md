---
name: Session handoff 2026-04-24..28
description: Полное состояние проекта после интенсивной сессии багофиксов и cost-optimization. Читать первым при возобновлении.
type: project
last_updated: 2026-04-28
---

# Session Handoff — Apr 24-28, 2026

## TL;DR (если читаешь только это)

За 4 дня закрыто **3 каскадных прод-бага** в TP/SL placement (170130, 170202, 170131 → каждый раз вскрывал следующий слой), реализован **dead-protection detect** для зомби-SL, добавлена **JS pre-filter** + **переход на Haiku 4.5** для cost optimization. Бот работает, цена Claude API упала с **$1.75/день → ~$0.04/день** (~44× cheaper). Сейчас фаза **monitor 1 week** (boss-вердикт), новых фич не добавляем, только критфиксы.

---

## Project context (без изменений)

- **Что:** BestTrader — Bybit Spot trading bot. OBD + OFI детекция → Claude → auto-trade Bybit Spot.
- **Размер позиции:** ~$9/trade (qty=0.000116 BTC). Это **лаборатория**, не коммерция (boss-цитата: "trading $9 is not a system, it's a school").
- **Stack:** Node.js ESM + Express 5 + Prisma + PostgreSQL + Redis + Vite (React 18). Bybit UTA Spot API.
- **Деплой:** Railway (auto-deploy on push to main). DATABASE_URL only on Railway, локально нет.
- **Pairs:** BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT.
- **maxOpenTrades=1**, fee 0.2% round-trip.

## Что задеплоено за сессию (хронологически)

| # | Commit | Что |
|---|---|---|
| 1 | bae26fe | SIGNAL_OUTCOME phantom-close: tradeId match, not symbol+status |
| 2 | bae26fe (same) | Bot Trades UI: Time column (DD.MM HH:MM:SS Europe/Moscow) + live PnL |
| 3 | 3e758cc | Cleanup OcoOrder debug log из `getOpenOrders` |
| 4 | c991498 | Phase 2 strict TP/SL verification: separate slPlaced/tpPlaced, не один hasSellSide |
| 5 | 6965b40 | Place Order 170130: убрать inline TP/SL для Market, отдельный placeTpSl |
| 6 | b49310b | "Fix" button + reconcile only-missing |
| 7 | 4f887ef | Refined Fix button predicate (только при реальном mismatch) |
| 8 | 79cd53b | **ROOT FIX 170202**: placeTpSl TP отсутствовал triggerPrice — TP **никогда** не ставился вообще |
| 9 | 966a84d | Refactor: orderMatchers.js shared module (3 копии isSlOrder/isTpOrder → 1) |
| 10 | d9b3c19 | ROADMAP Priority 13 (TP/SL hardening) — 8 пунктов |
| 11 | 3e171f1 | BACKLOG BUG-35, BUG-36 (manual SELL guard, mutex per baseAsset) |
| 12 | 940ea58 | UI reorder: Place Order/Bot Trades top → Holdings bottom |
| 13 | 84f0491 | **170131 v2**: getAccountBalance после Market fill даёт stale free=0 (async wallet propagation), решено через cumExecQty - cumExecFee polling |
| 14 | 5fe3d75 | Fix-protection: retry-shrink (3 попытки × 0.999) для исторических qty |
| 15 | (in 84f0491) | Phase 2 + executeAutoTrade: cumExecQty path для расчёта netQty |
| 16 | (separate) | BUG-13.4: cancelExitProtection заменил cancelAllOpenOrders в 3 местах |
| 17 | 763fc30 | Claude OFI: получает RSI + candles + tech (раньше отвечал WAIT/0 потому что данных нет) |
| 18 | 627eb7b | **JS pre-filter** перед Claude: ATR<0.15%, OFI 35-65%, FLAT+lowATR |
| 19 | 2e87eb4 | **BUG-39**: dead protection detect (свежие трейды) — emergency close если current уже за SL |
| 20 | 2199282 | **BUG-40+41**: dead-detect ВСЕГДА (не только <55min) + UI DEAD/HIT badges |
| 21 | b67d43d | Cost step 3: **Haiku 4.5** вместо Sonnet 4.5 в callClaude |

## Pending todos

| # | Task | Status |
|---|---|---|
| 1 | Verify OFI fix (RSI/candles to Claude) producing non-WAIT signals on prod | pending |
| 2 | Monitor for 1 week — record signal counts, claude pass rate, auto-trade opens, WIN/LOSS | in_progress |
| 3 | Cost step 4: compress prompt input (drop 20-candle JSON dump from OBD path) | pending — мизерная экономия (~-$0.012/день), может пропустить |

## Ключевые решения / архитектура

### Cost optimization путь
- **Шаг 1 (cache) — отменён:** system prompt ~700-900 токенов < 1024 минимум для Sonnet. Cache не активируется. Не подходит use-case.
- **Шаг 2 (pre-filter):** in `orchestrator.js` 2 helper'а `obviousWaitForOfi/obviousWaitForObd` перед `callClaude`. Правила: `ATR<0.15%` (мёртвый рынок), `OFI 35-65%` (нейтраль), `FLAT+ATR<0.30%` (нет момента). Возвращают reason или null. Цель -60-70% вызовов.
- **Шаг 3 (Haiku):** `model: 'claude-haiku-4-5'` вместо Sonnet в `callClaude`. 12× дешевле. Промпт детерминирован (таблица правил), Haiku справится с classification.
- **Шаг 4 (compress):** убрать 20 свечей JSON из OBD userMessage — отложен, мизерный эффект.

### TP/SL placement (4-фазная модель + всё что вокруг)
- `executeAutoTrade` (engine.js) — 4 фазы: 1) Market BUY, 2) Place SL/TP с верификацией (3 retries+backoff), 3) Commit OPEN, 4) reconcileTpSl каждые 60с.
- `placeTpSl` (rest.js): TP — Limit с `triggerPrice` + `orderFilter='tpSlOrder'` (без triggerPrice — 170202). SL — Stop-Market с `orderFilter='StopOrder'`.
- **netQty calc:** для BUY-entry используем `cumExecQty - cumExecFee` (polling order/history), не `getAccountBalance` (stale из-за async wallet).
- **Fix-protection retry-shrink:** для исторических qty pre-shrink 0.999 + 3 retry × 0.999 на 170131.
- **Dead-protection check:** `isSlDead/isTpHit` predicates в engine.js (module-scope, exported). reconcile zовёт ВСЕГДА (не только <55min). fix-protection зовёт ПЕРВЫМ (до early-return "already protected").

### Predicates / matchers
- `backend/src/services/bybit/orderMatchers.js`: `isSlOrder/isTpOrder` — match Bybit-orders по shape (stopOrderType + price/triggerPrice). Используется в `engine.js` (Phase 2 verify, reconcile), `routes/portfolio.js` (fix-protection).
- TP shape после ROOT FIX: `orderType==='Limit' && price>0 && triggerPrice>0` (раньше было `triggerPrice===0` — но TP без triggerPrice не ставился, предикат был мёртвый).
- SL shape: `stopOrderType in ('StopLoss','Stop','OcoTriggerByStopLoss') OR (triggerPrice>0 && price===0)`.

### UI behavior (Portfolio.jsx)
- Order: Place Order → Bot Trades → Open Orders → Holdings.
- Bot Trades: Time, Symbol, Side, Entry, SL, TP, Current, Qty, Status, Protection, PnL, Close.
- Live PnL для OPEN: `(current - entry) / entry * 100 - 0.2` (BUY; SHORT инвертировано), USD: `qty*(cur-entry)`.
- Protection badges: `SL ✓` / `TP ✓` / `SL ⚠ DEAD` / `TP ⚠ HIT` / `⚠ No orders`. DEAD/HIT — когда current уже за trigger.
- Fix кнопка: видна когда есть mismatch (missing на бирже OR dead/hit).
- WS handler matches by `tradeId`, не symbol (чтобы не ложно-закрывать при нескольких pos на одном символе).

### Boss strategy (commitments)
1. **Monitor 1 week, only critical fixes.** Не добавлять новые фичи.
2. Через неделю собрать метрики: signal counts / Claude pass rate / auto-trade opens / WIN/LOSS / pre-filter hit rate / Anthropic billing.
3. Решение о направлении проекта — после данных, не до.

## Известные нюансы / latent issues

- **maxOpenTrades=1** — глобально. Если поднимать → нужен mutex per baseAsset (BUG-36) и orderLinkId на TP/SL (TP/SL-13.3) перед инкрементом.
- **Manual SELL Market + SL/TP без guard по `bybitSide`** — BUG-35 в backlog. Не блокирует.
- **`binanceOrderId` поле хранит Bybit orderId** — legacy имя, переименование в `exchangeOrderId` отложено.
- **Emergency close использовал `cancelAllOpenOrders`** — заменил на `cancelExitProtection` (только exit-side, не сносит ручные ордера на том же символе) — BUG-13.4.
- **AGE_LIMIT_MS=55min** в reconcile — гейтит **только recreate-missing**, не dead-check (после BUG-40).
- **getMidPrice per-trade** в reconcile (нагрузка): public Bybit endpoint, без auth, 250-750ms на 5 трейдов. BUG-42 в backlog: батчевый ticker call.
- **Cache не подходит** нашему workload: prompt ~700-900 токенов (< 1024 min) и pre-filter снижает частоту до < 1 call per 5min window (cache hit rate < 25%, сам кэш становится антипаттерном).

## Файлы — где что

| Файл | За что отвечает |
|---|---|
| `backend/src/services/claude/orchestrator.js` | callClaude (Haiku 4.5), pre-filter helpers, validateSlTp, analyzeOfiSignal/analyzeSignal |
| `backend/src/services/claude/prompts.js` | OBD/OFI system prompts (~700-900 токенов каждый, читаются из Settings) |
| `backend/src/services/indicators/engine.js` | executeAutoTrade (4 фазы), reconcileTpSl, isSlDead/isTpHit (exported), processObdUpdate |
| `backend/src/services/bybit/rest.js` | placeOrder, placeTpSl (с triggerPrice), placeManualOrder (Market+SL/TP отдельно), getMidPrice, getOpenOrders |
| `backend/src/services/bybit/orderMatchers.js` | isSlOrder/isTpOrder shared (3 backend call sites) |
| `backend/src/services/bybit/userDataStream.js` | handleOrderFill — закрывает Trade при FILLED. Match по orderLinkId tp-/sl- + symbol fallback |
| `backend/src/services/bybit/reconciliation.js` | reconcileOpenTrades (не путать с reconcileTpSl) — догоняет пропущенные FILL events |
| `backend/src/routes/portfolio.js` | /balance, /orders, /trades/:id/close, /trades/:id/fix-protection (с dead-check, retry-shrink) |
| `frontend/src/pages/Portfolio.jsx` | Bot Trades UI (Time/PnL/Protection/Fix), Place Order, Open Orders/History, Holdings |
| `ROADMAP.md` | Priority 13 — TP/SL hardening (8 пунктов 13.1-13.8) |
| `BACKLOG.md` | BUG-35..42, ARCH-05..07, PERF-03, OBSV-04, и пр. |
| `ux-pain.md` | Лог UX-замечаний (на будущий рефакторинг фронта) |

## Open backlog (HIGH-MEDIUM)

- **TP/SL-13.1** HIGH: partial success leak в placeTpSl
- **TP/SL-13.3** HIGH: orderLinkId не ставится — by-symbol fallback only at maxOpenTrades=1
- **BUG-36** MEDIUM (latent): mutex per baseAsset перед увеличением maxOpenTrades
- **BUG-35** MEDIUM: manual SELL Market guard
- **TP/SL-13.5** MEDIUM: Manual Limit + inline TP/SL — непроверенная гипотеза
- **TP/SL-13.6** MEDIUM: SHORT/SELL entry в проде не прогонялся
- **BUG-42** LOW: батчевый getMidPrice через `/v5/market/tickers`

## Что НЕ делать без данных

- Менять prompt rules (без conf-distribution data)
- Лезть в Cost step 4 (мизер)
- Расширять maxOpenTrades (пока mutex не сделан)
- Любые архитектурные решения "пока есть время" — boss сказал monitor

## Восстановление контекста при новой сессии

1. Прочитай этот файл
2. `git log --oneline -25` — увидишь последние коммиты сессии
3. `cat ROADMAP.md | head -200` — для контекста по приоритетам
4. `cat BACKLOG.md | grep "^### " | head -20` — список багов
5. Спроси пользователя: "что наблюдается на проде / что хочешь делать"

## Текущая модель в Claude Code

Пользователь переключился на **Sonnet 4.6** для текущей фазы (мониторинг + мелкие фиксы). Если потребуется `/discuss` или сложный `/backtest` — переключение обратно на Opus.
