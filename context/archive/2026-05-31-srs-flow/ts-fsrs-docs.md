---
change_id: srs-flow
kind: reference
created: 2026-05-31
source: Context7 MCP — /open-spaced-repetition/ts-fsrs (High reputation, score 87)
note: Code blocks below are from the official ts-fsrs README via Context7. Field-type
      notes marked "verify" must be checked against the exact installed version at impl time.
---

# ts-fsrs — implementation reference for S-06 (srs-flow)

Scope: only the **scheduler** package `ts-fsrs` (pure TS, edge-safe). Do NOT pull
`@open-spaced-repetition/binding` (the optimizer) — it is Rust/WASM/WASI and cannot run on
Cloudflare Workers. MVP uses default FSRS weights, so the optimizer is not needed.

Install: `npm install ts-fsrs`

## 1. Core review flow (the slice's heart)

```typescript
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'

const scheduler = fsrs()
const card = createEmptyCard()

// Preview all four possible outcomes BEFORE the user answers (for showing "next due" hints).
const preview = scheduler.repeat(card, new Date())

// Apply the final rating AFTER the user answers.
const result = scheduler.next(card, new Date(), Rating.Good)

console.log(preview[Rating.Good].card)
console.log(result.card)  // updated card -> persist this
console.log(result.log)   // review log entry -> optionally persist for history/optimization later
```

- `createEmptyCard()` — initialize a new card with defaults (state = New, due = now).
- `scheduler.repeat(card, now)` — returns a `RecordLog` keyed by each Rating; no mutation.
  Use to preview Again/Hard/Good/Easy intervals.
- `scheduler.next(card, now, Rating)` — applies one rating, returns `{ card, log }`.
  Use in the actual review endpoint once the user picks a grade.

## 2. Rating enum (the four review buttons)

```typescript
Rating.Again   // user forgot
Rating.Hard
Rating.Good
Rating.Easy
```

## 3. State enum (card lifecycle — persist as the `state` column)

```typescript
State.New
State.Learning
State.Review
State.Relearning
```

## 4. Scheduler parameters

```typescript
import { fsrs } from 'ts-fsrs'

const scheduler = fsrs({
  request_retention: 0.9,    // target recall probability (0.0–1.0). Higher = more reviews.
  maximum_interval: 36500,   // cap on how far ahead a card can be scheduled (days)
  enable_fuzz: true,         // small randomness on long intervals
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
})
```

MVP guidance: `fsrs()` with no args uses sane defaults. Decide later whether to expose
`request_retention` / `maximum_interval` as user settings (open question in research.md).

### Serializable parameters (if you ever store them)

```typescript
import { fsrs, generatorParameters, type FSRSParameters } from 'ts-fsrs'

const params = generatorParameters({ request_retention: 0.9, maximum_interval: 36500 })
console.log(JSON.stringify(params))           // persist
const scheduler = fsrs(params)

// reload:
const parsed = JSON.parse(serialized) as FSRSParameters   // validate with zod at the boundary
const scheduler2 = fsrs(parsed)
```

## 5. Persisting card state — Date → timestamp mapping (afterHandler)

`next()` accepts an `afterHandler` to transform the result for storage (Dates → timestamps):

```typescript
const saved = scheduler.next(card, new Date(), Rating.Good, ({ card, log }) => ({
  card: {
    ...card,
    due: card.due.getTime(),
    last_review: card.last_review?.getTime() ?? null,
  },
  log: {
    ...log,
    due: log.due.getTime(),
    review: log.review.getTime(),
  },
}))
```

This confirms the persistence shape: `card.due` is a `Date`, `card.last_review` is optional
(`Date | null`). When reloading from Supabase, rehydrate timestamps back into `Date` before
passing the card to `repeat()` / `next()`.

## 6. Card fields → Supabase columns (F-01 schema migration)

The `Card` object is what you persist per flashcard. Documented/confirmed fields:

| Card field        | Type (from docs)        | Suggested Postgres column        |
|-------------------|-------------------------|----------------------------------|
| `due`             | `Date` (confirmed)      | `timestamptz`                    |
| `stability`       | `number` (FSRSState)    | `double precision`               |
| `difficulty`      | `number` (FSRSState)    | `double precision`               |
| `elapsed_days`    | `number`                | `integer`                        |
| `scheduled_days`  | `number`                | `integer`                        |
| `reps`            | `number`                | `integer`                        |
| `lapses`          | `number`                | `integer`                        |
| `state`           | `State` enum (0–3)      | `smallint` (or enum)             |
| `last_review`     | `Date \| undefined`     | `timestamptz` nullable           |

> ⚠️ **verify**: recent ts-fsrs versions added/renamed fields (e.g. `learning_steps`).
> Before writing the migration, check the exact `Card` type in the pinned installed version
> (`node_modules/ts-fsrs` or TypeDoc) so columns match 1:1. Mismatched fields are a silent
> data-loss footgun.

These columns extend the existing `flashcards` table (or a sibling `flashcard_srs` table) —
per the hard rule, the migration MUST add per-operation RLS scoped to `auth.uid()`.

## 7. Direct memory-state API (optional — analytics/simulation)

```typescript
import { fsrs, Rating, type FSRSState } from 'ts-fsrs'

const scheduler = fsrs({ enable_fuzz: false })
const memoryState: FSRSState = { stability: 3.2, difficulty: 5.6 }
const elapsedDays = 12
const nextState = scheduler.next_state(memoryState, elapsedDays, Rating.Good)
const nextInterval = scheduler.next_interval(nextState.stability, elapsedDays)
```

Not needed for the standard review flow — prefer `repeat()` / `next()`. Listed for completeness.

## Implementation sketch for S-06

1. **Migration (extends F-01):** add the §6 columns + RLS; backfill existing rows with
   `createEmptyCard()` defaults (state=New, due=now, stability/difficulty=0, reps/lapses=0).
2. **Service** (`src/lib/services/`): `getDueCards(userId)` (where `due <= now()`),
   `reviewCard(cardId, rating)` → load row → rehydrate Dates → `scheduler.next()` →
   persist via `afterHandler` timestamp mapping.
3. **API routes** (`prerender = false`, zod-validated): list-due + submit-rating endpoints.
4. **React island:** review session UI — show card, reveal answer, four Rating buttons,
   advance until the due queue is empty.

## Sources (Context7 / official README)

- /open-spaced-repetition/ts-fsrs — README + packages/fsrs/README.md
- Verify exact `Card` interface against installed version before migration.
