# BUG-40/41 — Dead Protection Everywhere — TL Verdict

## Вердикт: ✅ APPROVE

Прод-фикс зомби-протекции готов к деплою. Согласен с QA — 3 контура (reconcile, fix-protection, UI badges) теперь синхронно ловят dead SL / hit TP вне зависимости от age и placed-state.

## Согласие с QA

Согласен. QA-отчёт чистый, 1 минорное наблюдение (`getMidPrice` теперь зовётся для всех OPEN trades каждые 60с) — не блокер.

**Архитектурная оценка нагрузки:**
- Bybit `/v5/market/tickers` public — без auth, бесплатно, без rate-limit штрафов
- Latency 50-150ms × N трейдов; для 5 трейдов = 250-750ms на reconcile цикл
- Цикл 60с — запас огромный, допустимо

## Правки от TL

Ничего не правил. Код Dev + проверка QA достаточны.

## Пост-деплой мониторинг (3 пункта)

1. **+60с после деплоя** — должны увидеть emergency-close для SOL / ETH / BTC: 3 Telegram alerts с reason `SL trigger ... already crossed` или `TP target ... already hit`. Если за 2 цикла (120с) тишина — проверить логи `[TpSlReconciliation]` и `getMidPrice` health.
2. **UI Bot Trades** — для активных трейдов где текущая цена за SL/TP бейдж теперь `SL ⚠ DEAD` / `TP ⚠ HIT` (вместо ложного `SL ✓` / `TP ✓`); кнопка `Fix` появляется и market-close-ит. Проверить вручную на странице после деплоя.
3. **Reconcile latency** — на 5+ одновременных OPEN трейдах суммарное время reconcile цикла должно остаться <2с. Метрика: время между `[TpSlReconciliation] start` и `end` в логах. При >5с — задействовать BUG-42 (батчинг).

## Backlog

**BUG-42** (опционально, не срочно): батчевый `getMidPrice` через `/v5/market/tickers` без `symbol` параметра — один call возвращает все символы. Снизит N round-trips до 1 на цикл reconcile. Делать если latency на проде станет проблемой при большом числе одновременных трейдов.
