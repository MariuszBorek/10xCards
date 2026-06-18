# CI/CD AI PR Code Review Implementation Plan

## Overview

Introduce the project's first AI-driven CI/CD code-review workflow. Every pull
request to `main` is reviewed by an LLM against the 7 criteria defined in
`requirements.md` (each scored 1–10), receives a PR comment with the scores and
summary, and is labeled `ai-cr:passed` or `ai-cr:failed`. The review can be
re-run on demand by adding the `ai-cr:review` label.

The work splits into two workstreams:

1. **Reviewer-package extension (primary, higher-risk)** — turn
   `packages/code-reviewer` from a hardcoded demo into a CI-ready tool with a
   real input layer, a 7-criteria scored schema + in-schema verdict, JSON
   output, a deterministic mock mode, and unit tests.
2. **GitHub Actions wiring (secondary, lower-risk)** — a composite action that
   runs the reviewer (data-only LLM call) and a workflow that owns the
   PR-comment and label side-effects.

## Current State Analysis

The reviewer package today is a deliberate demo (parked as such in
`context/archive/2026-06-16-tool-loop-agent/plan.md:43-47`):

- **No usable input** — `cli.ts:32-38` reviews a hardcoded `divide(a,b)`
  snippet; `process.argv` is only used for the entrypoint guard
  (`cli.ts:43`). `reviewCode()` accepts `{ code, language?, model?, apiKey? }`
  only (`agent/reviewer.ts:8-17`).
