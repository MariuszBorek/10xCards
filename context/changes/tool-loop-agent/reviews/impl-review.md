<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Tool Loop Agent — Code Reviewer Modularization

- **Plan**: context/changes/tool-loop-agent/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict                                                         |
| ------------------- | --------------------------------------------------------------- |
| Plan Adherence      | PASS                                                            |
| Scope Discipline    | PASS (1 justified extra: tsconfig `allowImportingTsExtensions`) |
| Safety & Quality    | WARNING                                                         |
| Architecture        | PASS                                                            |
| Pattern Consistency | PASS                                                            |
| Success Criteria    | PASS                                                            |

Success criteria verified this session: `npm run typecheck` clean (re-confirmed by sub-agent); `npm run dev` printed summary + findings for the `divide` snippet; `tsx` import of `src/index.ts` listed only public exports with no demo output and no throw.

## Findings

### F1 — `.env`-defined OPENROUTER_MODEL is silently ignored

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (behavior regression vs. monolith)
- **Location**: src/config.ts:10 (interacts with src/cli.ts:30)
- **Detail**: `DEFAULT_MODEL` is evaluated at config.ts import time. In the CLI, `loadEnv()` runs inside `main()` — after the module graph (incl. config.ts) has already evaluated. So an `OPENROUTER_MODEL` set only in `.env` (the documented `cp .env.example .env` flow) is loaded too late and `DEFAULT_MODEL` silently falls back to the hardcoded default. In the original monolith, `process.loadEnvFile()` ran before `DEFAULT_MODEL` (verified at d708e18:src/index.ts:13-19), so the override worked. The API key path is unaffected (`resolveApiKey` reads at call time, post-loadEnv). README:50 and the `ReviewCodeOptions.model` JSDoc both advertise this env override.
- **Fix A ⭐ Recommended**: Resolve the model lazily at call time — in `createReviewAgent`, use `config?.model ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6"` (keep `DEFAULT_MODEL` as the literal constant for display/import).
  - Strength: Restores documented .env-override behavior; matches the call-time pattern already used for the API key.
  - Tradeoff: Env read moves out of config.ts's single constant; one extra line in the factory.
  - Confidence: HIGH — mirrors resolveApiKey, verified against the diff.
  - Blind spot: None significant.
- **Fix B**: Accept and document the limitation — leave code as-is; note in README that `OPENROUTER_MODEL` must be a shell/ambient env var, not a `.env` entry.
  - Strength: Zero code change; keeps `DEFAULT_MODEL` a pure constant.
  - Tradeoff: Documented feature stays half-broken for the .env flow.
  - Confidence: MED — depends on whether .env model override matters.
  - Blind spot: CLI demo always uses the default model, so this only bites library/eval consumers.
- **Decision**: PENDING

### F2 — Awkward doc-comment phrasing in barrel

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/index.ts:5
- **Detail**: Comment reads "throws on no missing config" — garbled. Intent is "loads no .env, runs no demo, and never throws on missing config."
- **Fix**: Reword to "...and never throws on missing config."
- **Decision**: PENDING

### F3 — README library example bypasses buildReviewPrompt

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: README.md (createReviewAgent example)
- **Detail**: The `createReviewAgent()` snippet calls `agent.generate({ prompt: "Review: ..." })` with a raw string, not the curated `buildReviewPrompt`. Functionally fine (instructions + schema still apply); just slightly inconsistent with reviewCode's path.
- **Fix**: Note that reviewCode wraps buildReviewPrompt, or keep the raw example as the "bring your own prompt" illustration.
- **Decision**: PENDING

## Notes

- Implementation is a faithful, verbatim-where-required modularization: schemas/prompts/config moved byte-for-byte, agent correctly built on `ToolLoopAgent` + `Output.object`, barrel genuinely side-effect-free, no API-key leakage in logs/errors, CLI promise rejection handled, no floating promises.
- The one unplanned change — `tsconfig.json` `allowImportingTsExtensions: true` (commit 422abc9) — is a required enabler for the plan's mandated `.ts` relative imports under NodeNext + verbatimModuleSyntax. Justified extra, not scope creep.
- F1 is a plan-design gap rather than implementation drift: the plan moved `loadEnv()` to call time but left `DEFAULT_MODEL` as a module-load constant.
