-- Add FSRS spaced-repetition state to flashcards (S-06 / srs-flow).
-- Columns map 1:1 to the ts-fsrs@5.4.1 Card interface (10 persistable fields),
-- DEFAULTed so existing rows backfill to a createEmptyCard() "New" card (due now).
-- Existing per-operation RLS policies (select_own/update_own, auth.uid() = user_id)
-- are table-level and automatically cover the new columns — no new policies needed.
ALTER TABLE flashcards
  ADD COLUMN due            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  ADD COLUMN stability      DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN difficulty     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN elapsed_days   INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN scheduled_days INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN learning_steps INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN reps           INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN lapses         INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN state          SMALLINT         NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  ADD COLUMN last_review    TIMESTAMPTZ;     -- nullable; createEmptyCard() leaves it undefined

-- Supports the "due now" review queue: WHERE user_id = ? AND due <= now() ORDER BY due ASC.
CREATE INDEX idx_flashcards_due ON flashcards(user_id, due);
