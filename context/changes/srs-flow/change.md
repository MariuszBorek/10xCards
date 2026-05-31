---
change_id: srs-flow
title: In-app SRS review flow powered by an external scheduling library
status: implemented
created: 2026-05-31
updated: 2026-05-31
archived_at: null
---

## Notes

Seeds roadmap slice **S-06 (srs-flow)** — `context/foundation/roadmap.md`.

Outcome: zalogowany użytkownik uczy się fiszek w aplikacji w sesji powtórek sterowanej harmonogramem spaced-repetition. Algorytm SRS pochodzi z **zewnętrznej biblioteki** (np. ts-fsrs), nie z własnej implementacji. Aplikacja przechowuje stan powtórki per fiszka i podsuwa te, które są na termin.

Prerequisites: F-01 (flashcard-schema, done).

Open unknowns (z roadmapy):
- Wybór biblioteki SRS (ts-fsrs / inna) — dojrzałość, licencja.
- Pola stanu powtórki do dołożenia do schematu `flashcards` (due, stability, difficulty, reps…) — nowa migracja Supabase + RLS.
- Zakres UI sesji nauki (ocena odpowiedzi, kolejność, koniec sesji).

Uwaga zakresowa: rozszerza MVP poza pierwotne PRD §Non-Goals "własny scheduler" — świadoma decyzja użytkownika, by dodać SRS przez integrację, nie własny algorytm.
