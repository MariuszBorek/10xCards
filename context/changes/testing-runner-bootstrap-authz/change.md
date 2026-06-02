---
change_id: testing-runner-bootstrap-authz
title: Test rollout Phase 1 — runner bootstrap + authorization/RLS coverage
status: implementing
created: 2026-06-01
updated: 2026-06-02
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`. Goal: stand up the
integration test runner against local Supabase and prove cross-account
isolation at the app and DB layers, plus auth gating.

Risks covered (see test-plan §2):
- **#1** — a flashcard API endpoint returns/mutates another user's data because ownership is not enforced on that operation.
- **#2** — an RLS policy on the flashcards table is missing/too permissive for one operation, leaking rows at the DB layer.
- **#6** — a middleware change lets an unauthenticated request reach a protected route/API endpoint, or logs users out.

Test types: unit + integration (Vitest + integration harness against local
Supabase; OpenRouter mocked at the network edge where touched).

Risk response intent (verify, don't blindly accept — see test-plan §2 Risk
Response Guidance):
- #1: prove user B's request for user A's flashcard id is denied and that list/export/review/update never cross accounts; challenge "logged-in implies authorized".
- #2: prove that with user B's credentials a direct SELECT/UPDATE/DELETE of user A's row is denied; challenge "the app-layer check is enough" — exercise RLS directly.
- #6: prove an unauthenticated request to a protected route/API endpoint is redirected / returns 401 and never returns data; challenge "protected pages imply protected APIs".

This change needs grounding before planning — `/10x-research` next.
