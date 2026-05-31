---
change_id: srs-flow
kind: research
created: 2026-05-31
sources: external (exa.ai web search) + tech-stack.md / roadmap.md
---

# Research: SRS library selection for S-06 (srs-flow)

Goal: pick an external spaced-repetition library to power in-app review for 10xCards,
per roadmap slice **S-06** (algorithm from a library, **not** a custom implementation).

## Hard constraint: Cloudflare Workers edge runtime

The app is Astro SSR (`output: "server"`) deployed via `@astrojs/cloudflare` to Cloudflare
Workers. That rules out anything depending on Node built-ins or **WASI**. The SRS *scheduler*
math is pure `Date` arithmetic + pure functions, so most libraries qualify — **but FSRS
*optimizer/trainer* packages use Rust/WASM (WASI) and explicitly cannot run on the edge.**
That distinction drives the recommendation.

## Algorithm choice: FSRS over SM-2

- **FSRS** (Free Spaced Repetition Scheduler, 2022) — modern standard; Anki's default since
  v23.10. ~20–30% fewer reviews for the same retention vs SM-2; ~4% recall-prediction error
  vs SM-2's ~14%. Tracks Difficulty / Stability / Retrievability per card.
- **SM-2** (SuperMemo, 1987) — simpler, single ease-factor per card, no training data,
  trivially explainable; structurally weaker ("ease hell"). Fine for tiny decks.

**Decision: FSRS.** Starting a new product on SM-2 in 2026 has no upside; FSRS is the current
default across the ecosystem and works well on its built-in default weights (no training needed).

## Candidate libraries

| Library | Algo | Deps | Edge-safe? | Maturity (approx, from search snapshots) | Notes |
|---|---|---|---|---|---|
| **`ts-fsrs`** (open-spaced-repetition) | FSRS v6 | 0 | ✅ scheduler edge-safe | 664★, ~55K weekly dl, MIT, last push 2026-05 | Canonical impl. ESM/CJS/UMD. `engines: node>=20` is advisory; runtime code is pure TS. ⚠️ Optimizer is a *separate* package `@open-spaced-repetition/binding` (Rust/WASM, **not** edge-safe) — not needed at runtime. |
| `@squeakyrobot/fsrs` | FSRS v4.5 (+v6) | 0 | ✅ advertises CF Workers | new, ~7 weekly dl, 1 version | Pure TS, ships a Cloudflare Workers example. Low adoption / bus-factor risk. |
| `quanta-fsrs` | FSRS v4.5/5 | 0 | ✅ claims CF Workers/edge | 0★, used in one prod app | MINT-tuned weights. Adoption risk. |
| `srs-everything` | FSRS | — | likely ✅ | small | Adds queue/interleaving helpers on top of FSRS. |
| `supermemo` (VienDinhCom) | SM-2 | 0 | ✅ | ~1.8K weekly dl, MIT, ~12KB | Cleanest SM-2 if going simple. |
| `@open-spaced-repetition/sm-2` | SM-2 | 0 | ✅ | official OSR, 2025 | SM-2 with `Card`/`Scheduler` class API. |

> Caveat: download/star figures come from search-result snapshots, not a live npm registry
> pull — treat as approximate.

## Recommendation: `ts-fsrs`

Clear pick: reference FSRS implementation, by far the most maintained and adopted, MIT,
zero-dependency, scheduler is pure TS that runs on Workers. API maps directly onto the slice:

```ts
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'

const scheduler = fsrs()                          // default weights — no training
const card = createEmptyCard()
const preview = scheduler.repeat(card, new Date())// preview Again/Hard/Good/Easy
const result = scheduler.next(card, new Date(), Rating.Good) // apply chosen rating
```

## Implications for the plan

1. **Do NOT run the optimizer on the edge.** Parameter training (`@open-spaced-repetition/binding`)
   is WASI/Rust and edge-incompatible. MVP uses **default FSRS weights** (captures ~98% of the
   benefit; per-user optimization only matters past ~1,000 reviews and can be a later offline job).

2. **Schema impact on F-01.** FSRS needs per-card review state persisted — a new Supabase
   migration extending `flashcards` (with per-operation RLS), exactly the unknown S-06 flagged.
   `ts-fsrs`'s `Card` shape lines up 1:1 with these columns:
   `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`,
   `state`, `last_review`.

3. **Validate persisted params at the boundary** (ts-fsrs README note) — zod fits, already a
   project convention for API input.

## Open questions carried into planning

- Exact column types / nullability for FSRS state fields on `flashcards` (migration design).
- Review-session UX scope: rating buttons (Again/Hard/Good/Easy), card ordering, end-of-session.
- Whether to expose `request_retention` / `maximum_interval` as user settings or hardcode MVP defaults.

## Sources

- `ts-fsrs` — github.com/open-spaced-repetition/ts-fsrs, open-spaced-repetition.github.io/ts-fsrs
- DeepWiki: ts-fsrs platform support (edge-runtime / WASI limitation of the binding package)
- FSRS vs SM-2 benchmarks: open-spaced-repetition benchmark (~350–700M reviews); imprimo.app,
  diane.app, studyglen.com comparison write-ups (2026)
- Cloudflare Workers Node.js compatibility docs (nodejs_compat, no WASI on edge)
- npm: `@squeakyrobot/fsrs`, `quanta-fsrs`, `srs-everything`, `supermemo`, `@open-spaced-repetition/sm-2`
