---
date: 2026-06-18T00:00:00Z
researcher: mariuszborek
git_commit: d74e976893941b196b9dd83eae1f909bb522f09f
branch: main
repository: 10xCards
topic: "CI/CD GitHub Actions workflow for AI PR code review"
tags: [research, codebase, ci-cd, github-actions, code-reviewer, openrouter]
status: complete
last_updated: 2026-06-18
last_updated_by: mariuszborek
---

# Research: CI/CD GitHub Actions workflow for AI PR code review

**Date**: 2026-06-18
**Researcher**: mariuszborek
**Git Commit**: d74e976893941b196b9dd83eae1f909bb522f09f
**Branch**: main
**Repository**: 10xCards

## Research Question

How do we wire the existing `packages/code-reviewer` package into a GitHub Actions
workflow that, per `context/changes/ci-cd-code-review/requirements.md`, runs an AI
code review on every PR to `main`, scores 7 criteria (1–10), posts a PR comment,
applies `ai-cr:passed`/`ai-cr:failed` labels, and re-runs on demand when the
`ai-cr:review` label is added — and what must change in the reviewer package to
support that?

## Summary

**The headline finding: this is mostly a "build the reviewer's real interface" job,
not a "write some YAML" job.** The GitHub Actions mechanics are well-understood and
low-risk. The hard, central work is that the existing `packages/code-reviewer` is a
**hardcoded demo**, not a CI-ready tool. Specifically, against `requirements.md` the
package today:

- **Takes no inputs** — `cli.ts` reviews a hardcoded `divide(a,b)` snippet. There is
  no path for a git diff, PR title, or PR description (`cli.ts:32-34`).
- **Has no scoring** — `ReviewSchema` is `{ summary, findings[] }` where each finding
  carries a 5-value `severity` enum, _not_ the 7 criteria scored 1–10 the spec
  requires (`schemas/review.ts:4-17`). None of the 3 criteria "Error handling",
  "Test coverage", "Consistency with conventions" appear in schema or prompt at all.
- **Emits human text only** — `printReview` writes to stdout with `console.log`;
  there is no machine-readable JSON for the workflow to parse (`cli.ts:13-25`).
- **Has no pass/fail verdict** and **always exits 0** on a successful review,
  non-zero only when an exception is thrown (`cli.ts:43-48`). There is no signal to
  choose between the `ai-cr:passed` and `ai-cr:failed` labels.
- **Has no mock mode** — there is no `OPENROUTER_MOCK`; the real OpenRouter call (and
  the API-key requirement) always runs.

What _is_ solid and reusable: the OpenRouter + AI SDK plumbing (`ToolLoopAgent` +
`Output.object` structured output in `agent/reviewer.ts`), the lazy call-time config
resolution (`config.ts`), the `tsx`/Node-22 runtime, and the npm-workspaces install
that already makes the package's deps available after a root `npm ci`.

> ⚠️ **Correction to a sub-agent finding.** One research pass claimed the _original_
> monolith (commit d708e18) contained "seven scoring dimensions 1–10". This was
> verified against the live source and is **false** — it conflated `requirements.md`
> with the code. The schema has never had per-criterion scores; `severity`-tagged
> findings are all that exists (`schemas/review.ts:4-17`, confirmed by direct read).
> The 7-criteria 1–10 model must be **built**, not adapted.

## Detailed Findings

### Area 1 — The existing reviewer package contract (what's there today)

**Input** — none usable. `reviewCode(options)` accepts `{ code, language?, model?,
apiKey? }` only (`agent/reviewer.ts:8-17`). The CLI feeds it a hardcoded string
(`cli.ts:32-38`). `process.argv` is touched only to detect the entrypoint
(`cli.ts:43`), never parsed for arguments. PR title/description have no
representation anywhere in the package.

**Output** — human-readable text only. `printReview` prints `Summary: …` then per
finding `[SEVERITY] title (line N)` + detail + suggestion (`cli.ts:13-25`). No JSON
serialization. The library function `reviewCode()` _returns_ the typed `Review`
object (`agent/reviewer.ts:42-50`), so a future in-process caller could get
structured data — but the CLI never serializes it.

