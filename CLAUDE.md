# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Engineering Principles

**KISS — Keep It Simple, Stupid.** This is the primary engineering rule for this project.
- Prefer fewer abstractions over more. Three similar lines beat a premature helper.
- Debug code is temporary — remove it once the issue is diagnosed, not after.
- Don't add parameters, flags, or layers unless the current code genuinely requires them.
- When reviewing your own work, ask: "does this need to exist?"

## Project Overview

BestTrader is a Binance Spot trading signal platform. It monitors order book depth (OBD) indicators across trading pairs, detects LONG/SHORT signals when all 4 OBD indicators move synchronously, then uses Claude AI to confirm/analyze the signal and suggest SL/TP levels. Results are tracked automatically.

## Commands

### Infrastructure
```bash
docker compose up -d        # PostgreSQL + Redis (local dev)
# OR via Homebrew (macOS):
brew services start postgresql@16
brew services start redis
createdb trading_db
```

### Backend
```bash
cd backend
cp .env.example .env        # fill required vars
npm install
npm run db:generate         # generate Prisma client
npm run db:push             # push schema to DB
npm run dev                 # start with --watch (hot reload)
npm start                   # production (also runs prisma db push)
```

### Frontend
```bash
cd frontend
npm install
npm run dev                 # Vite dev server on :5173
npm run build
```

### Deployment (Railway)
- Root directory: repo root (empty, not `backend/`)
- Build: `npm run build` (root package.json installs backend+frontend deps, builds frontend)
- Start: `npm start` (delegates to `npm --prefix backend start`)
- Backend serves frontend static files from `frontend/dist/`
- PostgreSQL: Railway plugin, `DATABASE_URL` must be set in backend service Variables
- Start command set in Railway UI: `npx prisma db push && node src/server.js`

## Environment Variables (backend/.env)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `JWT_SECRET` | ✓ | 64 hex chars |
| `JWT_REFRESH_SECRET` | ✓ | 64 hex chars |
| `ENCRYPTION_KEY` | ✓ | 64 hex chars (AES-256 for Binance keys) |
| `ADMIN_USERNAME` | ✓ | Auto-created on first start |
| `ADMIN_PASSWORD` | ✓ | Auto-created on first start |
| `ALLOWED_ORIGIN` | ✓ | Frontend URL for CORS (same domain in prod — set to backend URL) |
| `ANTHROPIC_API_KEY` | optional | If absent — Claude analysis is skipped, signals still saved |
| `TELEGRAM_TOKEN` | optional | Synced to DB Settings on startup |
| `TELEGRAM_CHAT_ID` | optional | Synced to DB Settings on startup |
| `REDIS_URL` | optional | Not currently used |
| `DEV_SKIP_AUTH` | dev only | `true` → /auth/refresh returns token without credentials |
| `BINANCE_TESTNET` | dev only | `true` → use testnet.binance.vision instead of api.binance.com |
| `BYBIT_TESTNET` | dev only | `true` → use api-testnet.bybit.com and stream-testnet.bybit.com instead of production |
| `SKIP_CLAUDE_ANALYSIS` | dev only | `true` → skip Claude, confirm signal with confidence=80 (for testing Telegram + auto-trade) |

## Architecture

### Monorepo Structure
```
repo/
  backend/          # Node.js ESM, Express 5, Prisma + PostgreSQL
  frontend/         # React 18, Vite, Tailwind CSS
  package.json      # root: orchestrates build+start for Railway
  railway.toml      # Railway deployment config
```

In production, **backend serves frontend static files** from `frontend/dist/`. No separate frontend service needed.

### Backend — Node.js ESM, Express 5, Prisma + PostgreSQL

**Signal detection pipeline (WebSocket-based, ~100ms updates):**
```
Binance @depth@100ms WS → applyDiffUpdate() → calculateObd() → processObdUpdate()
  → save ObdSnapshot (every 30s, for backtesting)
  → detectSignal() → save Signal → broadcast SIGNAL
  → [async] getKlines(1m) + getKlines(5m,15m) → calcTechnicals() + calcAtr(15m)
  → [if SKIP_CLAUDE_ANALYSIS] skip → direction=original, confidence=80
  → Claude API → validateSlTp() → getMidPrice(tradeSymbol) → update Signal.price
  → update Signal → broadcast SIGNAL_UPDATE
  → Telegram (if confidence >= minConfidence)
  → [if autoTrade] executeAutoTrade() → balance check (SHORT) → placeOrder() → save Trade
```

