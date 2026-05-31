# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Persisted read-modify-write state must guard against lost updates

- **Context**: src/lib/services/srs.ts:106-140 — reviewCard (FSRS state persistence)
- **Problem**: reviewCard reads a card's current FSRS state, computes the next state in app code, then writes it back in a separate UPDATE. The SELECT → compute → UPDATE sequence is not atomic, so two concurrent writes to the same row can lost-update (the later write silently clobbers the earlier one). Tolerable for a single-user flow where the client disables the buttons during submit, but a latent hazard once a row can have more than one concurrent writer (multi-device, background jobs).
- **Rule**: When persisting derived/accumulated state (scheduler state, counters, balances) via read-modify-write, make the write conditional — an optimistic version / updated_at check — or collapse the whole sequence into a single SQL statement / Postgres function, as soon as more than one writer per row is possible.
- **Applies to**: Any service that loads a row, mutates it in app code, and writes it back — especially SRS state and any future counter/aggregate columns on `flashcards`.