**Schema** — `ReviewSchema = { summary: string, findings: ReviewFinding[] }`
(`schemas/review.ts:14-17`); `ReviewFinding = { severity: enum[critical|high|medium|
low|info], title, detail, suggestion, line }` (`schemas/review.ts:4-10`). A
qualitative severity model, not a scored-criteria model.

**Prompt** — `REVIEW_INSTRUCTIONS` names only four dimensions informally:
"correctness, security, performance, and maintainability" (`prompts/review.ts:9-11`).
`buildReviewPrompt(code, language)` wraps the code in a fenced block
(`prompts/review.ts:14-17`).

**Verdict / exit code** — no verdict field, no threshold, no aggregate. `main()`
never sets `process.exitCode` from review content; the only non-zero path is a thrown
exception (`cli.ts:43-48`).

**Config / env** — exactly two vars are read (grep-confirmed, no others):

- `OPENROUTER_API_KEY` — required; `resolveApiKey()` throws if absent
  (`config.ts:40-46`).
- `OPENROUTER_MODEL` — optional; `resolveModel()` falls back to `DEFAULT_MODEL =
"anthropic/claude-sonnet-4.6"` (`config.ts:10`, `config.ts:19-21`).
- `.env` is loaded via Node-22-native `process.loadEnvFile()` in `loadEnv()`, called
  **only** by the CLI (`config.ts:28-34`, `cli.ts:30`). The library barrel
  (`index.ts`) is side-effect-free. **No `OPENROUTER_MOCK` exists.**

**Runtime** — run via `tsx` (no build step; `tsconfig` is `noEmit`). `dev`/`start`
both = `tsx src/cli.ts` (`package.json:8-11`). Node `>=22.14.0`. Relies on
Node-22-native `process.loadEnvFile`.

### Area 2 — Gap analysis: 7 required criteria vs. what's emitted

| Required criterion (1–10)     | In schema? | In prompt?                  | Gap                             |
| ----------------------------- | ---------- | --------------------------- | ------------------------------- |
| Correctness                   | No         | Yes (word)                  | No score field                  |
| Security                      | No         | Yes (word)                  | No score field                  |
| Error handling & edge cases   | No         | No                          | **Missing entirely**            |
| Readability & maintainability | No         | Partial ("maintainability") | No score; "readability" unnamed |
| Test coverage                 | No         | No                          | **Missing entirely**            |
| Performance & efficiency      | No         | Yes ("performance")         | No score field                  |
| Consistency with conventions  | No         | No                          | **Missing entirely**            |

Two structural mismatches, not just missing fields: (1) **scale** — a 5-value
severity enum vs. seven integer 1–10 scores; (2) **shape** — finding-oriented
(issues surfaced) vs. criterion-oriented (seven fixed scored axes). The schema must
gain a `scores` object keyed by the 7 criteria plus a derived verdict, and the prompt
must carry the full 1–10 rubric quoted from `requirements.md:16-42`.

### Area 3 — What must change in the package (the real work)

1. **Input layer** (`cli.ts`): a real argv/stdin interface — recommended
   `--title <s> --body <s> --diff-file <path>` — replacing the hardcoded demo. Thread
   title/description/diff into `ReviewCodeOptions` and `buildReviewPrompt`.
2. **Schema** (`schemas/review.ts`): add `scores` (7 criteria × int 1–10) and a
   `verdict`/`passed` field (or derive verdict in the CLI from a threshold).
3. **Prompt** (`prompts/review.ts`): replace the 4-word focus list with the 7-criteria
   1–10 rubric from `requirements.md`.
4. **Output** (`cli.ts`): emit machine-readable JSON `{ verdict, summary, scores }`
   (for the workflow to parse), optionally alongside the human summary.
5. **Pass/fail** logic + threshold producing `passed`/`failed`.
6. **`OPENROUTER_MOCK` mode**: deterministic offline path that skips the OpenRouter
   call and the API-key throw, so CI runs free/offline. (Note: `ci.yml` already sets
   `OPENROUTER_MOCK=true` for the integration job — see Area 6 — implying this var was
   _expected_ to exist; it does not yet.)

