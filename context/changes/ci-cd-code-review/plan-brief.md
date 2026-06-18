# CI/CD AI PR Code Review — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Stand up the project's first AI-driven CI/CD code review. Every PR to `main` gets
reviewed by an LLM against the 7 criteria in `requirements.md` (each scored
1–10), receives a PR comment with the scores + verdict + summary, and is labeled
`ai-cr:passed` or `ai-cr:failed`. The point is an automated quality gate that
catches single-axis failures (a security hole, a logic bug) before merge, with a
one-click re-run via the `ai-cr:review` label.

## Starting Point

`packages/code-reviewer` exists but is a deliberate hardcoded demo: it reviews a
fixed `divide(a,b)` snippet, has a severity-finding schema (no scores, 3 of the 7
criteria missing entirely), prints human text (no JSON), has no verdict, and no
mock mode. The OpenRouter + `ToolLoopAgent` + `Output.object` plumbing
(`agent/reviewer.ts`) and the lazy `config.ts` resolution are solid and reused
as-is. No GitHub Actions code-review workflow or `ai-cr:*` labels exist yet.

## Desired End State

Opening or pushing a PR to `main` triggers a review that posts one in-place-edited
comment (7 scores + verdict + summary) and applies exactly one pass/fail label.
Adding `ai-cr:review` re-runs it (and the label auto-clears so it can be re-added).
Fork PRs and API outages degrade gracefully — a neutral "skipped"/"unavailable"
note, never a false failure or a blocked merge.

## Key Decisions Made

| Decision                           | Choice                                                                             | Why                                                                                      | Source   |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Verdict location                   | `verdict` field in the LLM schema                                                  | Single source of truth in the structured output                                          | Plan     |
| Pass/fail rule                     | Min-threshold: fail if any criterion < 5                                           | Averaging hides exactly the single-axis failures the gate exists to catch                | Research |
| Verdict ↔ threshold reconciliation | Min-threshold rule encoded in the prompt rubric; CLI only _warns_ on inconsistency | Honors both "verdict in schema" and "min-threshold" without CLI overriding the model     | Plan     |
| Mock mode                          | Reviewer gets its own `OPENROUTER_MOCK` path                                       | Enables offline/free unit tests of the new plumbing; `OPENROUTER_MOCK` today is app-only | Research |
| Fork PRs                           | Skip gracefully on `pull_request`                                                  | Safe for a solo repo; avoids `pull_request_target` fork-code risk                        | Research |
| PR body                            | Include title + body + diff, bounded by a size guard                               | Body gives the intent Correctness grades against; guard caps token cost                  | Research |
| Tests                              | Vitest unit tests on the new logic via mock                                        | Locks the CLI/JSON contract the workflow depends on, runs free/offline                   | Plan     |
| Branch                             | `main` (not "master")                                                              | Repo + existing `ci.yml` use `main`                                                      | Research |

## Scope

**In scope:** scored 7-criteria schema + in-schema verdict; CLI `--title/--body/
--diff-file` + JSON output; prompt rubric + project security heuristic; size
guard; `OPENROUTER_MOCK`; vitest tests; composite action; `pull_request` workflow
with idempotent comment, labels, retry, fork-skip, API-error-neutral; README note.

**Out of scope:** `pull_request_target` / fork review; "business alignment" &
"architectural fit" criteria (parked); multi-model/ensemble, streaming, auto-fix;
changes to the existing `ci.yml`.

## Architecture / Approach

Two workstreams, package-first. **Package**: extend `schemas/review.ts`,
`prompts/review.ts`, `cli.ts`, `config.ts` (mock) — leaving the `agent/reviewer.ts`
OpenRouter plumbing untouched — to emit `{ verdict, summary, scores }` JSON.
**GHA**: a composite action (`.github/actions/ai-review`) does the data-only LLM
call and exposes outputs; the calling workflow (`.github/workflows/ai-code-review.yml`)
owns the `GITHUB_TOKEN`-backed comment + label side-effects. Separation keeps the
token out of the untrusted-diff path.

## Phases at a Glance

| Phase                            | What it delivers                                                            | Key risk                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Scored schema + rubric prompt | 7-criteria 1–10 schema + verdict; full rubric prompt                        | Getting the contract right — everything depends on it                        |
| 2. CLI I/O + mock mode           | argv flags, JSON output, `OPENROUTER_MOCK`, size guard, consistency warning | stdout purity (JSON only); mock determinism                                  |
| 3. Vitest unit tests             | Contract tests via mock                                                     | Ensuring new test path is picked up by `npm test`                            |
| 4. Composite action              | `action.yml` runs CLI, exposes verdict/scores/summary                       | Composite constraints (`shell: bash`, no secrets ctx, heredoc output)        |
| 5. Workflow + side-effects       | Triggers, idempotent comment, labels, retry, fork-skip                      | `ai-cr:review` removal trap; fork/secret handling; needs a real PR to verify |

**Prerequisites:** root `npm ci` already hoists reviewer deps (npm workspaces, in
place). One repo secret `OPENROUTER_API_KEY` for live reviews (workflow is safe to
merge before it's set — reviews just skip).
**Estimated effort:** ~2–3 sessions across 5 phases; Phase 5 needs a throwaway PR
for manual verification.

## Open Risks & Assumptions

- **Verdict/threshold coupling**: the gate rule lives in the prompt, so a model
  that ignores the rule could mislabel; mitigated by the CLI consistency warning
  and on-demand retry (not a hard override, per decision).
- **No live CI test without the secret**: full end-to-end (Phase 5) can only be
  verified once `OPENROUTER_API_KEY` is configured and a real PR is opened.
- **Test discovery**: confirm the root vitest config picks up the new
  `test/code-reviewer/` path (Phase 3).
- **Assumption**: same-repo PRs are the primary flow; fork review is genuinely
  not needed yet.

## Success Criteria (Summary)

- A PR to `main` gets one scored, in-place-edited comment and exactly one
  pass/fail label.
- `ai-cr:review` reliably re-runs the review and clears itself afterward.
- Fork PRs and API errors degrade to neutral notes without failing the check or
  blocking merge.
