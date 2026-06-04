---
change_id: testing-quality-gates-wiring
title: Quality-gates wiring — lock CI gates for Phase 1–2 protections + critical-flow e2e
status: impl_reviewed
created: 2026-06-04
updated: 2026-06-04
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md`: "Quality-gates wiring".

Risks covered: cross-cutting — this phase enforces the protections shipped in
Phases 1–2 (#1/#2 authorization+RLS, #3 transient input, #4 silent-loss,
#5 generation failure paths, #6 auth gating, #7 output-safety) as CI gates,
plus one e2e on the critical user flow.

Test types planned: quality gates (lint + typecheck + unit+integration in CI)

- one e2e (paste→generate→accept→export).

Risk response intent:

- Lock the §5 gates so any regression in the Phase 1–2 protections fails CI
  before reaching production: lint + typecheck already run; add unit+integration
  as a required gate; add the e2e gate on the critical flow.
- The e2e must prove the end-to-end value path (paste→generate→accept→export)
  works in a browser, not re-test what integration already covers — only the
  genuinely browser-level critical-path regression belongs here (cost × signal).