Reusable as-is: `agent/reviewer.ts` (OpenRouter + `Output.object`), `config.ts`
resolution, the `tsx`/Node-22 runtime.

### Area 4 — GitHub Actions design (mechanics are well-understood)

**Branch name**: the live repo and `ci.yml` use **`main`**; `requirements.md:3` says
"master" — the plan should standardize on **`main`**.

**Triggers** — one workflow, two trigger families, guarded by a job-level `if`:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
    branches: [main]
```

```yaml
jobs:
  review:
    if: >-
      github.event.action != 'labeled' ||
      github.event.label.name == 'ai-cr:review'
```

Reads as "run unless this is a `labeled` event for some _other_ label." `opened` /
`synchronize` (new commits) / `reopened` pass unconditionally; `labeled` passes only
for `ai-cr:review`. `github.event.label.name` is populated only on labeled events.

**Composite action** at `.github/actions/ai-review/action.yml`
(`runs.using: "composite"`), referenced by path `uses: ./.github/actions/ai-review`.
Hard constraints to respect:

- Every `run` step **must** declare `shell: bash`.
- **No `secrets` context** inside a composite action — secrets (and `GITHUB_TOKEN`)
  must be passed in as `inputs:` from the calling workflow.
- Reference inputs as `${{ inputs.x }}`; no `permissions:` block (set by the caller);
  no `runs`-level `if:` (step-level only).
- Multi-line `$GITHUB_OUTPUT` uses the heredoc `<<__EOF__` form (`::set-output` is
  removed).
- Pass the diff via a **file** (`--diff-file`), not an inline arg, to dodge
  arg-length/escaping limits.

**Diff + metadata** — cheapest path: title/body from the event payload
(`github.event.pull_request.title` / `.body`, default `body` to `""` since it can be
null). For the diff, recommend **`gh pr diff <n> --repo <repo> > pr.diff`** — it pulls
the computed diff from the API, sidestepping the fork/shallow-checkout `git merge-base`
gotcha. Alternative is `git diff base...HEAD` but only after `actions/checkout@v4` with
`fetch-depth: 0`. Add a size guard (skip/truncate oversized diffs to bound LLM cost).

**Permissions** (job-level, least privilege):

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

Both `pull-requests` and `issues` are needed: PR comments are issue comments and
labels are an issues concept under the REST API. Never rely on the default token
permissions (now read-only for many repos).

**Idempotent PR comment** — keep this in the **workflow** (not the composite action)
so the verdict/summary outputs and token handling stay explicit. Use a hidden marker
`<!-- ai-code-review -->` + find-comment → create-or-update, so re-runs **edit in
place** instead of spamming. Recommended: `peter-evans/find-comment@v3` +
`peter-evans/create-or-update-comment@v4` (`edit-mode: replace`); zero-dependency
fallback is `actions/github-script@v7` with `listComments`→`updateComment|createComment`.

**Labels**:

- Ensure they exist idempotently: `gh label create "ai-cr:passed" --color 2EA043
--force`, `ai-cr:failed --color D73A49`, `ai-cr:review --color 0969DA`.
- Apply verdict + remove the opposite atomically: `gh pr edit "$PR"
--add-label ai-cr:passed --remove-label ai-cr:failed` (and vice-versa).
- **Always `--remove-label ai-cr:review` after each run** — the `labeled` trigger
  fires on the _add transition_, so if the label is left on, re-adding it is
  impossible and no new run can be triggered. Removing it restores the retry path.

**Secrets + fork problem** — `OPENROUTER_API_KEY` as a repo secret, referenced at the
workflow level and passed into the composite action as an input. Critical constraint:
PRs **from forks** on `pull_request` get **no secrets** and a **read-only** token, so
the reviewer can't call OpenRouter and can't comment/label. `pull_request_target` is
the alternative (secrets + write token even for forks) but runs in the base-repo
context and is dangerous if it executes fork code. Recommendation for this
single-maintainer repo: **stay on `pull_request`** (same-repo PRs have secrets + write
token, so the day-to-day flow works); let fork PRs **skip gracefully** (empty key →
post "skipped for fork PR", no failure); add a separate `pull_request_target` workflow
later only if fork review is actually wanted, gated on the `ai-cr:review` label.

**Pass/fail threshold** — make it an action input (`fail-threshold`, default `5`).
Recommended rule: **min-threshold — fail if _any_ of the 7 criteria scores below 5**.
Averaging hides exactly the single-axis failures (a security hole, a logic bug) the
gate exists to catch. Treat an LLM/API error (no JSON) as a _neutral_ outcome
("review unavailable", no pass/fail label) rather than a hard fail, so OpenRouter
outages don't block merges.

**Concurrency** — guard rapid pushes:

```yaml
concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

