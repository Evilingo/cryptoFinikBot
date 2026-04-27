# Cost optimization step 3 — switch Sonnet → Haiku

**Цель:** оставшиеся ~30% Claude-вызовов после pre-filter перевести с Sonnet 4.5 на Haiku 4.5.

## Эффект

- Sonnet input/output: $3 / $15 за 1M токенов
- Haiku input/output: $0.25 / $1.25 за 1M токенов
- **12× дешевле на каждый вызов**

После pre-filter: ~$0.50/день → **~$0.04/день**.

## Файл

`backend/src/services/claude/orchestrator.js`, функция `callClaude` строка ~16.

## Изменение

**До:**
```js
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});
```

**После:**
```js
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});
```

Одна строка. Без рефакторинга, без feature flag, без env-переменных. KISS.

## Почему Haiku справится

Промпт ([prompts.js](backend/src/services/claude/prompts.js)) — это таблица детерминированных правил (RSI бэндов, candle patterns, OFI thresholds, ATR%) которые надо применить и вернуть JSON. Haiku оптимизирован под классификацию и структурированный ответ — ровно наш use-case. Sonnet — overkill для арифметики по таблице.

## Риски и митигация

**Риск:** Haiku хуже качество на edge cases.
- **Митигация:** один git revert (1 строка) если увидим деградацию.

**Риск:** JSON parsing — Haiku может вернуть лишний текст вокруг JSON.
- **Митигация:** существующий regex extract `text.match(/\{[\s\S]*\}/)` уже это переживает.

**Риск:** confidence numbers могут смещаться (Haiku может быть более/менее conservative).
- **Митигация:** наблюдение за winrate/conf-распределением в БД — уже есть мониторинг.

## Проверка после деплоя

В Railway logs появятся вызовы Claude по-прежнему, разница только в цене:
- `Calling Claude for OFI signal analysis` — те же логи
- Anthropic billing — должна резко упасть

## Файлы

- `backend/src/services/claude/orchestrator.js` — одна строка

## Отчёт Dev

В `queue/qa/cost-haiku-swap_dev.md`:
- Одно предложение что сделал
- Snippet до/после
- Sanity:
  1. Имя модели правильное (`claude-haiku-4-5`)
  2. Остальные параметры (max_tokens, system, messages) не тронуты
  3. retry-логика, JSON parsing, validateSlTp — не трогали
