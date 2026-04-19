---
name: OFI implementation details
description: Детали реализации OFI стратегии — файлы, параметры, архитектурные решения
type: project
---

**Реализована:** 2026-04-18.

### Параметры (ofiEngine.js)
- OFI_WINDOW: 60 сек
- MIN_TRADES: 15 сделок в окне
- LONG_THRESHOLD: 0.65 (>65% buy = LONG)
- SHORT_THRESHOLD: 0.35 (<35% buy = SHORT)
- SIGNAL_COOLDOWN: 90 мин (независимый Map от OBD)
- ofiEnabled кешируется 60 сек (TTL cache, как getDipThreshold в engine.js)

### Sliding window — важно
buyVol/sellVol НЕ хранятся инкрементально — пересчитываются через reduce() на каждом чеке. Так устранён float drift от IEEE 754 накопления ошибок при +=/-=.

### Файлы
- `backend/src/services/indicators/ofiEngine.js` — ядро: processAggTrade, analyzeOfiWithClaude
- `backend/src/services/binance/aggTradeWs.js` — Binance `<symbol>@aggTrade` WS
- `backend/src/services/bybit/aggTradeWs.js` — Bybit `publicTrade.<symbol>` WS
- `backend/src/services/claude/orchestrator.js` — analyzeOfiSignal (использует getOfiSystemPrompt)
- `backend/src/services/exchange/wsManager.js` — startAggTradeWs/stopAggTradeWs вызываются рядом с orderBookWs

### aggTrade семантика
- Binance: `d.m` (isBuyerMaker) = true → продавец агрессор (SELL volume), false → покупатель агрессор (BUY volume)
- Bybit: `trade.S === 'Sell'` → isBuyerMaker=true (продавец агрессор), `'Buy'` → isBuyerMaker=false

### executeAutoTrade
Экспортирован из engine.js (был private). OFI переиспользует ту же функцию.

### Открытые задачи по OFI
- KISS-15: analyzeOfiWithClaude дублирует analyzeWithClaude из engine.js — в беклоге
- aggTradeWs стартует даже когда ofiEnabled=false (просто early-exit в processAggTrade) — допустимо
