---
name: Backlog snapshot
description: Открытые баги и KISS-нарушения на 2026-04-18, статус каждого
type: project
---

Актуальный беклог в `BACKLOG.md` в корне репо. Здесь — краткий статус.

**Why:** Беклог ведётся для отслеживания известных проблем между сессиями.
**How to apply:** Перед началом работы проверять BACKLOG.md, закрытые помечать ✅ FIXED.

### Открытые баги (высокий → низкий приоритет)
- **BUG-00** — WAIT-сигналы вечно PENDING в БД (tracker не подбирает, т.к. suggestedSl=null). Косметика.
- **BUG-01** — "Remember me" на логине декоративный (нет state, нет логики)
- **BUG-02** — "Change password" кнопка без onClick
- **BUG-03** — "Emergency stop" кнопка без onClick
- **BUG-04** — "Test prompt" кнопка без onClick
- **BUG-05** — "Send test" Telegram пустой onClick
- **BUG-06** — Username в Account нельзя сохранить (uncontrolled input)
- **BUG-07** — Email в Account нельзя сохранить (нет поля в модели User)
- **BUG-08** — Нет кнопки Save в секции Account

### Исправленные (в этой сессии)
- ~~BUG-09~~ ✅ Float drift OFI sliding window
- ~~BUG-10~~ ✅ ofiRatio не сохранялся в БД

### KISS-нарушения (открытые)
- KISS-01: detectSignal/detectSignalFromHistory 95% одинаковый код
- KISS-02: wsManager: init/switch паттерн повторяется 3 раза
- KISS-03: exchange/index.js: 5 функций с if/else bybit/binance
- KISS-04: calcSlTp дублируется в Dashboard и SignalModal
- KISS-05: saveBybitKeys повторяет testConnection (Settings.jsx)
- KISS-06: нормализация сигналов на фронте вместо бэкенда
- KISS-07: три одинаковых useEffect в Stats
- KISS-08: PnL-формула дублируется в tracker.js
- KISS-09: hashPrompt() вызывается один раз
- KISS-10: SettingRow паттерн повторяется 4+ раза
- KISS-11: calculateDelta дублируется в Dashboard
- KISS-12: нормализация kline в двух местах Dashboard
- KISS-13: Toggle — компонент из одной строки
- KISS-14: возможный мёртвый импорт в balance.js
- KISS-15: analyzeOfiWithClaude дублирует analyzeWithClaude
