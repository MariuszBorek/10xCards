---
change_id: ai-generation-flow
title: AI flashcard generation — paste text → review candidates → save to collection
status: impl_reviewed
created: 2026-05-27
updated: 2026-05-29
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

Roadmap S-01 (Change ID: ai-generation-flow). Outcome: zalogowany użytkownik może wkleić obcojęzyczny tekst (od jednego słowa do krótkiego akapitu), uruchomić generację AI, przejrzeć kandydatów (każdy z akcjami: akceptuj / odrzuć / edytuj in-place), a zaakceptowane fiszki pojawiają się natychmiast w jego kolekcji; puste wejście i wynik zerowych kandydatów mają wyjaśniający komunikat.

- PRD refs: FR-004, FR-005, FR-006, US-01
- Prerequisites: F-01 (flashcard-schema — status: ready)
- LLM provider: OpenRouter (resolved 2026-05-26)
- Risk: jakość kandydatów AI to serce propozycji wartości — prompt engineering jest wbudowany w implementację
