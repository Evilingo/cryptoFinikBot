---
name: Eval methodology
description: Как делать prompt evals (тесты для LLM-выходов) для BestTrader. Включает: запуск, scoring, добавление кейсов, интерпретация.
type: project
last_updated: 2026-05-01
---

# Prompt Eval Methodology

Систематическое тестирование промптов и моделей. Как unit-тесты, но с допуском нестабильности LLM.

## Когда применять

Делать **eval-прогон** перед:
- Сменой модели (Sonnet ↔ Haiku ↔ Opus)
- Изменением промптов (`prompts.js`)
- Изменением `validateSlTp` thresholds (MIN_NET_TP_PCT, MIN_NET_RR)
- Сжатием/расширением input (cost-step 4 etc.)
- Любыми изменениями `analyzeSignal` / `analyzeOfiSignal` / `runClaudePipeline`

**Не делать** для:
- Багфиксов в постобработке (`validateSlTp` не меняет, `placeTpSl` не меняет, etc.)
- UI-изменений
- Backend-инфры (БД, WS, Express)

## Архитектура eval-инструмента

`backend/scripts/eval-prompt.js` — Node-скрипт:
1. Загружает test cases из JSON
2. Каждый кейс прогоняется через каждую модель (--models=)
3. Парсит ответ (с защитой от markdown-обёрток ```json)
4. Скорит на основе `expected` критериев
5. Считает агрегаты (JSON-valid rate, score, latency, cost)
6. Генерирует markdown-отчёт + сохраняет его в `eval-report-<ts>.md`

`backend/scripts/eval-cases.json` — массив hand-crafted test cases.

## Запуск

```bash
cd backend
ANTHROPIC_API_KEY="sk-ant-real-key" node scripts/eval-prompt.js

# или с фильтром моделей:
node scripts/eval-prompt.js --models=claude-haiku-4-5

# или с другим набором кейсов:
node scripts/eval-prompt.js --cases=./scripts/my-cases.json
```

**Где взять API ключ:**
- Локально: добавить в `backend/.env` (`ANTHROPIC_API_KEY=sk-ant-...`)
- На Railway: уже есть в env vars; запускать через `railway run node scripts/eval-prompt.js`

**Стоимость:** ~$0.10 за прогон 10 кейсов × 2 модели (~20 API calls). Sonnet дороже Haiku в ~12x.

## Структура test case

```json
{
  "id": "case-NN-symbol-strategy-short-description",
  "strategy": "OBD" | "OFI",
  "context": "Описание сценария — что тестируем и почему",
  "input": {
    "pair": { "monitorSymbol": "BTCUSDT", "tradeSymbol": "BTCUSDT", "timeframe": "1m" },
    "currentPrice": 78000.0,
    "obd": { "obd1": ..., "obd2": ..., "obd3": ..., "obd4": ... },        // OBD only
    "ofiDirection": "LONG" | "SHORT", "ofiRatio": 0-100,                  // OFI only
    "trend5m": { "direction": "UP" | "DOWN" | "FLAT", "changePct": ... },
    "trend15m": { "direction": "...", "changePct": ... },
    "atr15m": { "value": ..., "pct": ... },
    "tech": {
      "rsi": 0-100,
      "atr": { "value": ..., "pct": ... },
      "volumeTrend": { "direction": "RISING" | "FALLING" | "FLAT", "changePct": ... },
      "recentCandles": [
        { "type": "bullish" | "bearish" | "doji", "bodyPct": 0-100, "close": ... }
      ]
    }
  },
  "expected": {
    "direction": "LONG" | "SHORT" | "WAIT",
    "minConfidence": 0-100,
    "maxConfidence": 0-100
  }
}
```

## Scoring rules (eval-prompt.js)

Каждый кейс получает score 0-100:
- **−50** если direction не совпадает с expected
- **−20** если confidence outside [min, max]
- **−15** если LONG SL >= price (логически некорректно)
- **−15** если LONG TP <= price (логически некорректно)
- **−15** для SHORT — зеркально

Также **−100** (полный фейл) если:
- Запрос упал (network error, rate limit)
- JSON не распарсился

## Aggregate metrics

| Metric | Что меряет | Целевое |
|---|---|---|
| `jsonValidRate` | % ответов которые распарсились | ≥95% |
| `parseFailures` | Кол-во failed JSON | ≤1 на 20 |
| `apiErrors` | Кол-во network/rate-limit errors | 0 |
| `avgScore` | Средний score по всем кейсам | ≥70 |
| `directionAccuracy` | % правильных direction | ≥80% |
| `avgLatencyMs` | Среднее время ответа | <3000 |
| `totalCost` | Стоимость прогона | $0.05-0.20 |

## Verdict logic (auto в отчёте)

- **scoreDelta < −10** между моделями → ⚠️ revert не рекомендуется
- **parseFailures > 1 у Haiku** → ⚠️ investigate response format
- Иначе → ✅ модель safe для прода

## Как добавить новый кейс

1. Открой `backend/scripts/eval-cases.json`
2. Добавь объект в массив (см. шаблон выше)
3. **Источники для кейсов:**
   - Реальные сигналы из логов (`grep "Signal detected" + "Calling Claude"` в Railway)
   - БД (`SELECT * FROM "Signal" ORDER BY id DESC LIMIT 10` — все нужные поля есть)
   - Скриншоты из UI (`/signals` страница) — менее точно, но достаточно для smoke-test
4. Подбирай `expected` так чтобы был **clear-cut** случай (не "может быть LONG, может WAIT")
5. Покрой разные сценарии: clean LONG, clean SHORT, RSI-extreme WAIT, FLAT-market WAIT, конфликт TF, etc.

**Минимум для useful eval:** 8-10 кейсов с разными strategies (OBD + OFI) и разными expected outcomes.

## Как читать отчёт

Отчёт: `backend/scripts/eval-report-<timestamp>.md`. Структура:
1. **Summary** — таблица метрик per-model
2. **Per-case comparison** — каждый кейс, как ответили модели, score, issues
3. **JSON parse failures** — raw response snippets если что-то упало
4. **Verdict** — авто-рекомендация

**Что искать в первую очередь:**
- `parseFailures > 0` → есть проблема с JSON форматом → смотри snippet, возможно нужен tool-use API
- `directionAccuracy < 70%` → модель плохо угадывает направление → пересмотри промпт
- `avgScore` сильно отличается между моделями → возможно overfit под одну
- `avgLatencyMs` > 3s → может быть rate-limit, retry усложняет UX

## Известные ограничения

1. **Hand-crafted cases ≠ реальный поток.** Они показывают "способна ли модель применить правила" — не "хорошо ли торгует на реальных данных". Real backtest нужен отдельно через `runBacktest()` в `signals/tracker.js`.
2. **Нет ground truth для confidence.** Мы задаём `[min-max]` диапазон, но что "правильно" — субъективно.
3. **JSON-схема не enforced.** Полагаемся что Claude следует формату из промпта. Использование Anthropic tools API было бы надёжнее.
4. **20 свечей JSON опущено** в эвале (для KISS). Может слегка повлиять на ответы Claude если он внимательно их читал.

## Roadmap для эволюции eval

- [ ] **Auto-import from DB:** если есть DATABASE_URL — брать последние N сигналов с outcome != null, ground truth = `outcome` (WIN/LOSS)
- [ ] **Confidence calibration plot:** scatter conf vs winrate
- [ ] **A/B prompts:** прогон одной модели на двух разных prompts.js версиях
- [ ] **Tool-use enforcement:** заменить free-text JSON на Anthropic structured output (zero parse failures)
- [ ] **CI integration:** запускать eval в GitHub Actions при изменении prompts.js или orchestrator.js
- [ ] **Latency budget alert:** если avg > 5s — alert в pipeline
- [ ] **Cost budget guard:** не прогонять если ожидаемая стоимость > $X

## Best practices

1. **Запускай минимум за день до прод-смены.** Одного прогона мало — проверь дважды на разных датах.
2. **Сохраняй все отчёты в `backend/scripts/eval-report-*.md`** — gitignored, но локально полезно для истории.
3. **При смене prompts.js** — сначала eval, потом прод-deploy. Никогда наоборот.
4. **Если новая модель появляется** — добавь в `PRICING` map в `eval-prompt.js`, прогоняй на текущем cases set.
5. **Cases должны эволюционировать** — каждый раз когда видишь странный сигнал в проде, добавляй его в кейсы (и фиксируй expected).