Key on the PR number (not `github.ref`); `cancel-in-progress` means only the latest
diff is reviewed, saving API spend and avoiding races on the single comment/labels.

### Area 5 — Repo wiring conventions to match

- **npm workspaces** — root `package.json:5-7` declares `"workspaces": ["packages/*"]`,
  so a root `npm ci` installs and hoists the reviewer's deps (incl. `tsx`). This was
  added specifically for CI in commit d74e976. Invoke via `npm run -w
@10xcards/code-reviewer start` or `npx tsx packages/code-reviewer/src/cli.ts`.
- **Secrets style** — `ci.yml:24-26` injects secrets as step-level `env:` using
  `${{ secrets.X }}` (SUPABASE_URL/KEY on the build step). Mirror this for
  `OPENROUTER_API_KEY`.
- **Standard setup** — `ci.yml:13-18`: `actions/checkout@v4` → `actions/setup-node@v4`
  (`node-version: 22`, `cache: npm`) → `npm ci`. Reuse verbatim.
- **Labels** — no `ai-cr:*` labels (or any label config) exist in the repo yet; the
  workflow must create them (`gh label create --force`).
- **Node** — `.nvmrc` pins 22.14.0; `tsx@4.22.4` is a devDep of the reviewer, available
  after root `npm ci`.

### Area 6 — A telling detail in the existing CI

`ci.yml`'s integration job already materializes `OPENROUTER_MOCK=true` into both
`.env` and `$GITHUB_ENV` (in the "Materialize env from local Supabase keys" step),
and the suite presumably relies on it. **But `OPENROUTER_MOCK` is not read anywhere in
`packages/code-reviewer/src/`** (grep-confirmed). Either the mock is consumed by other
test code (Astro app / vitest) and not the reviewer, or this is a latent expectation
that the reviewer should honor a mock mode. The plan should reconcile this: if the
AI-review workflow is to run cheaply/deterministically in CI, the reviewer needs to
actually implement `OPENROUTER_MOCK`.

## Code References

- `packages/code-reviewer/src/cli.ts:13-25` — `printReview`, human-text-only output
- `packages/code-reviewer/src/cli.ts:32-38` — hardcoded demo input (no argv parsing)
- `packages/code-reviewer/src/cli.ts:43-48` — entrypoint guard; exit non-zero only on throw
- `packages/code-reviewer/src/schemas/review.ts:4-17` — `ReviewFinding` (severity enum) + `ReviewSchema` (summary + findings), **no scores**
- `packages/code-reviewer/src/prompts/review.ts:8-17` — instructions (4 dimensions) + prompt builder
- `packages/code-reviewer/src/agent/reviewer.ts:27-50` — `createReviewAgent` / `reviewCode`, OpenRouter + `Output.object` (reusable)
- `packages/code-reviewer/src/config.ts:10,19-21,28-34,40-46` — `DEFAULT_MODEL`, `resolveModel`, `loadEnv`, `resolveApiKey`
- `packages/code-reviewer/package.json:2,8-11,14` — name `@10xcards/code-reviewer`, `tsx` scripts, Node `>=22.14.0`
- `package.json:5-7` — `workspaces: ["packages/*"]`
- `.github/workflows/ci.yml:11-18` — standard setup steps to mirror
- `.github/workflows/ci.yml:24-26` — secrets-as-env pattern
- `.github/workflows/ci.yml` (integration job) — sets `OPENROUTER_MOCK=true`, a var the reviewer does not yet read
- `context/changes/ci-cd-code-review/requirements.md:16-42` — the 7-criteria 1–10 rubric

