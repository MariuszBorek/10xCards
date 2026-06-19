---
change_id: code-review-evals
title: Introduce promptfoo for AI agent evaluation
status: implemented
created: 2026-06-19
updated: 2026-06-19
archived_at: null
---

## Notes

introducing promptfoo for ai agent evaluation

### Live 3-model matrix (first run, 2026-06-19)

| Model                         | Verdict | deterministic | g-eval (≈flaws found)                             |
| ----------------------------- | ------- | ------------- | ------------------------------------------------- |
| `anthropic/claude-sonnet-4.6` | PASS    | 1.00          | 0.93 (≈3/3)                                       |
| `deepseek/deepseek-v4-flash`  | FAIL    | 0.00          | 0.30 (≈1/3 — rated security fine, missed the XSS) |
| `z-ai/glm-5.1`                | ERROR   | —             | — (no valid structured output)                    |

Signal about each model on this diff, not a config bug. promptfoo exits non-zero
(code 100) when not all cases pass — expected. Fixture's JSX `{{ }}` required
`PROMPTFOO_DISABLE_TEMPLATING=true` in the eval scripts (commit 960e958).
