// Prompt evaluation script: compare Sonnet vs Haiku on hand-crafted test cases.
// Usage: node backend/scripts/eval-prompt.js [--models=sonnet,haiku] [--cases=path]
// Output: markdown report to stdout + saved to backend/scripts/eval-report-<timestamp>.md

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pricing per 1M tokens (Anthropic published, 2026-04)
const PRICING = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
};

// Hardcoded prompts (mirror prompts.js DEFAULT_PROMPT / DEFAULT_OFI_PROMPT)
const OBD_PROMPT = `Ты трейдер на крипто-споте. Получен OBD-сигнал — все 4 уровня стакана синхронно сдвинулись и начали возврат.

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

const OFI_PROMPT = `Ты трейдер на крипто-споте. Получен OFI-сигнал (Order Flow Imbalance) — реальные исполненные сделки за 60 сек показали явный дисбаланс.

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

function formatTechnicals(tech) {
  const lines = [];
  if (tech.rsi != null) {
    let zone;
    if (tech.rsi >= 70) zone = 'перекуплен';
    else if (tech.rsi <= 30) zone = 'перепродан';
    else zone = 'нейтральная зона';
    lines.push(`RSI(14): ${tech.rsi} — ${zone}`);
  }
  if (tech.atr) lines.push(`ATR(14): ${tech.atr.value} (${tech.atr.pct}% от цены) — текущая волатильность`);
  if (tech.volumeTrend) {
    const sign = tech.volumeTrend.changePct > 0 ? '+' : '';
    lines.push(`Объёмный тренд: ${tech.volumeTrend.direction} (${sign}${tech.volumeTrend.changePct}% к предыдущим 5 свечам)`);
  }
  if (tech.recentCandles?.length) {
    const desc = tech.recentCandles.map((c, i) => {
      const pos = i === tech.recentCandles.length - 1 ? 'последняя' : `−${tech.recentCandles.length - 1 - i}`;
      return `${pos}: ${c.type} (тело ${c.bodyPct}% диапазона, закр. ${c.close})`;
    });
    lines.push(`Последние ${tech.recentCandles.length} свечи:\n  ${desc.join('\n  ')}`);
  }
  return lines.join('\n');
}

function formatHigherTf(t5m, t15m) {
  const fmt = (tf, t) => {
    if (!t) return `${tf}: н/д`;
    const sign = t.changePct > 0 ? '+' : '';
    return `${tf}: ${t.direction} (${sign}${t.changePct}%)`;
  };
  return `${fmt('5m', t5m)} | ${fmt('15m', t15m)}`;
}

function buildUserMessage(c) {
  const tfLine = formatHigherTf(c.input.trend5m, c.input.trend15m);
  const atrLine = c.input.atr15m
    ? `ATR(14) на 15m: ${c.input.atr15m.value} (${c.input.atr15m.pct}% от цены)`
    : 'ATR(15m): н/д';
  const techSection = c.input.tech ? formatTechnicals(c.input.tech) : '';

  if (c.strategy === 'OFI') {
    return `Пара: ${c.input.pair.monitorSymbol} → ${c.input.pair.tradeSymbol}
Цена: ${c.input.currentPrice}
OFI: ${c.input.ofiDirection}, ratio ${c.input.ofiRatio}%

Тренд: ${tfLine}
${techSection}
${atrLine}`;
  }
  return `Пара: ${c.input.pair.monitorSymbol} → ${c.input.pair.tradeSymbol}
Цена: ${c.input.currentPrice}
OBD: obd1=${c.input.obd.obd1} obd2=${c.input.obd.obd2} obd3=${c.input.obd.obd3} obd4=${c.input.obd.obd4}
Тренд: ${tfLine}
${techSection}
${atrLine}
Свечи 1m: [симулировано — поле опущено в эвале]`;
}

async function callModel(anthropic, model, systemPrompt, userMessage) {
  const t0 = Date.now();
  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    return { error: err.message, latencyMs: Date.now() - t0 };
  }
  const latencyMs = Date.now() - t0;
  const text = response.content[0]?.text || '';
  const usage = response.usage || {};
  const price = PRICING[model] || { input: 0, output: 0 };
  const cost = (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;

  return {
    rawText: text,
    latencyMs,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cost,
  };
}