**Key services:**
- `services/binance/orderBookWs.js` — WebSocket @depth@100ms, full diff-depth protocol (snapshot+incremental), replaces REST polling
- `services/binance/orderbook.js` — legacy REST poller (kept for graceful shutdown), exports `buildHeatmap`
- `services/binance/websocket.js` — subscribes to kline streams, auto-reconnects
- `services/binance/rest.js` — public data via `data-api.binance.vision`, private via `api.binance.com` (or testnet); exports `createListenKey`, `keepAliveListenKey`
- `services/binance/userDataStream.js` — Binance User Data Stream WebSocket; listens for FILLED exit orders → closes Trade + resolves Signal WIN/LOSS with real PnL + Telegram
- `services/indicators/engine.js` — in-memory OBD history (120 snapshots), 15-min cooldown, OBD snapshot recording (30s), auto-trade logic; exports `detectSignalFromHistory` (pure fn for backtesting)
- `services/indicators/orderBookDepth.js` — OBD by level count (100/300/800/2000 levels); price-% approach gave identical values since all levels fall within 2.5% range
- `services/indicators/technicals.js` — RSI(14), ATR(14), volume trend, candle analysis, trend direction
- `services/claude/orchestrator.js` — fetches higher TF candles (5m/15m), validates SL/TP post-response
- `services/signals/tracker.js` — checks PENDING signals every 5s, resolves WIN/LOSS/BREAKEVEN after 1h timeout; `getEnhancedStats()` for analytics; `runBacktest()` for OBD replay
- `services/notifications/notifier.js` — Telegram outbound notifications
- `services/notifications/telegramBot.js` — Telegram bot: webhook handler, `/positions` and `/stats` commands, responds to configured channel chatId
- `ws/hub.js` — JWT-authenticated WebSocket at `/ws?token=...`

**WebSocket message types:** `OBD_UPDATE`, `KLINE`, `SIGNAL`, `SIGNAL_UPDATE`, `SIGNAL_OUTCOME`

### OBD Calculation
Uses level-count based depth (not price-percentage). Binance depth API returns levels within ~0.1-0.5% of price even with limit=5000, so percentage ranges (2.5%-25%) gave identical values. Solution: measure imbalance at fixed level counts:
- OBD1: top 100 levels (near-spread pressure)
- OBD2: top 300 levels
- OBD3: top 800 levels
- OBD4: top 2000 levels

### Signal Detection Logic (`engine.js:detectSignal`)

**LONG:** last 12 snapshots all-OBD minimums dipped > `dipThreshold` below previous 12-24 snapshot maximums, AND current values are recovering (> min + 2)

**SHORT:** last 12 snapshots all-OBD maximums spiked > `dipThreshold` above previous 12-24 snapshot minimums, AND current values are falling back (< max - 2)

### Entry Price Tracking
Signal price is recorded twice:
1. At OBD detection (`midPrice`) — saved immediately to DB
2. After Claude response (if direction ≠ WAIT) — `getMidPrice(tradeSymbol)` fetches fresh price from `bookTicker`, updates `signal.price`. Uses `tradeSymbol` (USDT pair) not `monitorSymbol` (USDC pair).

### Commission Math Validation (`orchestrator.js:validateSlTp`)

Applied after every Claude response:
- `ROUND_TRIP_FEE = 0.2%` (Binance Spot 0.1% × 2)
- If net TP after fees < 0.4% → forced `WAIT`
- If net RR < 2.0 → TP expanded to minimum that satisfies RR ≥ 2.0

Claude receives `ATR(15m)` and is instructed to use it for SL/TP sizing (not ATR(1m)).

### Auto-Trading (`engine.js:executeAutoTrade`)

Triggered after Claude confirms (direction ≠ WAIT) if `Settings.autoTrade = true`:
1. Check `confidence >= minConfidence`
2. Check open trades count < `maxOpenTrades`
3. For SHORT: check asset balance via `getAccountBalance()` — skip if insufficient
4. `quantity = autoTradeAmount / entryPrice`
5. `placeOrder()` → MARKET entry + OCO exit (if SL+TP available)
6. Save to `Trade` table with `signalId` linkage
7. Send Telegram notification about auto-trade

SHORT signals on Spot = SELL market order (sells held asset, not futures short).

### User Data Stream (`userDataStream.js`)
Connects to Binance WebSocket for real order execution events:
- Creates `listenKey` via `POST /api/v3/userDataStream`, refreshes every 20 min
- On FILLED event for LIMIT (TP) or STOP_LOSS_LIMIT (SL): closes Trade, calculates real PnL, resolves Signal outcome, sends Telegram
- Reconnects automatically on disconnect; skipped gracefully if no API keys configured

