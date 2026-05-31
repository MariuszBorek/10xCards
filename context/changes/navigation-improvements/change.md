---
change_id: navigation-improvements
title: Add a consistent navigation bar to every page (collection, dashboard)
status: impl_reviewed
created: 2026-05-31
updated: 2026-05-31
archived_at: null
---

## Notes

Roadmap slice **S-05** (z `context/foundation/roadmap.md`).

- **Outcome:** każda strona aplikacji ma pasek nawigacji — strony `/collection` i `/dashboard`, którym go brakuje, otrzymują spójny pasek ułatwiający przechodzenie między widokami (brak zauważony podczas pracy nad S-01–S-03).
- **Prerequisites:** F-01. **Parallel with:** S-04.
- **Unknowns:** współdzielony layout (`src/layouts/Layout.astro`) vs osobny komponent; zakres pozycji nawigacji (kolekcja, dashboard, eksport, wylogowanie) — Owner: impl.
- **Risk:** niskie; uwaga, by nie zduplikować nawigacji na stronach, które już ją mają, i by pasek nie pojawiał się na stronach auth (signin/signup).