function parseResponse(text) {
  if (!text) return { ok: false, reason: 'empty response' };
  // Strip markdown code fences
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : cleaned.trim();
  try {
    const parsed = JSON.parse(jsonText);
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err.message}`, jsonText: jsonText.slice(0, 200) };
  }
}

function scoreCase(testCase, parsed) {
  const issues = [];
  let score = 100;

  // Direction match
  const directionOk = parsed.direction === testCase.expected.direction;
  if (!directionOk) {
    issues.push(`direction mismatch: got ${parsed.direction}, expected ${testCase.expected.direction}`);
    score -= 50;
  }

  // Confidence in expected range
  const conf = parsed.confidence ?? 0;
  if (conf < testCase.expected.minConfidence || conf > testCase.expected.maxConfidence) {
    issues.push(`confidence ${conf} outside [${testCase.expected.minConfidence}-${testCase.expected.maxConfidence}]`);
    score -= 20;
  }

  // SL/TP sanity for non-WAIT
  if (parsed.direction === 'LONG') {
    if (parsed.suggestedSl != null && parsed.suggestedSl >= testCase.input.currentPrice) {
      issues.push(`LONG SL >= price (${parsed.suggestedSl} >= ${testCase.input.currentPrice})`);
      score -= 15;
    }
    if (parsed.suggestedTp != null && parsed.suggestedTp <= testCase.input.currentPrice) {
      issues.push(`LONG TP <= price (${parsed.suggestedTp} <= ${testCase.input.currentPrice})`);
      score -= 15;
    }
  } else if (parsed.direction === 'SHORT') {
    if (parsed.suggestedSl != null && parsed.suggestedSl <= testCase.input.currentPrice) {
      issues.push(`SHORT SL <= price (${parsed.suggestedSl} <= ${testCase.input.currentPrice})`);
      score -= 15;
    }
    if (parsed.suggestedTp != null && parsed.suggestedTp >= testCase.input.currentPrice) {
      issues.push(`SHORT TP >= price (${parsed.suggestedTp} >= ${testCase.input.currentPrice})`);
      score -= 15;
    }
  }

  return { score: Math.max(0, score), issues };
}

async function runEval(model, cases, anthropic) {
  const results = [];
  for (const c of cases) {
    const systemPrompt = c.strategy === 'OFI' ? OFI_PROMPT : OBD_PROMPT;
    const userMessage = buildUserMessage(c);
    const callResult = await callModel(anthropic, model, systemPrompt, userMessage);

    if (callResult.error) {
      results.push({ id: c.id, model, error: callResult.error, latencyMs: callResult.latencyMs });
      continue;
    }

    const parseResult = parseResponse(callResult.rawText);
    if (!parseResult.ok) {
      results.push({
        id: c.id, model,
        jsonValid: false,
        parseReason: parseResult.reason,
        rawTextSnippet: callResult.rawText.slice(0, 200),
        latencyMs: callResult.latencyMs,
        cost: callResult.cost,
        inputTokens: callResult.inputTokens,
        outputTokens: callResult.outputTokens,
      });
      continue;
    }

    const score = scoreCase(c, parseResult.parsed);
    results.push({
      id: c.id,
      model,
      jsonValid: true,
      direction: parseResult.parsed.direction,
      confidence: parseResult.parsed.confidence,
      expected: c.expected,
      issues: score.issues,
      score: score.score,
      latencyMs: callResult.latencyMs,
      cost: callResult.cost,
      inputTokens: callResult.inputTokens,
      outputTokens: callResult.outputTokens,
    });
  }
  return results;
}

function summarize(results, model) {
  const valid = results.filter(r => r.jsonValid);
  const errors = results.filter(r => r.error);
  const parseFailed = results.filter(r => r.jsonValid === false);
  const avgScore = valid.length ? valid.reduce((a, r) => a + r.score, 0) / valid.length : 0;
  const directionAccuracy = valid.filter(r => r.direction === r.expected.direction).length / Math.max(1, valid.length);
  const avgLatency = results.reduce((a, r) => a + (r.latencyMs || 0), 0) / Math.max(1, results.length);
  const totalCost = results.reduce((a, r) => a + (r.cost || 0), 0);
  const totalInputTokens = results.reduce((a, r) => a + (r.inputTokens || 0), 0);
  const totalOutputTokens = results.reduce((a, r) => a + (r.outputTokens || 0), 0);

  return {
    model,
    n: results.length,
    jsonValidRate: valid.length / Math.max(1, results.length),
    parseFailures: parseFailed.length,
    apiErrors: errors.length,
    avgScore: avgScore.toFixed(1),
    directionAccuracy: (directionAccuracy * 100).toFixed(1) + '%',
    avgLatencyMs: Math.round(avgLatency),
    totalCost: totalCost.toFixed(4),
    avgCostPerCall: (totalCost / Math.max(1, results.length)).toFixed(5),
    totalInputTokens,
    totalOutputTokens,
  };
}

function buildReport(cases, allResults, summaries) {
  const ts = new Date().toISOString();
  const lines = [];
  lines.push(`# Prompt Eval Report — ${ts}`);
  lines.push('');
  lines.push(`**Test cases:** ${cases.length} (hand-crafted from real prod signals)`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | ' + summaries.map(s => s.model).join(' | ') + ' |');
  lines.push('|--------|' + summaries.map(() => '------').join('|') + '|');
  const metrics = ['n', 'jsonValidRate', 'parseFailures', 'apiErrors', 'avgScore', 'directionAccuracy', 'avgLatencyMs', 'totalCost', 'avgCostPerCall', 'totalInputTokens', 'totalOutputTokens'];
  for (const m of metrics) {
    const fmt = (v) => m === 'jsonValidRate' ? (v * 100).toFixed(1) + '%' : v;
    lines.push('| ' + m + ' | ' + summaries.map(s => fmt(s[m])).join(' | ') + ' |');
  }
  lines.push('');

  // Per-case comparison
  lines.push('## Per-case comparison');
  lines.push('');
  for (const c of cases) {
    lines.push(`### ${c.id}`);
    lines.push(`*${c.context}*`);
    lines.push('');
    lines.push(`**Expected:** direction=\`${c.expected.direction}\`, conf in \`[${c.expected.minConfidence}-${c.expected.maxConfidence}]\``);
    lines.push('');
    lines.push('| Model | Direction | Conf | Score | Issues | Latency | Cost |');
    lines.push('|-------|-----------|------|-------|--------|---------|------|');
    for (const r of allResults.filter(r => r.id === c.id)) {
      if (r.error) {
        lines.push(`| ${r.model} | ❌ ERROR | — | 0 | ${r.error} | ${r.latencyMs}ms | $0 |`);
      } else if (!r.jsonValid) {
        lines.push(`| ${r.model} | ❌ JSON FAIL | — | 0 | ${r.parseReason} | ${r.latencyMs}ms | $${r.cost?.toFixed(5)} |`);
      } else {
        const dirEmoji = r.direction === r.expected.direction ? '✅' : '⚠️';
        const issuesText = r.issues.length ? r.issues.join('; ') : '—';
        lines.push(`| ${r.model} | ${dirEmoji} ${r.direction} | ${r.confidence} | ${r.score} | ${issuesText} | ${r.latencyMs}ms | $${r.cost?.toFixed(5)} |`);
      }
    }
    lines.push('');
  }

  // JSON parse failures detail
  const parseFails = allResults.filter(r => r.jsonValid === false);
  if (parseFails.length > 0) {
    lines.push('## JSON parse failures (raw response snippets)');
    lines.push('');
    for (const f of parseFails) {
      lines.push(`### ${f.id} — ${f.model}`);
      lines.push('```');
      lines.push(f.rawTextSnippet || '(no snippet)');
      lines.push('```');
      lines.push('');
    }
  }

  // Verdict
  lines.push('## Verdict');
  lines.push('');
  const sonnetSummary = summaries.find(s => s.model.includes('sonnet'));
  const haikuSummary = summaries.find(s => s.model.includes('haiku'));
  if (sonnetSummary && haikuSummary) {
    const scoreDelta = parseFloat(haikuSummary.avgScore) - parseFloat(sonnetSummary.avgScore);
    const costRatio = parseFloat(sonnetSummary.totalCost) / Math.max(0.0001, parseFloat(haikuSummary.totalCost));
    lines.push(`- **Quality delta:** Haiku scored ${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(1)} vs Sonnet`);
    lines.push(`- **Cost delta:** Sonnet is ${costRatio.toFixed(1)}× more expensive than Haiku`);
    lines.push(`- **JSON reliability:** Sonnet ${(sonnetSummary.jsonValidRate * 100).toFixed(0)}%, Haiku ${(haikuSummary.jsonValidRate * 100).toFixed(0)}%`);
    lines.push('');
    if (scoreDelta < -10) {
      lines.push(`⚠️ **Consider reverting to Sonnet** — Haiku quality drop > 10 points.`);
    } else if (haikuSummary.parseFailures > 1) {
      lines.push(`⚠️ **Haiku JSON parse failures** = ${haikuSummary.parseFailures}. Investigate response format.`);
    } else {
      lines.push(`✅ **Haiku is safe to keep** — quality comparable, ${costRatio.toFixed(0)}× cheaper.`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const modelsArg = args.find(a => a.startsWith('--models='))?.split('=')[1];
  const casesArg = args.find(a => a.startsWith('--cases='))?.split('=')[1];

  const models = modelsArg ? modelsArg.split(',') : ['claude-sonnet-4-6', 'claude-haiku-4-5'];
  const casesPath = casesArg || path.join(__dirname, 'eval-cases.json');
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

  console.error(`Running eval: ${cases.length} cases × ${models.length} models = ${cases.length * models.length} API calls`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const allResults = [];
  const summaries = [];

  for (const model of models) {
    console.error(`\nRunning model: ${model}`);
    const results = await runEval(model, cases, anthropic);
    allResults.push(...results);
    const summary = summarize(results, model);
    summaries.push(summary);
    console.error(`  ${model}: avgScore=${summary.avgScore}, JSON-valid=${(summary.jsonValidRate * 100).toFixed(0)}%, cost=$${summary.totalCost}`);
  }

  const report = buildReport(cases, allResults, summaries);
  console.log(report);

  // Save report
  const tsFile = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(__dirname, `eval-report-${tsFile}.md`);
  fs.writeFileSync(reportPath, report);
  console.error(`\nReport saved: ${reportPath}`);
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