### Backtesting (`tracker.js:runBacktest`)
Uses `ObdSnapshot` table (filled every 30s) to replay signal detection:
- `detectSignalFromHistory()` — pure sync version of `detectSignal`, used for replay
- Applies configurable SL%/TP% to determine WIN/LOSS for each simulated signal
- Returns equity curve + stats
- API: `GET /api/stats/backtest?pairId=&from=&to=&threshold=&slPct=&tpPct=&direction=LONG|SHORT`

**ObdSnapshot accumulation:** snapshots are saved every 30s per symbol automatically. After 1 week ~80K rows, after 1 month ~320K rows. The more data, the more reliable the backtest. Do not delete ObdSnapshots unless storage is critically low.

**Analytics versioning:** Signal analytics split into versions due to system changes:
- `analitics_v2` — signals from 2026-04-19 onwards. Full metadata: `rsi`, `trend5m`, `trend15m`, `atr`, `atrPct`. Use this for all Signal-based analytics.
- Pre-v2 — incomplete metadata, different Claude prompt, cooldown was 90min. Don't mix with v2 in analytics.
- ObdSnapshot-based backtest has no versioning issue — detection algorithm is always re-applied to raw data.

**Backtest reports and roadmap:** `BACKTEST_REPORTS.md` in project root. Contains all historical backtest results, accumulated analytics, open hypotheses, and the backtest methodology roadmap. Update after every backtest run.

### Database Schema (Prisma/PostgreSQL)

Models: `User`, `Settings` (singleton id=1), `TradingPair`, `Signal`, `Trade`, `ObdSnapshot`

**Settings fields:** `claudePrompt`, `binanceApiKey`/`binanceSecret` (AES-256-GCM encrypted), `telegramToken`, `telegramChatId`, `dipThreshold` (default 10), `minConfidence` (default 65), `autoTrade` (default false), `autoTradeAmount` (default 10 USDT), `maxOpenTrades` (default 1)

**Signal outcome tracking:** `outcome` (WIN/LOSS/BREAKEVEN/null=PENDING), `outcomePrice`, `outcomePnl`, `outcomeAt`, `maxPrice`, `minPrice`

**Signal metadata (analitics_v2, from 2026-04-19):** `rsi` (RSI-14 on 1m), `trend5m`/`trend15m` (UP/DOWN/FLAT), `atr` (ATR-14 on 15m, absolute), `atrPct` (ATR as % of price)

**Trade fields:** `signalId` (links to Signal), `symbol`, `side`, `quantity`, `price`, `stopLoss`, `takeProfit`, `binanceOrderId`, `status`, `pnl`

**ObdSnapshot fields:** `pairId`, `obd1`-`obd4`, `midPrice`, `createdAt`. Index on `(pairId, createdAt)` for fast range queries. Do not truncate — this is the backtesting dataset.

### Frontend — React 18, Vite, Tailwind CSS, TradingView Lightweight Charts

**Routes:** `/login` → `/` (Dashboard) → `/signals` → `/stats` → `/settings`

**Dashboard data flow:**
- `useWebSocket` hook → `onWsMessage` callback → `obdRef` + `obdHistoryRef` (720 snapshots) + `klinesRef`
- `PairChart` polls `klineRef` every 1s for real-time candle updates
- `ObdCharts` polls `obdHistoryRef` every 2s for OBD line charts
- Historical candles loaded directly from `data-api.binance.vision` (public, no auth)

**Auth:** `DEV_SKIP_AUTH=true` → `/auth/refresh` returns token without credentials (no login form needed in dev)

## API Routes

```
POST   /api/auth/login|refresh|logout
GET    /api/pairs                     — active pairs only (isActive: true)
GET    /api/signals?limit=&offset=    — paginated signal history
POST   /api/trade/order               — MARKET entry + OCO exit (if SL+TP provided)
GET    /api/trade                     — trade history
GET    /api/balance                   — Binance account balance
GET    /api/klines?symbol=&interval=&limit=
GET    /api/stats
GET    /api/stats/analytics             — winrate by confidence/direction/hour
GET    /api/stats/snapshots             — ObdSnapshot counts per pair
GET    /api/stats/backtest?pairId=&from=&to=&threshold=&slPct=&tpPct=
GET    /api/settings
PUT    /api/settings/prompt|keys|telegram|threshold|confidence|autotrade
POST   /telegram/webhook               — Telegram bot webhook (no auth)
```

## Important Implementation Notes

