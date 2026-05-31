---
change_id: ui-improvements
title: Spójny wygląd UI między zakładkami — jednolite tło i kolory przycisków
status: archived
created: 2026-05-30
updated: 2026-05-31
archived_at: 2026-05-31T12:16:07Z
---

## Notes

Roadmap slice **S-04** (`context/foundation/roadmap.md`).

- **Outcome:** wszystkie zakładki aplikacji mają spójny wygląd — strona `/collection` używa tego samego tła i kolorów przycisków co pozostałe zakładki (rozbieżność zauważona podczas pracy nad S-02–S-03).
- **PRD refs:** — (slice kosmetyczny, bez bezpośredniego FR).
- **Prerequisites:** F-01 (done).
- **Unknowns:**
  - Źródło rozbieżności: lokalne klasy/style na `/collection` vs współdzielony layout/tokeny.
  - Czy ujednolicić przez współdzielone tokeny Tailwind / komponenty shadcn, czy poprawić punktowo.
- **Risk:** niskie; uwaga, by ujednolicenie nie wprowadziło regresji wizualnych na pozostałych zakładkach — porównać wszystkie zakładki po zmianie.
