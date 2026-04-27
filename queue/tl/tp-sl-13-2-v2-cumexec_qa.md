# QA Report — TP/SL-13.2-v2 (cumExecQty polling)

## Вердикт: чисто (с двумя MINOR заметками — на усмотрение TL).

Основная логика корректна:
- Старый блок `getAccountBalance + Math.min(free, qty)` удалён в обоих файлах (rest.js:441-462, engine.js:317-327 заменены).
- Polling корректен: parseFloat guard от undefined/null/empty, `cumExecQty > 0` фильтрует пустые ответы, `floored > 0` guard от деградации.
- Phase 1 в engine.js: условие входа `if (!confirmedPrice || !confirmedFilledQty)` + break при `confirmedPrice && confirmedFilledQty > 0` — корректно.
- Phase 2 fallback: если cumExecQty=0 → `tpSlQty = confirmedQty` (gross). OK.
- SELL не затронут: gross cumExecQty в rest.js (fee в quote), в engine.js Phase 2 BUY-only branch — `tpSlQty = confirmedQty`.
- Регрессии: Market без SL/TP, Limit+SL/TP — старые ветки нетронуты.
- `getAccountBalance` импорт в engine.js:6 НЕ мёртвый — используется на строке 203 (SHORT pre-entry balance check, task 13.6).

## Заметки (MINOR — не блокеры)

```
[MINOR] Polling loop при orderId=undefined тратит 2с впустую — backend/src/services/bybit/rest.js:444-466
Причина: если `data.result?.orderId` отсутствует (странный ответ privatePost / частичный fail), цикл всё равно делает 4×500мс запросов с `orderId: undefined`. Bybit вернёт пустой list или ошибку — каждая попытка fail-soft, в итоге `realQty = qty` (gross fallback). Поведение корректное, но 2с потерянного времени до placeTpSl.
Исправление (опционально):
    const orderId = data.result?.orderId;
    let realQty = qty;
    if (orderId) {
      for (let attempt = 0; attempt < 4; attempt++) { ... }
    }
Вердикт: для прод-фикса 170131 не критично — orderId всегда возвращается при успешном privatePost. На усмотрение TL.
```

```
[MINOR] Нет warn-лога когда все 4 попытки polling вернули cumExecQty=0 — backend/src/services/bybit/rest.js:449-466
Причина: если Market fill реально занял >2с (потолок 4×500мс), loop выходит без break, `realQty = qty` (gross fallback) → может снова словить 170131. Текущий код молча использует gross qty без warn-лога — диагностика затруднена.
Исправление (опционально, после loop):
    if (realQty === qty) {
      logger.warn('placeManualOrder: cumExecQty polling exhausted, using gross qty (potential 170131 risk)', { orderId, symbol });
    }
Аналогично для engine.js:265-279 — если после 3 попыток `confirmedFilledQty === 0`, желательно warn для диагностики.
Вердикт: для прода желательно (наблюдаемость), но не блокер. Текущая логика безопасна по рантайму — fallback корректный.
```

## Проверки выполнены

1. `git diff HEAD -- rest.js engine.js` — изменения совпадают со snippet-ами из задачи.
2. rest.js:442-473 — Market+SL/TP ветка перезаписана корректно.
3. engine.js:259-279 — Phase 1 polling расширен (avgPrice + cumExecQty + cumExecFee).
4. engine.js:317-327 — Phase 2 BUY tpSlQty адаптация корректна, SELL обходит блок.
5. `getAccountBalance` в engine.js — импорт не мёртвый (используется на строке 203).
6. Парсинг edge-cases (`""`, `"0"`, undefined) — все безопасны через `parseFloat || 0` и последующие `> 0` guards.