- **Trade order flow:** `placeOrder()` always places MARKET entry first, then OCO exit if SL+TP provided. If OCO fails after entry fill → logged as warning, entry still recorded.
- **Binance URLs:** `data-api.binance.vision` for public data (no geo-block), `api.binance.com` for private (needs non-Russian IP). Railway must be in EU region to avoid 451.
- **Testnet:** Set `BINANCE_TESTNET=true` to use `testnet.binance.vision`. Get test keys at `testnet.binance.vision`.
- **monitorSymbol vs tradeSymbol:** USDC pairs for OBD monitoring, USDT pairs for actual orders and price fetching.
- **SHORT on Spot:** Places a SELL market order (sells held asset), not a futures short.
- **Telegram notifications:** Sent only after Claude confirms (direction ≠ WAIT) AND `confidence >= minConfidence`. Token and Chat ID are masked in API responses.
- **OBD level-count based:** switched from price-% to fixed level counts (100/300/800/2000). Old price-% approach gave identical values for all 4 indicators because all depth levels fall within 2.5% range for BTC/ETH.
- **ObdSnapshot table:** grows ~23K rows/day (4 pairs × 30s interval). Do NOT truncate — it's the backtesting dataset. After 90 days ~2M rows, manageable with the `(pairId, createdAt)` index.
- **Express 5:** Wildcard routes use `app.use()` not `app.get('*')` — Express 5 dropped the `*` syntax.
- **bcryptjs:** Uses pure-JS bcryptjs (not bcrypt) to avoid native build deps and tar vulnerability.

## Trading Pairs (default)

| Monitor (OBD) | Trade |
|---|---|
| BTCUSDC | BTCUSDT |
| ETHUSDC | ETHUSDT |
| SOLUSDC | SOLUSDT |
| BNBUSDC | BNBUSDT |

## Claude Prompt Architecture

Two separate Claude prompts, both stored in `Settings` DB and editable via UI:

- **OBD prompt** (`Settings.claudePrompt`) — mean-reversion signal filter. Loaded via `getSystemPrompt()`. Hash-synced on deploy: if `DEFAULT_PROMPT` in `prompts.js` ≠ `Settings.promptHash`, DB is auto-updated.
- **OFI prompt** (`Settings.ofiClaudePrompt`) — momentum signal filter. Loaded via `getOfiSystemPrompt()`. Hash-synced via `ofiPromptHash`.

**OBD prompt scoring logic (as of 2026-04-19):**
- Base confidence: 65
- RSI LONG: `<30 +10 | 30–45 +5 | 45–65 0 | >65 −5` (mean-reversion — RSI extremes are good)
- RSI SHORT: `>70 +10 | 55–70 +5 | 35–55 0 | <35 −5`
- No trend scoring — OBD is mean-reversion, trend alignment bonus was conceptually wrong
- TP = 3×ATR (not 2×, to pass `validateSlTp` RR≥2 check after fees)
- WAIT if confidence < 65 after scoring

**OFI prompt scoring:** keeps trend scoring (momentum signal, different nature). RSI exhaustion penalties at extremes (<20 for LONG, >80 for SHORT).

**SL/TP validation (`orchestrator.js:validateSlTp`):** runs after every Claude response. Catches inverted levels (SL/TP wrong direction) → ATR fallback (1.5×ATR SL, 3.5×ATR TP). Forces WAIT if net TP < 0.4% after fees. Expands TP if net RR < 2.0.

## Skills (Claude Code slash commands)

Custom skills stored in `~/.claude/commands/`:

- **`/backtest`** (`~/.claude/commands/backtest.md`) — backtest analyst role. Three modes: planning, results analysis, methodology improvement. Contains full backtest roadmap with 🔴/🟡/🟢 priority items, data collection improvement list, and interpretation guidelines (winrate thresholds, equity curve patterns).

- **`/discuss`** (`~/.claude/commands/discuss.md`) — trading idea review with two personas: "Коллега" (20 years, skeptic, anti-overfitting) and "Босс" (40 years, finds what everyone missed). Use for any proposed algorithm change before implementing. Follows format: Я → Коллега → Я → Босс.

## ROADMAP Status

| Priority | Task | Status |
|---|---|---|
| 1 | Улучшить промпт Claude | ✅ |
| 2 | Фильтр сигналов по confidence | ✅ |
| 3 | Multi-timeframe контекст | ✅ |
| 4 | Корректная цена входа | ✅ |
| 5 | SHORT сигналы | ✅ |
| 6 | Бэктестинг на реальных данных | 🔄 В процессе — см. BACKTEST_REPORTS.md |
| 7 | Автоторговля | ✅ |
| 8 | Walk-forward validation | Ожидает >200 сигналов |
| 9 | Slippage модель в бэктесте | Не начато |
| 10 | Monte Carlo симуляция | Не начато |
