---
change_id: testing-generation-integrity
title: Generation, persistence & output-safety integrity tests (rollout Phase 2)
status: implemented
created: 2026-06-03
updated: 2026-06-04
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md`: "Generation, persistence & output-safety integrity".

**Risks covered:**

- #3 — transient pasted input persists somewhere operator-accessible (a stored row or the response body) after the request that consumed it.
- #4 — silent data loss: accept succeeds but rows never land, or a failed write returns 2xx and the collection shows empty.
- #5 — AI generation failure/empty-input/zero-candidate/malformed-response not surfaced cleanly (hang or fake success; parse crash).
- #7 — untrusted model & candidate output treated as trusted → stored XSS on render + spreadsheet formula injection on CSV export.

**Test types planned:** unit + integration.

**Risk response intent** (behavior each phase must prove protected — from §2 Risk Response Guidance):

- #3: After a generation request, the raw pasted input is absent from any persisted row and from the response body.
- #4: Accepting N candidates then reloading the collection returns exactly those N; a forced write failure returns a non-2xx status (never 2xx-on-failure).
- #5: Empty input yields an explanatory error (not a blank candidate list); a mocked OpenRouter error yields a clean failure with no hang; zero candidates yields the empty state.
- #7: Adversarial content renders as inert text (no script execution) in the collection/candidate view, and a CSV field beginning with `=`, `+`, `-`, `@`, or tab is neutralized on Anki export.
