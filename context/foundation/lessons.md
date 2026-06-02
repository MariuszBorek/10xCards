# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Persisted read-modify-write state must guard against lost updates

- **Context**: src/lib/services/srs.ts:106-140 — reviewCard (FSRS state persistence)
- **Problem**: reviewCard reads a card's current FSRS state, computes the next state in app code, then writes it back in a separate UPDATE. The SELECT → compute → UPDATE sequence is not atomic, so two concurrent writes to the same row can lost-update (the later write silently clobbers the earlier one). Tolerable for a single-user flow where the client disables the buttons during submit, but a latent hazard once a row can have more than one concurrent writer (multi-device, background jobs).
- **Rule**: When persisting derived/accumulated state (scheduler state, counters, balances) via read-modify-write, make the write conditional — an optimistic version / updated_at check — or collapse the whole sequence into a single SQL statement / Postgres function, as soon as more than one writer per row is possible.
- **Applies to**: Any service that loads a row, mutates it in app code, and writes it back — especially SRS state and any future counter/aggregate columns on `flashcards`.

## Four flashcard endpoints rely on RLS alone — no app-layer ownership filter

- **Context**: `list` (`src/pages/api/flashcards/index.ts:22` — `GET … .select("*")`), `update` (`src/pages/api/flashcards/[id].ts:49-51` — `.update(...).eq("id", id)`), `delete` (`[id].ts:84` — `.delete().eq("id", id)`), and `export` (`src/pages/api/flashcards/export.ts:26-27` — `.select("word, translation, context")`) all scope by `id` (or not at all), never by `user_id`. By contrast `create`/`due`/`review` enforce ownership in app code (`insert({ user_id })` / `.eq("user_id", userId)`). For these four, the per-operation RLS policies (`supabase/migrations/20260527000000_flashcard_schema.sql:13-27`, all `auth.uid() = user_id`) are the **sole** backstop.
- **Problem**: A single weakened/dropped/over-broad RLS policy after any migration leaks rows across accounts on these endpoints, and there is **nothing in app code to catch it** — a cross-account IDOR with no second line of defense. The blast radius is four endpoints at once, not one.
- **Rule**: (1) When touching any of these four endpoints, add defense-in-depth `.eq("user_id", user.id)` to the query — do not lean on RLS alone. (2) Treat any change to the `flashcards` RLS policies as multi-endpoint security-critical: re-run `test/rls/flashcards-rls.test.ts` (the direct-DB cross-account backstop) before merging. (3) In tests, assert the cross-account **outcome** (B sees/mutates zero of A's rows), never the query shape — a mirror test that checks for `.eq("user_id")` would pass against the very gap this lesson documents.
- **Applies to**: `src/pages/api/flashcards/{index,[id],export}.ts`, the `flashcards` RLS policies, and any new endpoint that reads/writes `flashcards` without an explicit `user_id` filter.