## Architecture Insights

- **The seam is already cut.** The June-16 refactor deliberately split `index.ts`
  (side-effect-free barrel) from `cli.ts` (the only place `.env` loads) and exposed
  `createReviewAgent()` + `reviewCode()` as the stable public API. That seam is
  exactly what the CI wiring should build on: extend `cli.ts`'s entrypoint and the
  schema/prompt, leaving `agent/reviewer.ts`'s OpenRouter plumbing untouched.
- **Separation of duties for the workflow**: keep the LLM call inside the composite
  action (data-only — it reads the diff as text, never executes PR code) and keep
  comment/label side-effects in the calling workflow (where `GITHUB_TOKEN` and the
  verdict outputs live). This also keeps the token out of the composite action's
  untrusted-data path.
- **Lazy config resolution (commit 6247ce3)** means an `.env`/env `OPENROUTER_MODEL`
  override already works at call time — the workflow can set the model via env without
  code changes.

## Historical Context (from prior changes)

- `context/archive/2026-06-16-tool-loop-agent/plan.md:43-47` — **"What We're NOT
  Doing"** explicitly parked, for this CI/CD stage: the promptfoo eval env, agent
  tools, and _"a real diff/GitHub/CLI-flag pipeline — cli.ts keeps the existing
  hardcoded demo."_ The demo-only CLI is a known, deliberate deferral, not an
  oversight.
- `context/archive/2026-06-16-tool-loop-agent/` — the package was modularized here
  (config/schemas/prompts/agent/cli + barrel) on a `ToolLoopAgent` foundation;
  `reviews/impl-review.md` flagged the F1 model-override bug.
- Commit **6247ce3** `fix(code-reviewer): honor .env OPENROUTER_MODEL override (F1)` —
  made model resolution lazy (call-time) so an `.env` override loaded after import
  still applies.
- Commit **d74e976** `fix(ci): adopt npm workspaces so code-reviewer deps install in
CI` — added `workspaces: ["packages/*"]` so root `npm ci` installs the reviewer's
  deps; a prerequisite for any CI that invokes the package.

## Lessons applied (from `context/foundation/lessons.md`)

The two recorded lessons (lost-update on FSRS state; four flashcard endpoints leaning
on RLS alone) are app-domain, not CI — but the **second** is directly relevant to the
_Security_ criterion this reviewer scores: a useful AI review of any diff touching
`src/pages/api/flashcards/{index,[id],export}.ts` or the `flashcards` RLS policies
should specifically check for the missing app-layer `.eq("user_id", …)` defense and
flag changes to RLS policies as multi-endpoint security-critical. Worth seeding into
the reviewer's Security rubric / prompt as a project-specific heuristic.

## Open Questions

1. **`OPENROUTER_MOCK`** — is the mock consumed elsewhere (Astro vitest) today, or is
   it a latent expectation the reviewer must implement for cheap CI runs? (Area 6.)
2. **PR description cost tradeoff** — `requirements.md:9` flags including the PR body
   as a `?? cost tradeoff`. Include it by default (better context) or gate it behind a
   size/flag? Recommended: include but bound total prompt size.
3. **Threshold default** — confirm "fail if any criterion < 5" vs. a critical-floor
   hybrid (weight Security/Correctness higher). Recommended default: min-threshold < 5,
   tunable via `fail-threshold` input.
4. **Where does the verdict→exit-code mapping live** — CLI exit code, or JSON parsed
   by the workflow? Recommended: CLI emits JSON `{verdict,…}`; workflow reads it (so an
   API error is distinguishable from a "failed" review and can stay neutral).
5. **Fork PRs** — confirm "skip gracefully on `pull_request`, add
   `pull_request_target` later only if needed" is acceptable for this single-maintainer
   repo.

## Related Research

None prior for this change. Next step: `/10x-plan ci-cd-code-review` — the plan should
treat the **reviewer-package extension** (input layer, 7-criteria scored schema,
verdict, JSON output, mock mode) as the primary, highest-risk workstream, and the GHA
workflow + composite action as the secondary, lower-risk one built on the contract the
package extension defines.
