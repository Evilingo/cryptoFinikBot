# Dev report — cost-trade-state-prefilter

Добавил module-scope helper `shouldSkipClaude` в `engine.js` + общий `applyPreFilterSkip` (DB update + broadcast + log) и вставил пре-фильтр перед `runClaudePipeline` в обоих путях (OBD `analyzeWithClaude` + OFI `analyzeOfiWithClaude`).

## `shouldSkipClaude` helper (engine.js:49-71)

```js
export async function shouldSkipClaude(pair, signalDirection) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.autoTrade) return { skip: false, reason: '' };

  const existing = await prisma.trade.findFirst({
    where: { status: { in: ['OPEN', 'PENDING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!existing) return { skip: false, reason: '' };

  const openCount = await prisma.trade.count({ where: { status: { in: ['OPEN', 'PENDING'] } } });
  if (openCount < (settings.maxOpenTrades ?? 1)) return { skip: false, reason: '' };

  if (existing.symbol !== pair.tradeSymbol) {
    return { skip: true, reason: `Already ${existing.side} on ${existing.symbol}, maxOpenTrades reached` };
  }
  const sameDirection = (existing.side === 'BUY' && signalDirection === 'LONG') ||
                        (existing.side === 'SELL' && signalDirection === 'SHORT');
  if (sameDirection) {
    return { skip: true, reason: `Already ${existing.side} on ${pair.tradeSymbol}, same direction (${signalDirection})` };
  }
  return { skip: false, reason: '' };
}
```

## Места вставки

- **OBD путь:** `backend/src/services/indicators/engine.js:190-197` — внутри `analyzeWithClaude`, ДО `runClaudePipeline`.
- **OFI путь:** `backend/src/services/indicators/ofiEngine.js:124-131` — внутри `analyzeOfiWithClaude`, ДО `runClaudePipeline`. Импорт: `import { executeAutoTrade, shouldSkipClaude, applyPreFilterSkip } from './engine.js'`.

## Pre-filter блок (одинаков в обоих путях)

До:
```js
async function analyzeWithClaude(signalId, pair, obd, midPrice, signalDirection) {
  await runClaudePipeline(signalId, pair, midPrice, { ... });
}
```

После:
```js
async function analyzeWithClaude(signalId, pair, obd, midPrice, signalDirection) {
  const pre = await shouldSkipClaude(pair, signalDirection);
  if (pre.skip) {
    await applyPreFilterSkip(signalId, pair, midPrice, signalDirection, pre.reason, {
      obd1: obd.obd1, obd2: obd.obd2, obd3: obd.obd3, obd4: obd.obd4,
    });
    return;
  }
  await runClaudePipeline(signalId, pair, midPrice, { ... });
}
```

`applyPreFilterSkip` (engine.js:73-104): `Signal.update({direction:'WAIT', confidence:0, claudeAnalysis:'[Pre-filter] ${reason}', outcome:'WAIT'})` → `broadcast({type:'SIGNAL_UPDATE', signal:{...minimum полей + broadcastExtra}})` → `logger.info(...)`. `executeAutoTrade` НЕ вызывается (early return до `runClaudePipeline`, который сам триггерит auto-trade).

## Sanity

1. **Pre-filter ПОСЛЕ `Signal.create`, ДО `callClaude`/`runClaudePipeline`** — `processObdUpdate` создаёт Signal на :143-159 и шлёт `SIGNAL` broadcast :180; `analyzeWithClaude` запускается background-ом :185; внутри него pre-filter (:191) выполняется ДО `runClaudePipeline` (:200). Аналогично для OFI: `processAggTrade` создаёт Signal :84, broadcast :100, `analyzeOfiWithClaude` :119; pre-filter :125 ДО `runClaudePipeline` :133.
2. **autoTrade=false → пропускаем pre-filter** — `if (!settings?.autoTrade) return { skip: false }` на первой строке `shouldSkipClaude`. Claude вызывается как обычно, analytics в Signals UI сохраняется.
3. **Same-symbol opposite-direction → НЕ пре-фильтруем** — `sameDirection` проверяет `(BUY+LONG)` или `(SELL+SHORT)`; если existing=BUY и signal=SHORT (или existing=SELL и signal=LONG) — `sameDirection=false`, return `{skip:false}`, Claude вызывается (нужен для reverse-close decision).
4. **Updated Signal в БД при skip + broadcast SIGNAL_UPDATE** — `applyPreFilterSkip` делает `prisma.signal.update` с `direction:'WAIT', confidence:0, claudeAnalysis:'[Pre-filter] ...', outcome:'WAIT'`, затем `broadcast({type:'SIGNAL_UPDATE', signal:{id, monitorSymbol, tradeSymbol, direction:'WAIT', confidence:0, claudeAnalysis, suggestedSl:null, suggestedTp:null, price:midPrice, ...broadcastExtra}})`.
5. **`executeAutoTrade` НЕ вызывается при skip** — `analyzeWithClaude`/`analyzeOfiWithClaude` делает `return` сразу после `applyPreFilterSkip`, до вызова `runClaudePipeline` (который и есть единственный путь к `executeAutoTrade`). Telegram-уведомление тоже не уходит (оно тоже внутри `runClaudePipeline`).

## Не трогал

- `prompts.js`, `validateSlTp`, `callClaude`, retry-logic
- Существующий market-condition pre-filter в `orchestrator.js` (`obviousWaitForOfi/obviousWaitForObd`) — он выполняется ВНУТРИ Claude-pipeline и остаётся как есть (срабатывает только если новый trade-state pre-filter пропустил вызов).
