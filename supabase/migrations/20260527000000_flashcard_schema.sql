-- Table
CREATE TABLE flashcards (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word        TEXT        NOT NULL,
  translation TEXT        NOT NULL,
  context     TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user isolation
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON flashcards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON flashcards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own" ON flashcards
  FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK(auth.uid() = user_id);

CREATE POLICY "delete_own" ON flashcards
  FOR DELETE USING (auth.uid() = user_id);

-- Performance index for RLS filter
CREATE INDEX idx_flashcards_user_id ON flashcards(user_id);
