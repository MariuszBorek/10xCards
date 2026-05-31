---
project: "10xCards"
version: 1
status: draft
created: 2026-05-25
updated: 2026-05-31
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Samouki uczący się języka obcego tracą godziny na ręczne przepisywanie słówek do Anki. 10xCards skraca ten czas do sekund: użytkownik wkleja tekst — AI wyciąga pary słowo ↔ tłumaczenie — użytkownik akceptuje lub edytuje kandydatów — zaakceptowane fiszki trafiają do kolekcji i można je natychmiast wyeksportować do Anki. Propozycja wartości — powód, dla którego 10xCards wypiera ręczne przepisywanie — to jakość generacji AI: jeśli kandydaci są złej jakości, cały produkt traci rację bytu.

## North star

**S-01: AI generuje fiszki ze wklejonego tekstu** — to pierwsza historyjka, która udowadnia, że produkt działa; wysłanie S-01 jako działającego przepływu (wklej → AI → recenzja → kolekcja) to jedyna weryfikacja kluczowej hipotezy produktu (czy AI generuje wystarczająco dobre fiszki, żeby zastąpić ręczne przepisywanie), po której warto budować resztę.

> "Gwiazda przewodnia" oznacza tu: najmniejszy kompletny przepływ od końca do końca, którego pomyślne dostarczenie dowodzi słuszności kluczowej hipotezy produktu — i który stawiamy jak najwcześniej w kolejności, bo wszystko inne ma sens tylko jeśli to działa.

## At a glance

| ID   | Change ID             | Outcome (user can …)                                                        | Prerequisites | PRD refs                       | Status   |
|------|-----------------------|-----------------------------------------------------------------------------|---------------|--------------------------------|----------|
| F-01 | flashcard-schema      | (foundation) tabela fiszek z RLS wdrożona; izolacja danych per-użytkownik  | —             | FR-001, FR-002, FR-003         | done     |
| S-01 | ai-generation-flow    | wkleić tekst → AI generuje kandydatów → recenzja → zaakceptowane w kolekcji | F-01         | FR-004, FR-005, FR-006, US-01  | done     |
| S-02 | collection-management | ręcznie dodać fiszkę, przeglądać kolekcję, edytować i usunąć dowolną fiszkę | F-01         | FR-007, FR-008, FR-009, FR-010 | done     |
| S-03 | anki-csv-export       | pobrać CSV kolekcji importowalny do Anki bez modyfikacji                    | F-01         | FR-011, US-02                  | done     |
| S-04 | ui-improvements       | spójny wygląd między zakładkami — jednolite tło i kolory przycisków         | F-01         | —                              | done     |
| S-05 | navigation-improvements | pasek nawigacji na każdej stronie — łatwiejsze przechodzenie po aplikacji | F-01         | —                              | done     |
| S-06 | srs-flow              | powtarzać fiszki w aplikacji wg harmonogramu SRS z zewnętrznej biblioteki | F-01         | —                              | done     |

## Baseline

