# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BestTrader is a Binance Spot trading signal platform. It monitors order book depth (OBD) indicators across trading pairs, detects LONG/SHORT signals when all 4 OBD indicators move synchronously, then uses Claude AI to confirm/analyze the signal and suggest SL/TP levels. Results are tracked automatically.

## Commands

### Infrastructure (run first)
```bash
cd /path/to/besttrader
docker compose up -d        # PostgreSQL + Redis
```

### Backend
```bash
cd backend
cp .env.example .env        # fill required vars (see Environment Variables)
npm install
npm run db:generate         # generate Prisma client
npm run db:push             # push schema to DB (dev, no migration files)
npm run db:migrate          # create migration files (prod)
npm run dev                 # start with --watch (hot reload)
npm start                   # production
```

### Frontend
```bash
cd frontend
npm install
npm run dev                 # Vite dev server on :5173
npm run build
```

## Environment Variables (backend/.env)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `JWT_SECRET` | ✓ | 64 hex chars |
| `JWT_REFRESH_SECRET` | ✓ | 64 hex chars |
| `ENCRYPTION_KEY` | ✓ | 64 hex chars (AES-256 for Binance keys) |
| `ADMIN_USERNAME` | ✓ | Auto-created on first start |
| `ADMIN_PASSWORD` | ✓ | Auto-created on first start |
| `ANTHROPIC_API_KEY` | optional | If absent — Claude analysis is skipped, signals still saved |
| `TELEGRAM_TOKEN` | optional | Synced to DB Settings on startup |
| `TELEGRAM_CHAT_ID` | optional | Synced to DB Settings on startup |
| `REDIS_URL` | optional | Not currently used (bullmq removed) |
| `DEV_SKIP_AUTH` | dev only | `true` → /auth/refresh returns token without credentials |

## Architecture

### Backend — Node.js ESM, Express 5, Prisma + PostgreSQL

**Signal detection pipeline (runs every 5 seconds):**
```
Binance REST (order book) → calculateObd() → processObdUpdate()
  → detectSignal() → save Signal → broadcast SIGNAL
  → [async] getKlines(1m) + getKlines(5m,15m) → calcTechnicals() + calcAtr(15m)
  → Claude API → validateSlTp() → update Signal → broadcast SIGNAL_UPDATE
  → Telegram (if confidence >= minConfidence)
```

**Key services:**
- `services/binance/orderbook.js` — polls every 5s, exponential backoff on 418 (IP ban)
- `services/binance/websocket.js` — subscribes to kline streams, auto-reconnects
- `services/indicators/engine.js` — in-memory OBD history (120 snapshots), 15-min cooldown per symbol
- `services/indicators/technicals.js` — RSI(14), ATR(14), volume trend, candle analysis, trend direction
- `services/claude/orchestrator.js` — fetches higher TF candles (5m/15m), validates SL/TP post-response
- `services/signals/tracker.js` — checks PENDING signals every 5s, resolves WIN/LOSS/BREAKEVEN after 1h timeout
- `ws/hub.js` — JWT-authenticated WebSocket at `/ws?token=...`

**WebSocket message types:** `OBD_UPDATE`, `KLINE`, `SIGNAL`, `SIGNAL_UPDATE`, `SIGNAL_OUTCOME`

### Signal Detection Logic (`engine.js:detectSignal`)

**LONG:** last 12 snapshots all-OBD minimums dipped > `dipThreshold` below previous 12-24 snapshot maximums, AND current values are recovering (> min + 2)

**SHORT:** last 12 snapshots all-OBD maximums spiked > `dipThreshold` above previous 12-24 snapshot minimums, AND current values are falling back (< max - 2)

### Commission Math Validation (`orchestrator.js:validateSlTp`)

Applied after every Claude response:
- `ROUND_TRIP_FEE = 0.2%` (Binance Spot 0.1% × 2)
- If net TP after fees < 0.4% → forced `WAIT`
- If net RR < 2.0 → TP expanded to minimum that satisfies RR ≥ 2.0

Claude receives `ATR(15m)` and is instructed to use it for SL/TP sizing (not ATR(1m)).

### Database Schema (Prisma/PostgreSQL)

Models: `User`, `Settings` (singleton id=1), `TradingPair`, `Signal`, `Trade`

**Settings fields:** `claudePrompt`, `binanceApiKey`/`binanceSecret` (AES-256-GCM encrypted), `telegramToken`, `telegramChatId`, `dipThreshold` (default 10), `minConfidence` (default 65)

**Signal outcome tracking:** `outcome` (WIN/LOSS/BREAKEVEN/null=PENDING), `outcomePrice`, `outcomePnl`, `outcomeAt`, `maxPrice`, `minPrice`

### Frontend — React 18, Vite, Tailwind CSS, TradingView Lightweight Charts

**Routes:** `/login` → `/` (Dashboard) → `/signals` → `/stats` → `/settings`

**Dashboard data flow:**
- `useWebSocket` hook → `onWsMessage` callback → `obdRef` (current OBD) + `obdHistoryRef` (720 snapshots) + `klinesRef`
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
GET    /api/settings
PUT    /api/settings/prompt|keys|telegram|threshold|confidence
```

## Important Implementation Notes

- **Trade order flow:** `placeOrder()` always places MARKET entry first, then OCO exit if SL+TP provided. If OCO fails after entry fill → logged as warning, entry still recorded.
- **Binance URLs:** `data-api.binance.vision` for public data (no geo-block), `api.binance.com` for private (needs non-Russian IP).
- **monitorSymbol vs tradeSymbol:** USDC pairs for OBD monitoring, USDT pairs for actual orders.
- **SHORT on Spot:** Places a SELL market order (sells held asset), not a futures short. For true shorting, Futures API (`fapi.binance.com`) would be needed.
- **Telegram notifications:** Sent only after Claude confirms (direction ≠ WAIT) AND `confidence >= minConfidence` (configurable in Settings).
- **OBD systematic bias:** The asymmetric bid/ask depth ranges (e.g. bid 2.5% / ask 5%) cause OBD to read below 50 even in neutral markets. The "neutral" level is practically ~35-40, not 50.

## Trading Pairs (default)

| Monitor (OBD) | Trade |
|---|---|
| BTCUSDC | BTCUSDT |
| ETHUSDC | ETHUSDT |
| SOLUSDC | SOLUSDT |
| BNBUSDC | BNBUSDT |

## ROADMAP Status

See `ROADMAP.md` for full details. Completed: Priority 1 (Claude prompt), 2 (confidence filter), 3 (multi-timeframe), 5 (SHORT signals). Remaining: Priority 4 (correct entry price tracking), 6 (Redis/BullMQ decision), 7 (auto-trading).
