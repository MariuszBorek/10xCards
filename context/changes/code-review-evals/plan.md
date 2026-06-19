# Introduce promptfoo for the Code Reviewer — Implementation Plan

## Overview

Stand up a **first promptfoo eval configuration inside `packages/code-reviewer`** that runs the _same_ production review prompt across **three OpenRouter models** against **one golden fixture**: a React 16 → 19+ component-migration diff with three planted, criterion-distinct flaws. Each model's review is checked two ways — a **deterministic assertion** (the review must `fail` for the right reasons) and a **g-eval LLM-judge** (did the review actually identify each planted flaw). No production code in the package changes; the eval wraps the existing public API.

## Current State Analysis

The package is already eval-ready (full detail in `context/changes/code-review-evals/research.md`):

- `reviewPullRequest({ title, body, diff, model })` is a pure function with an **injectable `model`** that flows straight to the OpenRouter provider (`packages/code-reviewer/src/agent/reviewer.ts:42-54,90-106`). Running the same prompt across models = calling it three times with different `model`.
- The public barrel is **side-effect-free** (`packages/code-reviewer/src/index.ts:1-29`); `loadEnv()` is called only by an entrypoint (`src/cli.ts:110`), never at import (`src/config.ts:38-44`).
- Output is `{ scores (7×1–10), summary, verdict }` validated by `ReviewSchema` (`src/schemas/review.ts:90-94`). **There is no per-flaw findings list** — the judge grades the summary + scores, not an enumerated issue list (decided: judge as-is, no schema change).
- A deterministic offline mock (`OPENROUTER_MOCK=true` → `buildMockReview`, `src/agent/mock-review.ts:37-50`) returns `failed` only when the diff contains `FAIL_MARKER`.
- Tests already import the package as `@10xcards/code-reviewer` under Vitest (`test/code-reviewer/review-prompt.test.ts:1-8`); workspace resolution works.

**Known constraint — Node version:** current promptfoo requires `^20.20.0 || >=22.22.0`; the repo's `.nvmrc` pins **22.14.0** (below the floor). The eval is **local-only** for now and documented as needing Node ≥ 22.22.0; `.nvmrc` and CI are left untouched (decided).

## Desired End State

From `packages/code-reviewer/`, running `npm run eval` (with `OPENROUTER_API_KEY` set and Node ≥ 22.22.0) evaluates the one golden React-migration fixture against `z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, and `anthropic/claude-sonnet-4.6`, and prints a per-model pass/fail matrix where:

- the **deterministic assertion** passes only when a model returns `verdict: "failed"` AND scores `security < 5`, `correctness < 5`, and (`errorHandling < 5` OR `performance < 5`) — i.e. it failed _for the planted reasons_; and
- the **g-eval judge** reports, per model, how many of the three planted flaws the review identified.

`promptfoo view` renders the side-by-side comparison. The package README documents the prereq and usage.

### Key Discoveries:

- **Model comparison runs _inside_ our agent, not promptfoo's provider layer.** promptfoo only sees input/output; the matrix is achieved by passing each provider entry's `config.model` into `reviewPullRequest({ model })`. (`src/agent/reviewer.ts:42-54`)
- **Class-form custom provider gives unambiguous per-provider config.** promptfoo passes a provider's `config` block to a class provider's constructor (`https://www.promptfoo.dev/docs/providers/custom-api`), so each of the three provider entries can carry a distinct `config.model`.
- **Return the Review as a JSON string**, not an object — then deterministic `javascript` assertions use `JSON.parse(output)` and the g-eval grader reads the full review text, both per the documented JSON-eval pattern (`https://www.promptfoo.dev/docs/guides/evaluate-json`).
- **The eval provider is an entrypoint** (like `cli.ts`) — it may call `loadEnv()` at import; the barrel stays side-effect-free.

## What We're NOT Doing

- **No production code change** to the reviewer — no new schema fields, no `findings[]` list, no prompt edits.
- **No CI / GitHub Actions** eval job; no change to `.github/workflows/ai-code-review.yml`.
- **No `.nvmrc` bump** and no repo-wide Node change.
- **No second/third fixture** — exactly one golden React 16→19 diff with three flaws.
- **No red-teaming, dataset files, or model-cost tuning** beyond this first config.
- **No switch of the production default model** — the eval informs that decision later; it doesn't make it.

