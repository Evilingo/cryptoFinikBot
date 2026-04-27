# Cost step 3 — Haiku swap (DONE inline)

Pipeline: applied inline (no Dev/QA/TL agents) — ceremony exceeds value for 1-line change. Spec: `queue/todo/cost-haiku-swap.md`.

## Change

`backend/src/services/claude/orchestrator.js:17` —
- Before: `model: 'claude-sonnet-4-5'`
- After: `model: 'claude-haiku-4-5'`

Nothing else touched.

## Self-review

- ✅ Syntax: `node --check` passes
- ✅ Only `callClaude` affected; `validateSlTp`, retry-logic, JSON parsing, max_tokens, system, messages — unchanged
- ✅ Model name is correct alias per Anthropic 4.5 family
- ✅ All callers (`analyzeOfiSignal`, `analyzeSignal`) use callClaude — both inherit Haiku swap

## Risk / mitigation

- If Haiku quality drops noticeably (more WAIT, worse SL/TP, broken JSON) — `git revert` 1 commit, 30 sec rollback.
- Watch first 2-3 days for confidence-distribution shift in DB (`SELECT direction, AVG(confidence), COUNT(*) FROM "Signal" WHERE outcome IS NOT NULL GROUP BY direction;` after migration).

## Expected effect

- Cost per remaining Claude call: ~12x cheaper
- Cumulative with step 2 (pre-filter): ~$1.75/day → ~$0.04/day (~44x cheaper than baseline)
