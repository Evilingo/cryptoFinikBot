---
name: Project state
description: Текущее состояние проекта BestTrader — что реализовано, архитектура, ключевые файлы
type: project
---

**Проект:** BestTrader (Finik) — крипто-споте торговый бот. Monorepo: backend (Node.js ESM, Express 5, Prisma/PostgreSQL), frontend (React 18, Vite, Tailwind). Деплой на Railway.

**Последний пуш:** 2026-04-18, коммит f04703d.

**Что реализовано (актуально на 2026-04-18):**

### Стратегии детекции сигналов
1. **OBD (Order Book Depth)** — всегда активна. Следит за стаканом, сигнал когда все 4 уровня синхронно двигаются. `engine.js`, `orderBookWs.js`.
2. **OFI (Order Flow Imbalance)** — новая, по умолчанию выключена (`ofiEnabled=false` в Settings). Подключается к aggTrade WS, 60-секундное скользящее окно, LONG если >65% объёма — покупки, SHORT если <35%. `ofiEngine.js`, `binance/aggTradeWs.js`, `bybit/aggTradeWs.js`. Включается тоглом в Settings → Trading rules.

### Пайплайн сигнала (одинаков для OBD и OFI)
OBD/OFI детекция → save Signal (strategy: 'OBD'|'OFI') → broadcast SIGNAL → Claude анализ (отдельные промпты!) → update Signal → broadcast SIGNAL_UPDATE → Telegram → executeAutoTrade

### Промпты Claude
- OBD-сигнал → `getSystemPrompt()` → `claudePrompt` из Settings (DEFAULT_PROMPT)
- OFI-сигнал → `getOfiSystemPrompt()` → `ofiClaudePrompt` из Settings (DEFAULT_OFI_PROMPT)
- Оба промпта редактируются в Settings → Claude (два отдельных textarea)
- Оба автосинкаются из кода при деплое если hash изменился

### Schema (актуальная)
Signal: id, pairId, direction, confidence, **strategy** (OBD|OFI, default OBD), **ofiRatio** Float?, obd1-4 Float? (nullable — null для OFI), price, claudeAnalysis, suggestedSl, suggestedTp, outcome, outcomePrice, outcomePnl, outcomeAt, maxPrice, minPrice, createdAt
Settings: + **ofiEnabled** Boolean, **ofiClaudePrompt** Text, **ofiPromptHash** String

### API маршруты (новые)
- `PUT /api/settings/ofi` — включить/выключить OFI
- `PUT /api/settings/ofi-prompt` — сохранить OFI промпт

### UI
- Signals таблица: колонка Strategy — OBD badge + мини-бар-чарт (4 цветных бара), OFI badge + ratio%
- Outcome: WAIT-сигналы → "NO TRADE" (серый), активные LONG/SHORT → "OPEN"
- Settings → Trading rules: блок "Signal strategies" с тоглами OBD (всегда вкл) и OFI
- Settings → Claude: два блока — OBD prompt и OFI prompt с отдельными Save

### Исправленные баги (в этой сессии)
- BUG-09: float drift в OFI sliding window — заменён reduce вместо +=/-=
- BUG-10: ofiRatio не сохранялся в БД — добавлен в Signal schema и create
- Telegram HTML parse error — escapeHtml() для claudeAnalysis перед отправкой
- ui-coverage.js переписан на 39 поведенческих тестов (8 failing = реальные баги)

**Why:** OFI добавлена как параллельная стратегия для сравнения с OBD. OBD = намерение (стакан), OFI = факт (исполненные сделки). Стратегии независимы, каждая генерирует свои сигналы.
**How to apply:** При работе с сигналами учитывать поле strategy. При работе с промптами — два отдельных промпта, не смешивать.