## Implementation Approach

Wrap the existing public API in a thin promptfoo **class provider** that reads `config.model` and forwards `{ title, body, diff, model }` to `reviewPullRequest`, returning the review as a JSON string. Declare the three models as three provider entries sharing that file with distinct `config.model` + `label`. Define one test case whose `diff` var is loaded from a fixture file, and attach the deterministic + g-eval assertions to it. Validate plumbing offline with a mock-based Vitest test and `promptfoo validate`; the real flaw-detection results come from a live 3-model run (manual).

## Critical Implementation Details

- **Mock mode cannot green the flaw assertions.** `OPENROUTER_MOCK=true` returns `failed` only when the diff contains `FAIL_MARKER`; the golden fixture deliberately does not. So a mock run would _fail_ the `verdict=failed` assertion. Therefore: use mock only to verify provider **wiring** (Vitest: vars forwarded, valid `Review` JSON returned), and treat the real flaw-detection assertions as a **live run** under Manual Verification. Do not add `FAIL_MARKER` to the fixture.
- **Env loading.** The provider must ensure `OPENROUTER_API_KEY` is in `process.env` — call the package's `loadEnv()` at provider-module import (mirrors `cli.ts`), and run the eval from `packages/code-reviewer/` where its `.env` lives. The g-eval grader (`openrouter:…`) reads the same env var.
- **Same model id end-to-end.** The OpenRouter slugs (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, `anthropic/claude-sonnet-4.6`) are passed verbatim into `openrouter(model)`; no translation. If a slug is unavailable at run time, that surfaces as a per-model error in the matrix, not a config error.

## Phase 1: Scaffold promptfoo + custom provider

### Overview

Add promptfoo to the package, write the wrapping provider and the base config with the three-model matrix, and guard the wiring with an offline mock test. After this phase the matrix runs end-to-end (shape only); the fixture and assertions come next.

### Changes Required:

#### 1. Package manifest — dependency + scripts

**File**: `packages/code-reviewer/package.json`

**Intent**: Make promptfoo available and give a one-command entrypoint to run/inspect the eval.

**Contract**: Add `promptfoo` to `devDependencies`. Add scripts `"eval": "promptfoo eval -c promptfooconfig.yaml"` and `"eval:view": "promptfoo view"`. No change to `engines` (Node floor is documented, not enforced here).

#### 2. Ignore promptfoo artifacts

**File**: `packages/code-reviewer/.gitignore`

**Intent**: Keep the local eval cache/output out of git.

**Contract**: Add the promptfoo cache/output paths (e.g. `.promptfoo/`, `output/`, `promptfoo-*.json`).

#### 3. Custom provider wrapping the reviewer

**File**: `packages/code-reviewer/eval/review-provider.ts`

**Intent**: Adapt the production reviewer to promptfoo's provider interface so the same prompt can be driven per-model from `config`, with output shaped for both deterministic and judge assertions.

**Contract**: Default-export a class implementing promptfoo's `ApiProvider` (`id()` + `callApi(prompt, context, options)`). The constructor receives `{ id, config }`; capture `config.model`. `callApi` reads `title`/`body`/`diff` from `context.vars`, calls `reviewPullRequest({ title, body, diff, model })`, and returns `{ output: JSON.stringify(review) }`; on throw, return `{ error: <message> }`. Call the package's `loadEnv()` once at module import. Imports come from `@10xcards/code-reviewer` (or relative `../src/index.ts`).

```ts
// signature promptfoo calls (reference only — implementer writes the body):
// class ReviewProvider implements ApiProvider {
//   constructor(options: { id?: string; config: { model?: string } })
//   id(): string
//   callApi(prompt, context, options): Promise<{ output?: string; error?: string }>
// }
```

#### 4. Base promptfoo config with the 3-model matrix

**File**: `packages/code-reviewer/promptfooconfig.yaml`

**Intent**: Declare the three models as three provider entries over the one wrapper, with a placeholder test case to be filled in Phase 2–3.