- **No scoring** — `ReviewSchema = { summary, findings[] }` with a 5-value
  `severity` enum (`schemas/review.ts:4-17`). None of the 7 required criteria
  are scored; 3 of them ("Error handling", "Test coverage", "Consistency with
  conventions") appear nowhere in schema or prompt.
- **Human text only** — `printReview` (`cli.ts:13-25`) writes to stdout; no
  machine-readable JSON. The library `reviewCode()` does return a typed object,
  but the CLI never serializes it.
- **No verdict / always exits 0** — non-zero only on a thrown exception
  (`cli.ts:43-48`). No pass/fail signal.
- **No mock** — `OPENROUTER_MOCK` is **not read** by the reviewer
  (grep-confirmed). It _is_ consumed by the Astro app's generation service
  (`src/lib/services/generate.ts:26`) and its vitest suite, and the existing
  `ci.yml` integration job sets `OPENROUTER_MOCK=true` for that purpose — but
  the reviewer has no mock path of its own.

What is solid and reusable as-is:

- `agent/reviewer.ts` — OpenRouter provider + `ToolLoopAgent` + `Output.object`
  structured output. The schema it validates against is the only thing that
  changes; the plumbing stays.
- `config.ts` — lazy, call-time resolution of `OPENROUTER_API_KEY` /
  `OPENROUTER_MODEL` (`config.ts:19-21,40-46`); `.env` loaded only by the CLI
  via Node-22 `process.loadEnvFile()` (`config.ts:28-34`).
- The `tsx`/Node-22 runtime and npm-workspaces install — root `npm ci` already
  hoists the reviewer's deps incl. `tsx` (`package.json:5-7`, commit d74e976).

Repo conventions to match (`ci.yml`): `actions/checkout@v4` →
`actions/setup-node@v4` (`node-version: 22`, `cache: npm`) → `npm ci`; secrets
injected as step-level `env:` via `${{ secrets.X }}`; the repo standardizes on
**`main`** (requirements.md:3 says "master" — overridden to `main`). No
`ai-cr:*` labels exist yet.

## Desired End State

When this plan is complete:

- Opening or pushing to a PR targeting `main` triggers an AI review. Within the
  run, a single PR comment (marked with a hidden `<!-- ai-code-review -->`
  marker) shows the 7 criterion scores, the verdict, and the summary, and is
  **edited in place** on re-runs rather than duplicated.
- The PR carries exactly one of `ai-cr:passed` (green) / `ai-cr:failed` (red),
  with the opposite removed atomically.
- Adding the `ai-cr:review` label re-runs the review; the label is removed at
  the end of every run so it can be re-added to trigger again.
- A PR from a fork (no secrets) posts a neutral "skipped for fork PR" note and
  does **not** fail the check.
- An OpenRouter/API error produces a neutral "review unavailable" outcome (no
  pass/fail label), so outages don't block merges.
- `npx tsx packages/code-reviewer/src/cli.ts --title T --body B --diff-file f`
  prints machine-readable JSON `{ verdict, summary, scores }`; with
  `OPENROUTER_MOCK=true` it does so deterministically and offline.
- `npm test` covers the new CLI/schema/verdict logic via the mock path.

Verify: `npm test` green; a test PR to `main` shows the comment + correct label;
adding `ai-cr:review` re-runs and the label clears; a fork PR (or a run with the
secret unset) posts the skip note without failing.

### Key Discoveries:

- The June-16 refactor cut the exact seam this builds on: side-effect-free
  `index.ts` barrel vs. `cli.ts` as the only `.env` loader; `createReviewAgent()`
  / `reviewCode()` are the stable API (`research.md:288-292`). Extend `cli.ts`,
  `schemas/review.ts`, `prompts/review.ts`; leave `agent/reviewer.ts` plumbing
  untouched.
- Lazy model resolution (commit 6247ce3) means the workflow can set the model
  via `OPENROUTER_MODEL` env with no code change.
- `OPENROUTER_MOCK` is an app/vitest convention, not a reviewer feature — the
  reviewer needs its **own** mock path (`research.md:259-268`, grep-confirmed).
- Composite-action hard constraints: every `run` needs `shell: bash`; **no
  `secrets` context** inside the action (pass secrets + `GITHUB_TOKEN` as
  `inputs`); reference `${{ inputs.x }}`; multi-line `$GITHUB_OUTPUT` uses the
  `<<__EOF__` heredoc form (`research.md:169-181`).
- The `ai-cr:review` retry trap: the `labeled` trigger fires on the _add
  transition_, so the workflow **must** `--remove-label ai-cr:review` at the end
  of every run or re-triggering becomes impossible (`research.md:212-214`).
- Pass the diff via a **file** (`--diff-file`), not an inline arg, to dodge
  arg-length/escaping limits; pull it with `gh pr diff <n>` to sidestep the
  fork/shallow-checkout `git merge-base` gotcha (`research.md:179-187`).
- Project security heuristic to seed into the rubric: changes to
  `src/pages/api/flashcards/{index,[id],export}.ts` or the `flashcards` RLS
  policies should be flagged for the missing app-layer `.eq("user_id", …)`
  defense (`research.md:319-327`, from `context/foundation/lessons.md`).

## What We're NOT Doing

- **No `pull_request_target`** — fork PRs skip gracefully on `pull_request`. A
  fork-review path can be added later, gated on `ai-cr:review`, only if wanted.
- **No "business alignment" / "architectural fit" criteria** — explicitly
  parked in `requirements.md:44-47` (need broader context).
- **No multi-model / ensemble review, no streaming, no auto-fix** — single
  model call, structured output, comment + label only.
- **No changes to the existing `ci.yml`** (quality + integration jobs) — the AI
  review is a new, separate workflow file.
- **No removal of the existing `npm run dev` demo behavior beyond what the new
  argv interface requires** — when invoked with no args, the CLI may keep a
  demo/usage fallback, but the CI path uses explicit flags.
- **No threshold math in the CLI as the source of truth** — per decision, the
  `verdict` is an LLM-filled schema field driven by the rubric; the CLI only
  _warns_ on inconsistency, it does not override.

## Implementation Approach

Build the package contract first (schema → prompt → CLI/mock → tests), because
the composite action and workflow both depend on the CLI's flag interface and
JSON output shape. Then layer the GHA mechanics on top of that frozen contract.

The verdict design reconciles two decisions — "LLM returns verdict in schema"
and "min-threshold: fail if any criterion < 5" — by **encoding the min-threshold
rule in the prompt rubric**: the model fills a `verdict` field and is instructed
to set it to `"failed"` if any of the 7 scores is below 5, else `"passed"`. The
CLI recomputes the min-threshold result from the returned scores purely as a
**consistency guard** (logs a warning to stderr if the model's `verdict`
contradicts its own scores) — it does not change the emitted verdict. This keeps
the schema authoritative while making the gate rule explicit and auditable.

Separation of duties for the workflow (`research.md:293-297`): the **composite
action** does the data-only LLM call (reads the diff as text, never executes PR
code, no `GITHUB_TOKEN`); the **calling workflow** owns the comment + label
side-effects where the token and verdict outputs live.

## Critical Implementation Details

- **Verdict/threshold reconciliation** — the `verdict` schema field is filled by
  the LLM per a min-threshold rule stated in the prompt ("fail if any criterion
  < 5"). The CLI's recompute-from-scores is a stderr warning only, never an
  override. Treat a missing/unparseable result (API error, mock disabled with no
  key) as a third, _neutral_ outcome — not `failed` — so the workflow can skip
  labeling rather than red-flag a healthy PR.
- **Diff/prompt size guard** — assemble the prompt as title + body + diff, but
  cap the total characters (a named constant) and truncate the diff (with a
  clear `…[truncated]` marker) when over budget, so a huge PR can't blow up token
  cost. The guard lives in the CLI/prompt-assembly layer so it is unit-testable.
- **`ai-cr:review` removal is mandatory and must run even on failure** — place
  the `--remove-label ai-cr:review` step so it executes regardless of review
  outcome (e.g. `if: always()` on that step), or the retry path dies.
- **Composite action constraints** — `shell: bash` on every `run`; no `secrets`
  context (inputs only); `<<__EOF__` heredoc for multi-line `$GITHUB_OUTPUT`.

## Phase 1: Scored Schema + Rubric Prompt

### Overview

Replace the severity-finding model with the 7-criteria scored model and an
in-schema verdict, and rewrite the prompt to carry the full 1–10 rubric, the
min-threshold rule, and the project security heuristic. This is the contract the
rest of the plan builds on.

### Changes Required:

#### 1. Review schema

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Replace the finding/severity shape with a criterion-scored shape so
the structured-output call returns the 7 scores, a summary, and an LLM-filled
verdict.

**Contract**: New `ReviewSchema` shape — a `scores` object with one integer
field per criterion constrained to 1–10, a `summary` string, and a
`verdict: "passed" | "failed"` enum. The 7 score keys are the criteria from
`requirements.md:16-42`: `correctness`, `security`, `errorHandling`,
`readability`, `testCoverage`, `performance`, `consistency`. Use
`z.number().int().min(1).max(10)` per score with a `.describe()` carrying that
criterion's 1/10-vs-10/10 anchors. Keep `Review` exported from the barrel.
Decide whether to retain an optional `findings[]` array for richer comments
(allowed but not required) — default to dropping it to keep the contract tight;
if kept, make it optional so the prompt isn't forced to produce it.

#### 2. Reviewer prompt + instructions

**File**: `packages/code-reviewer/src/prompts/review.ts`

**Intent**: Replace the 4-word focus list with the full 7-criteria 1–10 rubric,
state the min-threshold verdict rule, seed the project security heuristic, and
build a prompt from PR title + body + diff (not a bare code block).

**Contract**: `REVIEW_INSTRUCTIONS` quotes the 7 criteria and their 1/10–10/10
anchors from `requirements.md:16-42`, instructs the model to return an integer
1–10 per criterion, and states the verdict rule verbatim: _set `verdict` to
`"failed"` if any criterion scores below 5, otherwise `"passed"`._ Add the
project heuristic: flag diffs touching `src/pages/api/flashcards/{index,[id],
export}.ts` or the `flashcards` RLS policies for the missing app-layer
`.eq("user_id", …)` defense under the Security criterion. Replace
`buildReviewPrompt(code, language?)` with a builder that takes
`{ title, body, diff }` (and applies the size guard from Phase 2, or accepts an
already-bounded string — pick one and keep the seam clean). Keep wording reusable
for a future eval.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The schema module exports a `ReviewSchema` whose parse accepts a valid
  7-score + verdict object and rejects an out-of-range score (asserted by a
  Phase 3 test, but the schema must support it).

#### Manual Verification:

- The prompt text, read end-to-end, contains all 7 criteria with their 1–10
  anchors and the explicit min-threshold verdict rule.

---

## Phase 2: CLI Input/Output + Mock Mode

### Overview

Give the CLI a real flag interface, machine-readable JSON output, a deterministic
`OPENROUTER_MOCK` path, the prompt-size guard, and the verdict-vs-scores
consistency warning.

### Changes Required:

#### 1. CLI argv + JSON output

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Parse `--title`, `--body`, `--diff-file` and emit
machine-readable JSON the workflow can consume, replacing the hardcoded demo.

**Contract**: `main()` parses `--title <s>`, `--body <s>` (default `""`),
`--diff-file <path>` (read the file's contents as the diff). Calls a review
function with `{ title, body, diff }`, then writes a single JSON object
`{ verdict, summary, scores }` to stdout (the only thing on stdout; human/debug
logging goes to stderr). On an API/LLM error, emit a JSON object with a neutral
marker (e.g. `{ verdict: null, error: <message> }`) and a distinct exit
behavior the workflow can read — do **not** print a `failed` verdict for an
infra error. Preserve the entrypoint guard (`import.meta.url === ...`). A no-arg
invocation may fall back to a usage message or the demo (non-CI path).

#### 2. Review entry accepting PR context

**File**: `packages/code-reviewer/src/agent/reviewer.ts`

**Intent**: Accept PR title/body/diff (not a bare `code` string) and route
through the mock path when enabled, keeping the OpenRouter plumbing otherwise
untouched.

**Contract**: Extend `ReviewCodeOptions` (or add a sibling
`reviewPullRequest({ title, body, diff, model?, apiKey? })`) that builds the
prompt via the Phase 1 builder and returns the new `Review`. When mock mode is
active (see #3), short-circuit before `createReviewAgent()` and return a fixed,
schema-valid `Review`. `createReviewAgent` / `Output.object` wiring is unchanged.

#### 3. Mock mode + config

**File**: `packages/code-reviewer/src/config.ts` (and a small fixture, e.g.
`packages/code-reviewer/src/agent/mock-review.ts`)

**Intent**: Add a reviewer-owned `OPENROUTER_MOCK` toggle and a canned `Review`
so the CLI runs deterministically and offline without an API key.

**Contract**: A `resolveMock()` (or `isMockEnabled()`) reading
`process.env.OPENROUTER_MOCK === "true"`, read at call time like the other
resolvers. When mock is on, the review path returns a fixed valid `Review`
(all scores ≥ 5 → `verdict: "passed"` by default; consider a deterministic
"diff contains FAIL_MARKER → failed" rule to make the failed branch testable)
**without** calling `resolveApiKey()` (so no key is required in mock).

#### 4. Prompt size guard + verdict consistency warning

**File**: `packages/code-reviewer/src/prompts/review.ts` and/or `cli.ts`

**Intent**: Bound total prompt size and warn (without overriding) when the
model's verdict disagrees with the min-threshold rule applied to its own scores.

**Contract**: A `MAX_PROMPT_CHARS` constant; when title+body+diff exceeds it,
truncate the diff with a visible `…[truncated]` marker (truncate the diff, not
the title/body). A pure helper `deriveVerdict(scores)` returns `"failed"` if any
score < 5 else `"passed"`; the CLI compares it to the returned `verdict` and
writes a stderr warning on mismatch — the emitted verdict stays the LLM's.

#### 5. Barrel export

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Export any new public functions (e.g. `reviewPullRequest`,
`deriveVerdict`) and the updated types while keeping the barrel side-effect-free.

**Contract**: Add named exports; no `.env` load, no execution at import.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Mock CLI run emits valid JSON:
  `OPENROUTER_MOCK=true npx tsx packages/code-reviewer/src/cli.ts --title "t" --body "b" --diff-file <sample.diff>` prints a single parseable
  `{ verdict, summary, scores }` object and exits 0 with no API key set.

#### Manual Verification:

- Running the mock CLI against a sample diff that includes the failed-branch
  marker yields `verdict: "failed"`; a clean diff yields `"passed"`.
- stdout contains only JSON (logging confirmed on stderr).

**Implementation Note**: After this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 3: Vitest Unit Tests

### Overview

Lock the CLI/schema/verdict contract the workflow depends on, all via the mock
path (no live API), in the existing vitest suite.

### Changes Required:

#### 1. Reviewer unit tests

**File**: `test/code-reviewer/*.test.ts` (mirror the existing
`test/generation/*` layout and its `vi.hoisted` env-mock pattern)

**Intent**: Cover argv parsing, prompt assembly + size guard, JSON output shape,
mock determinism, and verdict/min-threshold consistency.

**Contract**: Tests assert: (a) `ReviewSchema` accepts a valid 7-score+verdict
object and rejects out-of-range / missing scores; (b) `buildReviewPrompt`
includes title, body, and diff, and truncates the diff past `MAX_PROMPT_CHARS`
with the marker; (c) `deriveVerdict` returns `failed` iff any score < 5; (d) the
mock review path returns a valid `Review` with no API key and is deterministic;
(e) the CLI emits a single parseable JSON object to stdout and routes
warnings/logs to stderr. Use `OPENROUTER_MOCK` via the same hoisted-getter
pattern as `test/generation/generate-route.test.ts:13-19`. Confirm whether these
tests are picked up by the root `vitest` config (`npm test`); if the config
scopes `test/` only, ensure the new path is included.

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Test names read as a clear contract spec for the CLI/JSON interface.

---

## Phase 4: Composite Action

### Overview

A composite action that installs deps, runs the reviewer CLI against the PR diff
(data-only LLM call), and exposes the verdict/scores/summary as step outputs for
the workflow to act on.

### Changes Required:

#### 1. AI review composite action

**File**: `.github/actions/ai-review/action.yml`

**Intent**: Encapsulate the review execution so the calling workflow stays easy
to reason about (per `requirements.md:4`).

**Contract**: `runs.using: "composite"`. Declared `inputs`: `openrouter-api-key`
(required-ish — empty means skip), `diff-file`, `pr-title`, `pr-body`, optional
`model`. Steps (each `run` with `shell: bash`): run the CLI
(`npx tsx packages/code-reviewer/src/cli.ts --title … --body … --diff-file …`)
with `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` from inputs as step `env`; capture
its JSON; parse `verdict`, `summary`, `scores` into `$GITHUB_OUTPUT` using the
`<<__EOF__` heredoc form for the multi-line summary/scores. If the api-key input
is empty, set an output flag (e.g. `skipped=true`) and exit 0 without calling the
CLI. No `secrets` context, no `permissions` block, no `runs`-level `if`. Assumes
the caller has already run checkout + setup-node + `npm ci`.

### Success Criteria:

#### Automated Verification:

- Action YAML is syntactically valid (parses; e.g. `actionlint` if available, or
  it loads in a workflow run).

#### Manual Verification:

- On a real same-repo PR, the action step produces non-empty `verdict` and
  `summary` outputs visible in the run log.
- With the api-key input blank, the action sets `skipped=true` and exits 0.

---

## Phase 5: Workflow + Side-Effects

### Overview

The calling workflow: triggers + labeled-event guard, least-privilege
permissions, concurrency, diff retrieval, invoke the composite action, then the
idempotent PR comment and label side-effects, with graceful fork handling.

### Changes Required:

#### 1. AI code-review workflow

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Run the AI review on every PR to `main` and on the `ai-cr:review`
label, and own all comment/label side-effects.

**Contract**:

- **Triggers**: `pull_request` with `types: [opened, synchronize, reopened,
labeled]`, `branches: [main]`.
- **Job guard**: `if: github.event.action != 'labeled' ||
github.event.label.name == 'ai-cr:review'` (run unless it's a `labeled` event
  for some other label).
- **Permissions** (job-level, least privilege): `contents: read`,
  `pull-requests: write`, `issues: write`.
- **Concurrency**: `group: ai-review-${{ github.event.pull_request.number }}`,
  `cancel-in-progress: true`.
- **Setup**: `actions/checkout@v4` → `actions/setup-node@v4` (`node-version: 22`,
  `cache: npm`) → `npm ci` (mirror `ci.yml:13-18`).
- **Diff + metadata**: title/body from `github.event.pull_request.title` / `.body`
  (default body to `""`); diff via `gh pr diff <number> --repo <repo> > pr.diff`
  (`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`).
- **Invoke action**: `uses: ./.github/actions/ai-review` passing
  `openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}`, `diff-file: pr.diff`,
  title/body, optional model.
- **Fork skip**: when the action reports `skipped=true` (empty key), post a
  neutral "AI review skipped for fork PR (no secrets available)" comment and end
  the job successfully — no label.
- **Idempotent comment**: `peter-evans/find-comment@v3` (search marker
  `<!-- ai-code-review -->`) → `peter-evans/create-or-update-comment@v4`
  (`edit-mode: replace`) rendering verdict + 7 scores + summary; zero-dep
  fallback is `actions/github-script@v7` (`listComments` →
  `updateComment`|`createComment`).
- **Labels**: ensure they exist —
  `gh label create "ai-cr:passed" --color 2EA043 --force`,
  `"ai-cr:failed" --color D73A49 --force`,
  `"ai-cr:review" --color 0969DA --force`; then apply the verdict and remove the
  opposite atomically:
  `gh pr edit "$PR" --add-label ai-cr:passed --remove-label ai-cr:failed`
  (and vice-versa). On a **neutral** outcome (API error / `verdict: null`), skip
  labeling and note "review unavailable" in the comment.
- **Clear retry label**: a step that **always** runs
  (`if: always()`) `gh pr edit "$PR" --remove-label ai-cr:review` so the label
  can be re-added to trigger another run.

#### 2. Secrets / branch note

**File**: `README.md` (CI section)

**Intent**: Document the new `OPENROUTER_API_KEY` repo secret and the AI-review
workflow so a fresh clone/maintainer knows the setup.

**Contract**: A short paragraph under the existing CI section: add
`OPENROUTER_API_KEY` as a repository secret; describe the `ai-cr:*` labels and
the `ai-cr:review` retry trigger; note fork PRs are skipped.

### Success Criteria:

#### Automated Verification:

- Workflow YAML parses (e.g. `actionlint` if available).
- `npm run typecheck` / `npm run lint` still pass (no app regressions).

#### Manual Verification:

- A test PR to `main` triggers the workflow; a single comment with 7 scores +
  verdict + summary appears, and the PR gets exactly one of
  `ai-cr:passed`/`ai-cr:failed`.
- Pushing a new commit edits the same comment in place (no duplicate).
- Adding `ai-cr:review` re-runs the review; afterward the `ai-cr:review` label is
  gone.
- A fork PR (or a run with `OPENROUTER_API_KEY` unset) posts the skip note and
  the check stays green.
- Forcing an API error yields a neutral "review unavailable" comment with no
  pass/fail label.

**Implementation Note**: This phase's manual verification needs a real PR; run it
on a throwaway branch/PR before considering the change done.

---

## Testing Strategy

### Unit Tests (Phase 3, via mock):

- `ReviewSchema` validation: accepts valid 7-score+verdict; rejects
  out-of-range / missing scores.
- `buildReviewPrompt`: includes title/body/diff; truncates diff past
  `MAX_PROMPT_CHARS` with marker.
- `deriveVerdict`: `failed` iff any score < 5.
- Mock review path: deterministic, valid `Review`, no API key needed.
- CLI: single JSON object on stdout, logs on stderr.

### Integration / Manual (Phases 4–5):

- End-to-end on a real same-repo PR: comment + label + in-place edit + retry +
  fork-skip + API-error-neutral, per the Phase 5 manual criteria.

### Manual Testing Steps:

1. Open a throwaway PR to `main` with a small clean diff → expect `ai-cr:passed`
   - a scored comment.
2. Push a second commit → expect the same comment edited, not duplicated.
3. Add a deliberately bad change (or the mock fail-marker) → expect
   `ai-cr:failed`.
4. Add the `ai-cr:review` label → expect a re-run, then the label removed.
5. Unset/blank the secret (or open from a fork) → expect the skip note, green
   check.

## Performance Considerations

- The prompt size guard (`MAX_PROMPT_CHARS`) bounds per-review token cost.
- `concurrency.cancel-in-progress` ensures rapid pushes only review the latest
  diff, saving API spend and avoiding races on the single comment/labels.
- `gh pr diff` pulls the server-computed diff (one API call) rather than a full
  history fetch.

## Migration Notes

- No data migration. New workflow file is additive; `ci.yml` is untouched.
- One new repo secret required: `OPENROUTER_API_KEY`. Without it, every PR
  review skips gracefully (no failures), so the workflow is safe to merge before
  the secret is configured.

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Research: `context/changes/ci-cd-code-review/research.md`
- Reusable agent plumbing: `packages/code-reviewer/src/agent/reviewer.ts:27-50`
- Config resolution: `packages/code-reviewer/src/config.ts:19-46`
- Mock/test pattern to mirror: `test/generation/generate-route.test.ts:13-19`,
  `src/lib/services/generate.ts:26`
- Setup steps to mirror: `.github/workflows/ci.yml:11-26`
- Prior deferral of the demo CLI:
  `context/archive/2026-06-16-tool-loop-agent/plan.md:43-47`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scored Schema + Rubric Prompt

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 1847dac
- [x] 1.2 Linting passes: `npm run lint` — 1847dac
- [x] 1.3 `ReviewSchema` accepts valid 7-score+verdict and rejects out-of-range score — 1847dac

#### Manual

- [x] 1.4 Prompt contains all 7 criteria with 1–10 anchors + explicit min-threshold verdict rule — 1847dac

### Phase 2: CLI Input/Output + Mock Mode

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — c3fb5a1
- [x] 2.2 Linting passes: `npm run lint` — c3fb5a1
- [x] 2.3 Mock CLI run emits a single parseable `{ verdict, summary, scores }` and exits 0 with no API key — c3fb5a1

#### Manual

- [x] 2.4 Fail-marker diff → `verdict: "failed"`; clean diff → `"passed"` — c3fb5a1
- [x] 2.5 stdout contains only JSON (logging on stderr) — c3fb5a1

### Phase 3: Vitest Unit Tests

#### Automated

- [x] 3.1 All tests pass: `npm test` — b4d9c87
- [x] 3.2 Type checking passes: `npm run typecheck` — b4d9c87
- [x] 3.3 Linting passes: `npm run lint` — b4d9c87

#### Manual

- [x] 3.4 Test names read as a clear contract spec for the CLI/JSON interface — b4d9c87

### Phase 4: Composite Action

#### Automated

- [x] 4.1 Action YAML is syntactically valid — d3780d1

#### Manual

- [ ] 4.2 On a real same-repo PR, the action produces non-empty `verdict`/`summary` outputs
- [ ] 4.3 With blank api-key input, the action sets `skipped=true` and exits 0

### Phase 5: Workflow + Side-Effects

#### Automated

- [x] 5.1 Workflow YAML parses
- [x] 5.2 `npm run typecheck` / `npm run lint` still pass

#### Manual

- [ ] 5.3 Test PR to `main`: single comment with 7 scores + verdict + summary; exactly one of `ai-cr:passed`/`ai-cr:failed`
- [ ] 5.4 New commit edits the same comment in place (no duplicate)
- [ ] 5.5 Adding `ai-cr:review` re-runs; afterward `ai-cr:review` is removed
- [ ] 5.6 Fork PR / unset secret posts skip note, check stays green
- [ ] 5.7 Forced API error → neutral "review unavailable" comment, no pass/fail label
