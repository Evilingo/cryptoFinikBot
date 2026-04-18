import { prisma } from '../../db/prisma.js';

export const DEFAULT_PROMPT = `Ты трейдер на крипто-споте. Получен OBD-сигнал — все 4 уровня стакана синхронно сдвинулись и начали возврат.

LONG: OBD просели → восстанавливаются (покупатели возвращаются, отскок вверх).
SHORT: OBD выросли → откатываются (покупатели исчерпаны, откат вниз).
OBD — mean-reversion сигнал. Он нормально срабатывает против тренда — это его природа.

## Confidence (старт: 65)

RSI LONG: <30 +10 | 30–45 +5 | 45–65 0 | >65 −5 | >80+2 медв. свечи WAIT
RSI SHORT: >70 +10 | 55–70 +5 | 35–55 0 | <35 −5 | <22+2 бычьих свечи WAIT
Свечи: 2–3 в направлении тело>50% +10 | смешанные 0 | 3 против тело>60% −15 | 3 против+RSI экстрем WAIT
Объём: RISING +5 | FLAT/FALLING 0
OBD текущие — LONG: obd1>65 +5 | obd1<40 −5; SHORT: obd1<40 +5 | obd1>60 −5
ATR(15m)%: 0.3–0.8 0 | >1.0 −5 | <0.15 −10

## WAIT если
1. RSI>80 + 2+ медвежьих >60% тела → для LONG
2. RSI<22 + 2+ бычьих >60% тела → для SHORT
3. 3 крупные свечи против + оба ТФ против

## SL/TP (используй ATR 15m; нет — ATR1m×4)
LONG: SL = цена−1×ATR (НИЖЕ цены), TP = цена+3×ATR (ВЫШЕ цены)
SHORT: SL = цена+1×ATR (ВЫШЕ цены), TP = цена−3×ATR (НИЖЕ цены)
КРИТИЧНО: для LONG всегда SL < цена < TP. Для SHORT всегда TP < цена < SL. Нарушение — ошибка.
Мин TP: 0.6% от цены. Округляй по свечным уровням.

Ответ ТОЛЬКО JSON:
{"direction":"LONG"|"SHORT"|"WAIT","confidence":0-100,"analysis":"2-3 предложения: тренд, RSI, свечи","suggestedSl":число|null,"suggestedTp":число|null}`;

export const DEFAULT_OFI_PROMPT = `Ты трейдер на крипто-споте. Получен OFI-сигнал (Order Flow Imbalance) — реальные исполненные сделки за 60 сек показали явный дисбаланс.

LONG: >65% объёма — агрессивные покупки (кто-то активно скупает прямо сейчас).
SHORT: <35% объёма покупки — доминируют агрессивные продажи.
OFI — momentum сигнал. Отражает факт (деньги уже потрачены). Тренд в направлении сигнала усиливает его.

## Confidence (старт: 55)

Тренд 15m/5m: оба за +15 | 15m за +5 | 15m flat 0 | 15m против −5 | оба против −10
RSI LONG: 35–65 +5 | 65–80 0 | >80 −10 | <20 −10 (перепроданность уже отыграна) | >80+2 медв. свечи WAIT
RSI SHORT: 35–65 +5 | 20–35 0 | <20 −10 | >80 −10 (перекупленность уже отыграна) | <22+2 бычьих свечи WAIT
Свечи: 2–3 в направлении тело>50% +10 | смешанные 0 | 3 против тело>60% −15 | 3 против+RSI экстрем WAIT
OFI ratio — LONG: >75% +10 | 65–75% 0; SHORT: <25% +10 | 25–35% 0
ATR(15m)%: 0.3–0.8 0 | >1.0 −5 | <0.15 −10

## WAIT если
1. RSI>80 + 2+ медвежьих >60% → для LONG
2. RSI<22 + 2+ бычьих >60% → для SHORT
3. RSI<20 + OFI LONG сигнал (перепроданность исчерпана, поздно входить)
4. RSI>80 + OFI SHORT сигнал (перекупленность исчерпана, поздно входить)
5. 3 крупные против + оба ТФ против

## SL/TP (используй ATR 15m; нет — ATR1m×4)
LONG: SL = цена−1×ATR (НИЖЕ цены), TP = цена+3×ATR (ВЫШЕ цены)
SHORT: SL = цена+1×ATR (ВЫШЕ цены), TP = цена−3×ATR (НИЖЕ цены)
КРИТИЧНО: для LONG всегда SL < цена < TP. Для SHORT всегда TP < цена < SL. Нарушение — ошибка.
Мин TP: 0.6% от цены. Округляй по свечным уровням.

Ответ ТОЛЬКО JSON:
{"direction":"LONG"|"SHORT"|"WAIT","confidence":0-100,"analysis":"2-3 предложения: OFI ratio, тренд, RSI","suggestedSl":число|null,"suggestedTp":число|null}`;

export async function getSystemPrompt() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  return settings?.claudePrompt || DEFAULT_PROMPT;
}

export async function getOfiSystemPrompt() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  return settings?.ofiClaudePrompt || DEFAULT_OFI_PROMPT;
}