**Contract**: `providers` = three entries, each `id: file://./eval/review-provider.ts` with a distinct `label` (`glm-5.1`, `deepseek-v4-flash`, `sonnet-4.6`) and `config.model` set to the matching OpenRouter slug. A passthrough `prompts` entry (e.g. `"{{diff}}"`) since the provider builds its own prompt internally. One placeholder `tests` entry (real vars/asserts land in later phases).

#### 5. Offline wiring test for the provider

**File**: `test/code-reviewer/review-provider.test.ts`

**Intent**: Lock the provider glue (vars forwarded, model threaded, valid `Review` JSON out) without network or key, reusing the repo's mock pattern.

**Contract**: With `OPENROUTER_MOCK=true`, instantiate the provider with a `config.model`, call `callApi` with `vars` for a diff, and assert the returned `output` parses to a schema-valid `Review`; assert a diff containing `MOCK_FAIL_MARKER` yields `verdict: "failed"`. Vitest, under the existing `test/**` glob.

#### 6. README prereq + eval note

**File**: `packages/code-reviewer/README.md`

**Intent**: Record the Node ≥ 22.22.0 requirement and the eval command so a reader can run it.

**Contract**: A short "Evals (promptfoo)" section: prereq (Node ≥ 22.22.0, `OPENROUTER_API_KEY`), `npm run eval`, `npm run eval:view`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm --workspace @10xcards/code-reviewer run typecheck`
- Provider wiring test passes: `npm test -- review-provider`
- Config validates: `cd packages/code-reviewer && npx promptfoo validate -c promptfooconfig.yaml`
- Lint passes: `npm run lint`

#### Manual Verification:

- `cd packages/code-reviewer && OPENROUTER_MOCK=true npm run eval` runs the 3-provider matrix end-to-end without crashing (output shape only; assertions not yet meaningful).
- `npx promptfoo@latest --version` reports a version that runs under the active Node (≥ 22.22.0).

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 2.

---

## Phase 2: Golden fixture — React 16→19 diff with three planted flaws

### Overview

Author the single complex migration diff and wire it into the test case as the `diff` var.

### Changes Required:

#### 1. The flawed migration fixture

**File**: `packages/code-reviewer/eval/fixtures/react16-to-19.diff`

**Intent**: A realistic, "rather complex" class-component → function-component-with-hooks migration (React 16 → 19+: `ReactDOM.render`→`createRoot`, lifecycle→hooks) that embeds three impactful, criterion-distinct flaws so the eval has unambiguous ground truth.

**Contract**: A unified diff (~80–150 lines) containing exactly these three planted flaws, each mapping to a different review criterion:

1. **Security (XSS):** renders an unsanitized user-controlled value via `dangerouslySetInnerHTML={{ __html: … }}`.
2. **Correctness (stale closure):** a `useEffect` whose callback closes over a prop/state value omitted from its dependency array, so it operates on stale data.
3. **Error handling / performance (leaked subscription):** a `useEffect` that registers a listener/subscription (e.g. `window.addEventListener`, `setInterval`) with **no cleanup return**, leaking it on unmount/re-run.
   The surrounding migration must read as genuine (createRoot adoption, class→hooks) so the flaws aren't obvious scaffolding. Must NOT contain `FAIL_MARKER`.

#### 2. Wire the fixture into the test case

**File**: `packages/code-reviewer/promptfooconfig.yaml`

**Intent**: Feed the fixture and PR framing to every provider.

**Contract**: Replace the placeholder test with one `tests` entry whose `vars` set `title`, `body`, and `diff: file://eval/fixtures/react16-to-19.diff`.

### Success Criteria:

#### Automated Verification:

- Config still validates: `cd packages/code-reviewer && npx promptfoo validate -c promptfooconfig.yaml`
- Fixture exists and is non-trivial: `test "$(grep -c '' packages/code-reviewer/eval/fixtures/react16-to-19.diff)" -ge 80`

#### Manual Verification:

- Read the diff: all three flaws are present, each mapping to its intended criterion, and the React 19 migration framing reads naturally (flaws aren't telegraphed).
- The fixture contains no `FAIL_MARKER`.

**Implementation Note**: Pause for human confirmation that the three flaws are correct and well-disguised before Phase 3.

---

## Phase 3: Assertions — deterministic failure + g-eval judge

### Overview

Attach the two assertion families to the test case: a deterministic "failed for the right reasons" check and the per-flaw LLM judge.

### Changes Required:

#### 1. Deterministic failure assertions

**File**: `packages/code-reviewer/promptfooconfig.yaml`

**Intent**: Assert the review actually fails _and_ penalizes the three planted criteria — catching a model that fails for unrelated reasons.

**Contract**: On the test case `assert`, add `javascript`-type assertions over `JSON.parse(output)`: `verdict === 'failed'`; `scores.security < 5`; `scores.correctness < 5`; `(scores.errorHandling < 5 || scores.performance < 5)`. (Equivalently a single combined `javascript` assertion returning a boolean.)

#### 2. g-eval flaw-identification judge

**File**: `packages/code-reviewer/promptfooconfig.yaml`

**Intent**: Verify the review _names/identifies_ each planted flaw, with per-criterion partial credit.

**Contract**: Add a `g-eval` assertion whose `value` is three criteria — one per planted flaw — each phrased as "the review identifies or penalizes <flaw>" (XSS via dangerouslySetInnerHTML; the stale-closure/missing-dependency bug; the missing-cleanup subscription leak). Set `provider: { id: openrouter:anthropic/claude-sonnet-4.6, config: { temperature: 0 } }` and a `threshold` (start at `0.67` ≈ 2-of-3; tunable). g-eval averages the per-criterion scores before the threshold check.

```yaml
# shape (reference):
# assert:
#   - type: javascript
#     value: |
#       const r = JSON.parse(output);
#       return r.verdict === 'failed' && r.scores.security < 5 && r.scores.correctness < 5
#         && (r.scores.errorHandling < 5 || r.scores.performance < 5);
#   - type: g-eval
#     threshold: 0.67
#     value:
#       - "Identifies/penalizes the XSS from unsanitized dangerouslySetInnerHTML"
#       - "Identifies/penalizes the stale-closure bug (value missing from useEffect deps)"
#       - "Identifies/penalizes the leaked subscription (useEffect with no cleanup)"
#     provider:
#       id: openrouter:anthropic/claude-sonnet-4.6
#       config: { temperature: 0 }
```

### Success Criteria:

#### Automated Verification:

- Config with assertions validates: `cd packages/code-reviewer && npx promptfoo validate -c promptfooconfig.yaml`
- Type checking still passes: `npm --workspace @10xcards/code-reviewer run typecheck`

#### Manual Verification:

- The deterministic assertion's four conditions match the three planted criteria (security, correctness, errorHandling|performance) and the failed verdict.
- The three g-eval criteria each correspond to one planted flaw; grader is `openrouter:anthropic/claude-sonnet-4.6` at temperature 0.

**Implementation Note**: Pause for human confirmation of the assertion semantics before the live run.

---

## Phase 4: Live 3-model run + documentation

### Overview

Run the eval against the three real models, interpret the matrix, and document how to read it.

### Changes Required:

#### 1. Execute and inspect

**File**: _(no file change — operational)_

**Intent**: Produce the first real comparison across the three models.

**Contract**: From `packages/code-reviewer/` with `OPENROUTER_API_KEY` set and Node ≥ 22.22.0: `npm run eval`, then `npm run eval:view` for the side-by-side UI.

#### 2. README usage + interpretation

**File**: `packages/code-reviewer/README.md`

**Intent**: Explain what the eval proves and how to read pass/fail + judge scores per model.

**Contract**: Extend the "Evals (promptfoo)" section with: what the fixture/flaws are, what the deterministic assertion vs the g-eval judge each verify, and how to interpret the per-model matrix (and that a model legitimately failing here is signal about that model, not a config bug).

### Success Criteria:

#### Automated Verification:

- Config validates: `cd packages/code-reviewer && npx promptfoo validate -c promptfooconfig.yaml`
- Lint passes: `npm run lint`

#### Manual Verification:

- `npm run eval` completes and emits a 3-model × assertions matrix; each model shows a deterministic pass/fail and a g-eval score.
- `npm run eval:view` renders the comparison.
- README accurately describes running and interpreting the eval.

**Implementation Note**: This phase's core result (which models pass, how many flaws each finds) is inherently a live, non-deterministic run — capture the observed matrix in the change notes if useful.

---

## Testing Strategy

### Unit Tests:

- Provider wiring (offline, `OPENROUTER_MOCK=true`): vars forwarded, model threaded, valid `Review` JSON returned, `MOCK_FAIL_MARKER` → `failed` (`test/code-reviewer/review-provider.test.ts`).

### Integration Tests:

- `promptfoo validate` after each config-touching phase (syntactic/structural validity of the matrix + assertions).
- Live `npm run eval`: the end-to-end 3-model evaluation with deterministic + g-eval assertions (manual, key required).

### Manual Testing Steps:

1. `cd packages/code-reviewer && OPENROUTER_MOCK=true npm run eval` — matrix runs end-to-end (shape).
2. Set `OPENROUTER_API_KEY`, ensure Node ≥ 22.22.0, run `npm run eval` — inspect per-model pass/fail.
3. `npm run eval:view` — review side-by-side; confirm the g-eval judge scores each model's flaw coverage.

## Performance Considerations

A live run is 3 model calls + up to 3 grader calls; trivial in volume. Grader at temperature 0 reduces judge variance. promptfoo caches results between runs, so re-runs without prompt/fixture changes avoid re-billing.

## Migration Notes

None — additive only; no existing code, schema, workflow, or `.nvmrc` changes.

## References

- Related research: `context/changes/code-review-evals/research.md`
- Reviewer agent (injectable model): `packages/code-reviewer/src/agent/reviewer.ts:42-54,90-106`
- Output schema (no findings list): `packages/code-reviewer/src/schemas/review.ts:90-94`
- Offline mock: `packages/code-reviewer/src/agent/mock-review.ts:37-50`
- Existing workspace-import test pattern: `test/code-reviewer/review-prompt.test.ts:1-8`
- promptfoo custom provider: https://www.promptfoo.dev/docs/providers/custom-api
- promptfoo JSON eval / transform: https://www.promptfoo.dev/docs/guides/evaluate-json
- promptfoo g-eval: https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/g-eval

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scaffold promptfoo + custom provider

#### Automated

- [x] 1.1 Type checking passes (`npm --workspace @10xcards/code-reviewer run typecheck`) — 60ec806
- [x] 1.2 Provider wiring test passes (`npm test -- review-provider`) — 60ec806
- [x] 1.3 Config validates (`npx promptfoo validate -c promptfooconfig.yaml`) — 60ec806
- [x] 1.4 Lint passes (`npm run lint`) — 60ec806

#### Manual

- [x] 1.5 `OPENROUTER_MOCK=true npm run eval` runs the 3-provider matrix end-to-end without crashing — 60ec806
- [x] 1.6 promptfoo runs under the active Node (≥ 22.22.0) — 60ec806

### Phase 2: Golden fixture — React 16→19 diff with three planted flaws

#### Automated

- [x] 2.1 Config still validates with the fixture wired — f33a89c
- [x] 2.2 Fixture exists and is ≥ 80 lines — f33a89c

#### Manual

- [x] 2.3 All three flaws present, each mapping to its intended criterion, migration framing reads naturally — f33a89c
- [x] 2.4 Fixture contains no `FAIL_MARKER` — f33a89c

### Phase 3: Assertions — deterministic failure + g-eval judge

#### Automated

- [x] 3.1 Config with assertions validates
- [x] 3.2 Type checking still passes

#### Manual

- [x] 3.3 Deterministic assertion's conditions match the three planted criteria + failed verdict
- [x] 3.4 g-eval criteria map one-per-flaw; grader is `openrouter:anthropic/claude-sonnet-4.6` at temp 0

### Phase 4: Live 3-model run + documentation

#### Automated

- [ ] 4.1 Config validates
- [ ] 4.2 Lint passes

#### Manual

- [ ] 4.3 `npm run eval` emits a 3-model × assertions matrix with deterministic + g-eval results per model
- [ ] 4.4 `npm run eval:view` renders the comparison
- [ ] 4.5 README accurately describes running and interpreting the eval