What's already in place in the codebase as of 2026-05-25 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.3.1 + React 19 + shadcn/ui + Tailwind 4; `src/pages/`, `src/layouts/Layout.astro`
- **Backend / API:** partial — Astro SSR API routes tylko dla auth (`src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`); brak tras dla fiszek
- **Data:** partial — `@supabase/supabase-js` zainstalowany, ale brak migracji i schematu aplikacyjnego (tabela fiszek absent)
- **Auth:** present — Supabase Auth w pełni okablowany: `src/lib/supabase.ts`, middleware `src/middleware.ts:12-22` (getUser + redirect); strony auth (`signin`, `signup`, `confirm-email`) obecne; FR-001, FR-002, FR-003 zaimplementowane
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`) + GitHub Actions CI (`.github/workflows/ci.yml`)
- **Observability:** absent — brak logowania, error tracking, metryk; świadoma decyzja MVP (cel: speed)

## Foundations

### F-01: Schemat fiszek z izolacją danych

- **Outcome:** (foundation) migracja Supabase tworzy tabelę `flashcards` z polami `id`, `user_id`, `word`, `translation`, `context`, `created_at`; polityki RLS per-operację (SELECT / INSERT / UPDATE / DELETE) zapewniają, że każdy zalogowany użytkownik odczytuje i modyfikuje wyłącznie własne wiersze.
- **Change ID:** flashcard-schema
- **PRD refs:** FR-001, FR-002, FR-003 (RLS korzysta z `auth.uid()` z istniejącej warstwy auth), Guardrails §Izolacja danych
- **Unlocks:** S-01 (AI generation flow), S-02 (collection management), S-03 (CSV export)
- **Prerequisites:** — (warstwa auth already present per Baseline)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** schemat musi od razu zawierać wszystkie potrzebne pola i RLS per-operację — późniejsza zmiana schematu to nowa migracja i potencjalny ból; warto zrobić raz porządnie, zanim wejdą slice'y
- **Status:** done

## Slices

### S-01: AI generuje fiszki ze wklejonego tekstu

- **Outcome:** zalogowany użytkownik może wkleić obcojęzyczny tekst (od jednego słowa do krótkiego akapitu), uruchomić generację AI, przejrzeć kandydatów (każdy z akcjami: akceptuj / odrzuć / edytuj in-place), a zaakceptowane fiszki pojawiają się natychmiast w jego kolekcji; puste wejście i wynik zerowych kandydatów mają wyjaśniający komunikat
- **Change ID:** ai-generation-flow
- **PRD refs:** FR-004, FR-005, FR-006, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-02, S-03
- **Blockers:** —
- **Unknowns:**
  - ~~Który dostawca LLM (OpenAI / Anthropic / OpenRouter / inny)? — Owner: user. Block: yes.~~ **Resolved: OpenRouter** (2026-05-26)
  - Prompt engineering pod różne długości wejścia (Q1 PRD) — Owner: impl. Block: no.
  - Limit długości wejścia i strategia przekroczenia (Q2 PRD) — Owner: impl. Block: no.
  - Kryteria "fiszki godnej / trywialnej" (Q3 PRD) — Owner: impl. Block: no.
- **Risk:** jakość kandydatów AI to serce propozycji wartości — jeśli prompt daje systematycznie słabe wyniki, cały MVP traci rację bytu; iteracja na prompcie jest wbudowana w implementację; dostawca LLM: OpenRouter (dostęp do wielu modeli przez jedno API, łatwa zmiana modelu bez zmiany kodu)
- **Status:** done

### S-02: Kolekcja — ręczne dodanie, przeglądanie, edycja, usunięcie

- **Outcome:** zalogowany użytkownik może ręcznie dodać fiszkę (słowo + tłumaczenie + opcjonalny kontekst), przeglądać pełną listę swoich fiszek, edytować dowolną fiszkę in-place i usunąć dowolną fiszkę (z dialogiem potwierdzenia)
- **Change ID:** collection-management
- **PRD refs:** FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-03
- **Blockers:** —
- **Unknowns:**
  - Soft delete vs hard delete dla FR-010 — Owner: impl. Block: no.
- **Risk:** flat list bez paginacji jest świadomą decyzją MVP (PRD §FR-008 Socrates); staje się write-only powyżej ~200 fiszek, ale to znane ograniczenie; search/filter to Non-Goal
- **Status:** done

### S-03: Eksport kolekcji do CSV kompatybilnego z Anki

- **Outcome:** zalogowany użytkownik może pobrać plik CSV zawierający wszystkie swoje fiszki w formacie Anki basic (słowo przód / tłumaczenie tył / opcjonalny kontekst); znaki specjalne (diakrytyki, cudzysłowy, przecinki) przechodzą round-trip do Anki poprawnie; pusta kolekcja pokazuje komunikat zamiast pustego pliku
- **Change ID:** anki-csv-export
- **PRD refs:** FR-011, US-02
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02
- **Blockers:** —
- **Unknowns:**
  - Konkretne kolumny CSV i escape rules dla diacritics/cudzysłowów/przecinków (Q7 PRD) — Owner: impl. Block: no.
- **Risk:** Anki CSV format jest prosty, ale separator i escape corner-cases (np. słowo zawierające przecinek lub cudzysłów) mogą zaskoczyć — warto przeprowadzić ręczny round-trip test przed uznaniem slice za done
- **Status:** done

### S-04: Poprawki UI — spójność wyglądu między zakładkami

- **Outcome:** wszystkie zakładki aplikacji mają spójny wygląd — strona `/collection` używa tego samego tła i kolorów przycisków co pozostałe zakładki (rozbieżność zauważona podczas pracy nad S-02–S-03)
- **Change ID:** ui-improvements
- **PRD refs:** —
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Źródło rozbieżności: lokalne klasy/style na `/collection` vs współdzielony layout/tokeny — Owner: impl. Block: no.
  - Czy ujednolicić przez współdzielone tokeny Tailwind / komponenty shadcn, czy poprawić punktowo — Owner: impl. Block: no.
- **Risk:** kosmetyczny slice o niskim ryzyku; uwaga, by ujednolicenie nie wprowadziło regresji wizualnych na pozostałych zakładkach — warto porównać wszystkie zakładki po zmianie
- **Status:** done

### S-05: Poprawki nawigacji — pasek nawigacji na każdej stronie

- **Outcome:** każda strona aplikacji ma pasek nawigacji — strony `/collection` i `/dashboard`, którym go brakuje, otrzymują spójny pasek nawigacji ułatwiający przechodzenie między widokami (brak zauważony podczas pracy nad S-01–S-03)
- **Change ID:** navigation-improvements
- **PRD refs:** —
- **Prerequisites:** F-01
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Czy umieścić pasek we współdzielonym layoucie (`src/layouts/Layout.astro`) czy jako osobny komponent — Owner: impl. Block: no.
  - Zakres pozycji nawigacji (kolekcja, dashboard, eksport, wylogowanie) — Owner: impl. Block: no.
- **Risk:** niskie ryzyko; uwaga, by dodanie paska nie zduplikowało nawigacji na stronach, które już ją mają, i nie pojawiał się na stronach auth (signin/signup)
- **Status:** done

### S-06: Powtórki SRS w aplikacji (zewnętrzna biblioteka)

- **Outcome:** zalogowany użytkownik może uczyć się swoich fiszek wewnątrz aplikacji w sesji powtórek sterowanej harmonogramem spaced-repetition; algorytm SRS pochodzi z zewnętrznej biblioteki (np. ts-fsrs), a nie z własnej implementacji — aplikacja przechowuje stan powtórki per fiszka i podsuwa do nauki te, które są na termin
- **Change ID:** srs-flow
- **PRD refs:** —
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Wybór biblioteki SRS (ts-fsrs / inna) i jej dojrzałość/licencja — Owner: impl. Block: no.
  - Pola stanu powtórki do dołożenia do schematu fiszek (due, stability, difficulty, reps itp.) = nowa migracja — Owner: impl. Block: no.
  - Zakres UI sesji nauki (ocena odpowiedzi, kolejność, koniec sesji) — Owner: design. Block: no.
- **Risk:** rozszerza zakres MVP poza pierwotne Non-Goal "własny scheduler" — świadoma decyzja użytkownika, by dodać SRS przez integrację, nie własny algorytm; ryzyko to dodatkowe pola w schemacie i utrzymanie zależności, ale uniknięcie pisania algorytmu od zera mocno ogranicza koszt
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID             | Suggested issue title                                            | Ready for `/10x-plan` | Notes                                            |
|------------|-----------------------|------------------------------------------------------------------|-----------------------|--------------------------------------------------|
| F-01       | flashcard-schema      | Schema: tabela flashcards z migracją Supabase i politykami RLS   | yes                   | Uruchom `/10x-plan flashcard-schema`             |
| S-01       | ai-generation-flow    | Feature: AI generation flow (wklej → kandydaci → kolekcja)      | no                    | Czeka na F-01; LLM: OpenRouter (resolved 2026-05-26) |
| S-02       | collection-management | Feature: zarządzanie kolekcją (manual add + browse + edit + del) | no                    | Czeka na F-01; ready po wdrożeniu schematu       |
| S-03       | anki-csv-export       | Feature: eksport CSV do Anki                                     | no                    | Czeka na F-01; ready po wdrożeniu schematu       |
| S-04       | ui-improvements       | UI: spójne tło i kolory przycisków między zakładkami (/collection) | no                  | Planned; rozbieżność na `/collection` zauważona przy S-02–S-03 |
| S-05       | navigation-improvements | Nawigacja: pasek nawigacji na `/collection` i `/dashboard`       | no                  | Planned; równolegle z S-04; brak paska zauważony przy S-01–S-03 |
| S-06       | srs-flow              | SRS: powtórki w aplikacji przez zewnętrzną bibliotekę (np. ts-fsrs) | no                  | Planned; zauważone przy S-03; integracja biblioteki zamiast własnego algorytmu |

## Open Roadmap Questions

1. ~~**Wybór dostawcy LLM (OpenAI / Anthropic / OpenRouter / inny)** — Owner: user. Block: S-01 (bez tej decyzji S-01 nie nadaje się do planowania).~~ **Resolved: OpenRouter** (2026-05-26).
2. **Prompt engineering pod różne długości wejścia (Q1 PRD)** — Owner: impl. Block: no. Eksperyment z rzeczywistymi inputami podczas implementacji S-01.
3. **Limit długości wejścia i strategia przekroczenia (Q2 PRD)** — Owner: impl. Block: no. Decyzja (cap / chunking / odmowa) do podjęcia przy kodowaniu S-01.
4. **Kryteria "fiszki godnej / trywialnej" (Q3 PRD)** — Owner: impl. Block: no. Konkretne kryteria wyłonią się z iteracji nad promptem w S-01.
5. **Reset hasła — link w UI logowania? (Q4 PRD)** — Owner: design. Block: no. "Email do admina" jako fallback; ewentualny link w UI do rozstrzygnięcia przy S-01 lub osobno.
6. **Sesja: długość i 'remember me' (Q5 PRD)** — Owner: impl. Block: no. Konkretna wartość session lifetime — do impl decision (auth już działa, konfiguracja Supabase).
7. **CSV format kompatybilny z Anki — konkretne kolumny i escape rules (Q7 PRD)** — Owner: impl. Block: no. Do rozstrzygnięcia przy S-03.

## Parked

- **Własny algorytm spaced-repetition (SuperMemo / Anki scheduler)** — PRD §Non-Goals: budowanie własnego SRS = miesiące pracy. Uwaga: powtórki SRS *przez zewnętrzną bibliotekę* (bez pisania algorytmu) są teraz w zakresie jako S-06; parked dotyczy wyłącznie własnej implementacji algorytmu.
- **Import wielu formatów (PDF, DOCX, EPUB)** — PRD §Non-Goals: parsing + OCR + edge cases poza MVP; tylko surowy tekst (paste).
- **Współdzielenie zestawów fiszek między użytkownikami** — PRD §Non-Goals: wymaga ACL, flag publiczny/prywatny — duże nakłady.
- **Integracje z innymi platformami edukacyjnymi** — PRD §Non-Goals: brak partnerstw i API.
- **Aplikacja mobilna (iOS, Android, PWA)** — PRD §Non-Goals: tylko web desktop w MVP.
- **Fiszki edukacyjne ogólne (historia, biologia, programowanie)** — wyłonione w shaping: inny produkt.
- **Własny *scheduler* powtórek (algorytm od zera)** — wyłonione w shaping: Anki obsługuje SRS po imporcie CSV. UI nauki + harmonogram oparty o gotową bibliotekę SRS są w zakresie jako S-06; parked dotyczy własnego algorytmu schedulera.
- **Self-service usuwania konta** — wyłonione w shaping: overkill dla małego deploymentu; email do admina jako fallback.
- **Reset hasła (full forgot-password flow)** — wyłoniony w shaping: poza MVP; admin manualnie resetuje.
- **Deduplication przy generacji** — wyłoniony w shaping: lookup per kandydat = koszt poza MVP; user filtruje duplikaty ręcznie.
- **Level-adaptive generation (profil A1–C1)** — wyłoniony w shaping: adaptive prompting = v2+.
- **Search / sort / filter w widoku kolekcji** — wyłoniony w shaping: flat list staje się write-only powyżej ~200 fiszek; v2+ po feedbacku.
- **Statystyki postępu nauki (streaks, success rate)** — wyłoniony w shaping: brak własnego SRS = brak własnych metryk; Anki dostarcza statystyki po imporcie.
- **Observability / monitoring (logging, error tracking, metryki)** — świadoma decyzja MVP: cel `speed` + mały deployment → console.error wystarczy w MVP.

## Done

(Puste przy pierwszej generacji. `/10x-archive` dopisuje wpis tutaj — i zmienia `Status` danego elementu na `done` — gdy zmiana o pasującym `Change ID` zostaje zarchiwizowana.)

- **S-03: zalogowany użytkownik może pobrać plik CSV zawierający wszystkie swoje fiszki w formacie Anki basic (słowo przód / tłumaczenie tył / opcjonalny kontekst); znaki specjalne (diakrytyki, cudzysłowy, przecinki) przechodzą round-trip do Anki poprawnie; pusta kolekcja pokazuje komunikat zamiast pustego pliku** — Archived 2026-05-28 → `context/archive/2026-05-28-anki-csv-export/`. Lesson: —.
- **S-04: wszystkie zakładki aplikacji mają spójny wygląd — strona `/collection` używa tego samego tła i kolorów przycisków co pozostałe zakładki (rozbieżność zauważona podczas pracy nad S-02–S-03)** — Archived 2026-05-31 → `context/archive/2026-05-30-ui-improvements/`. Lesson: —.
- **S-05: każda strona aplikacji ma pasek nawigacji — strony `/collection` i `/dashboard`, którym go brakuje, otrzymują spójny pasek nawigacji ułatwiający przechodzenie między widokami (brak zauważony podczas pracy nad S-01–S-03)** — Archived 2026-05-31 → `context/archive/2026-05-31-navigation-improvements/`. Lesson: —.
- **S-06: zalogowany użytkownik może uczyć się swoich fiszek wewnątrz aplikacji w sesji powtórek sterowanej harmonogramem spaced-repetition; algorytm SRS pochodzi z zewnętrznej biblioteki (np. ts-fsrs), a nie z własnej implementacji — aplikacja przechowuje stan powtórki per fiszka i podsuwa do nauki te, które są na termin** — Archived 2026-05-31 → `context/archive/2026-05-31-srs-flow/`. Lesson: —.
