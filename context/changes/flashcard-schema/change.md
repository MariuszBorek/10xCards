---
change_id: flashcard-schema
title: Supabase flashcards table with RLS migration
status: implementing
created: 2026-05-27
updated: 2026-05-27
archived_at: null
---

## Notes

F-01 from roadmap. Creates `flashcards` table (id, user_id, word, translation, context, created_at) with per-operation RLS policies (SELECT / INSERT / UPDATE / DELETE) so every authenticated user reads and modifies only their own rows. Unlocks S-01, S-02, S-03.
