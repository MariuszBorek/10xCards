---
title: "10xCards — Destylacja domeny biznesowej"
created: 2026-06-12
type: domain-distillation
---

# 10xCards — Destylacja domeny biznesowej

> **Produkt tego dokumentu to MAPA domeny, nie kod.** Niczego nie założono z góry —
> nazwy bytów, reguł i numerów wymagań pochodzą z odkrytych źródeł. Każde twierdzenie
> jest zakotwiczone cytatem `plik:linia`, który zweryfikowano w repozytorium.

## KROK 0 — Kontekst projektu (odkrycie)

### Materiał źródłowy (przeczytany)

| Dokument           | Ścieżka                                                      | Rola                                                                           |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| PRD                | `context/foundation/prd.md`                                  | Główne źródło wymagań (FR-001…FR-011, Success Criteria, Guardrails, Non-Goals) |
| Roadmap            | `context/foundation/roadmap.md`                              | Sekwencja slice'ów F-01…S-06; dokument rozjemczy między PRD a kodem            |
| Migracja schematu  | `supabase/migrations/20260527000000_flashcard_schema.sql`    | Tabela `flashcards` + RLS                                                      |
| Migracja SRS       | `supabase/migrations/20260531000000_flashcard_srs_state.sql` | Stan powtórek FSRS                                                             |
| README / CLAUDE.md | korzeń repo                                                  | Stack, konwencje, twarde reguły                                                |

Dokumenty wymagań **istnieją i są bogate** — to NIE jest sytuacja „tylko README + kod".
Dostępna jest pełna narracja (PRD → roadmap → archiwum 9 zmian w `context/archive/`),
co pozwala porównać deklarowaną wiedzę domenową z jej odwzorowaniem w kodzie.

### Stack i topologia logiki biznesowej

- **Astro 6 SSR** (`output: "server"`) + React 19 islands, deploy na Cloudflare Workers.
- **Supabase** (Postgres + Auth + RLS) jako persystencja i tożsamość.
- Warstwy, gdzie żyje logika:
  - **API / trasy**: `src/pages/api/flashcards/*` — walidacja (zod), autoryzacja, orkiestracja.
  - **Serwisy domenowe**: `src/lib/services/{generate,srs,anki-export}.ts` — wyekstrahowana logika.
  - **Persystencja + niezmienniki danych**: `supabase/migrations/*.sql` (NOT NULL, CHECK, RLS).
  - **UI**: `src/components/{generate,collection,review}/*`.
- **Brak warstwy domenowej w sensie DDD** (brak Entity/Aggregate/Value Object jako obiektów).
  Logika domenowa jest rozproszona między: ograniczenia SQL, schematy zod w trasach i serwisy
  proceduralne. „Fiszka" istnieje jako `interface Flashcard` (`src/types.ts:1`) — anemiczny
  rekord danych, bez metod egzekwujących reguły.

**Ograniczenie analizy:** brak dedykowanej warstwy domeny oznacza, że niezmienniki trzeba
tropić w trzech różnych miejscach (DB / zod / serwis), a nie w jednym agregacie. Mapę rozjazdów
(KROK 4) zbudowano właśnie na tej asymetrii.

---

## KROK 1 — Ubiquitous Language

Pojęcia wyciągnięte z dokumentów ORAZ z kodu. „BRAK w kodzie" = termin żyje w domenie,
ale nie ma odpowiednika w implementacji.

| Pojęcie                               | Definicja                                                                                        | Cytat źródłowy (dokument)                                               | Gdzie żyje w kodzie                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Flashcard / Fiszka**                | Para `słowo ↔ tłumaczenie` + opcjonalny kontekst, należąca do jednego użytkownika                | `prd.md:104` (FR-007); `prd.md:132` (Business Logic)                    | `src/types.ts:1-20`; tabela `…flashcard_schema.sql:2-10`                                                                            |
| **Candidate / Kandydat**              | Propozycja fiszki wygenerowana przez AI, jeszcze niezapisana; ma 3 akcje: akceptuj/odrzuć/edytuj | `prd.md:97` (FR-005); `prd.md:135`                                      | `FlashcardCandidate` `src/types.ts:37-41`; `generate.ts:25`                                                                         |
| **Generation input / Wklejony tekst** | Surowy obcojęzyczny tekst (słowo→akapit) konsumowany przez regułę generacji; **transient**       | `prd.md:132-134`; `prd.md:50,126` (guardrail transient)                 | `generate.ts:25` (param `input`); cap `generate.ts:11` (`MAX_INPUT_LENGTH`)                                                         |
| **Worthy / Trivial flashcard**        | Reguła: AI zachowuje słowa „warte fiszki", odrzuca trywialne/oczywiste                           | `prd.md:134` (b/c); Open Q#3 `prd.md:175`                               | **Tylko w prompcie** `generate.ts:10-11` ("Skip function words… so common it would already be known"). BRAK jako reguła kodu/danych |
| **Collection / Kolekcja**             | Pełna lista fiszek danego użytkownika (flat list w MVP)                                          | `prd.md:109` (FR-008)                                                   | Implicit — `select("*")` w `flashcards/index.ts:22`; brak bytu „Collection"                                                         |
| **Translation language**              | Język tłumaczenia kandydatów                                                                     | `prd.md:132` ("tłumaczenie"); implikuje język ojczysty persony          | **Zakodowany na sztywno = polski** `generate.ts:9`                                                                                  |
| **Review / Powtórka SRS**             | Sesja nauki w aplikacji wg harmonogramu spaced-repetition                                        | roadmap S-06 `roadmap.md:139-141`; **w PRD jako Non-Goal** `prd.md:163` | `srs.ts:107` (`reviewCard`); trasa `flashcards/[id]/review.ts`                                                                      |
| **Due card / Karta na termin**        | Fiszka, której `due <= now` — podsuwana do powtórki, najstarsza pierwsza                         | roadmap `roadmap.md:141`; migracja komentarz `…srs_state.sql:18`        | `DueCard` `src/types.ts:26-28`; `getDueCards` `srs.ts:71-100`                                                                       |
| **Rating / Ocena**                    | Cztery oceny odpowiedzi: again/hard/good/easy → ts-fsrs Rating                                   | `srs.ts:22` (komentarz)                                                 | `ReviewRating` `src/types.ts:23`; `RATING_MAP` `srs.ts:18-23`                                                                       |
| **FSRS state**                        | Stan harmonogramu per fiszka (due, stability, difficulty, reps, lapses, state…)                  | migracja `…srs_state.sql:2-16`                                          | 10 kolumn `src/types.ts:9-19`; mapowanie `srs.ts:30-60`                                                                             |
| **Anki export**                       | Plik TSV (`#separator:tab`) importowalny do Anki bez ręcznej modyfikacji                         | `prd.md:118` (FR-011); US-02 `prd.md:70-80`                             | `anki-export.ts:31` (`buildAnkiTsv`); trasa `flashcards/export.ts`                                                                  |
| **Data isolation / Izolacja kont**    | Żaden użytkownik nie widzi cudzych fiszek ani cudzego wejścia — twardy guardrail                 | `prd.md:49`; `prd.md:140` (Access Control)                              | 4 polityki RLS `…flashcard_schema.sql:13-27`                                                                                        |
| **Acceptance rate / AI-share**        | Metryki sukcesu: ≥75% kandydatów AI zaakceptowanych; ≥75% kolekcji powstaje przez AI             | `prd.md:40-41` (Primary Success Criteria)                               | **BRAK w kodzie** — patrz KROK 4, rozjazd #1                                                                                        |
| **Account (flat user)**               | Płaski model użytkowników — brak ról (admin/premium/free)                                        | `prd.md:140`                                                            | `auth.users` (Supabase); `context.locals.user` (middleware)                                                                         |

---

## KROK 2 — Klasyfikacja subdomen

Rdzeń = to, co stanowi przewagę i sens produktu. Odwołanie do wizji: _„Wartość 10xCards leży
w połączeniu… (1) generowania fiszek z dowolnego tekstu…"_ (`prd.md:24`) i north star
_„jakość generacji AI: jeśli kandydaci są złej jakości, cały produkt traci rację bytu"_
(`roadmap.md:20,24`).

| Obszar                                                                      | Kategoria                                      | Uzasadnienie (cel produktu)                                                                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI Flashcard Generation** (ekstrakcja kandydatów + reguła worthy/trivial) | **CORE**                                       | North star S-01 (`roadmap.md:23-24`); jedyna weryfikacja kluczowej hipotezy. To różnicownik wobec ręcznego przepisywania (`prd.md:22-24`). Cały sens produktu.             |
| **Reguła „worthy vs trivial"** (co warte fiszki)                            | **CORE** (pod-reguła generacji)                | To jakościowy rdzeń: Success Criterion „≥75% kandydatów zaakceptowanych" (`prd.md:40`) mierzy WŁAŚNIE tę regułę.                                                           |
| **Flashcard lifecycle / Collection** (manual add, browse, edit, delete)     | **SUPPORTING**                                 | Niezbędne dla wartości (gdzie lądują zaakceptowane fiszki), ale to standardowy CRUD — nie przewaga. FR-007…FR-010 `prd.md:104-114`.                                        |
| **Anki Export** (most do ekosystemu SRS)                                    | **SUPPORTING**                                 | Realizuje „integrację z gotowym ekosystemem powtórek" (`prd.md:24`), ale wartość = istniejący Anki, nie nasz kod. Format prosty (`prd.md:119`).                            |
| **SRS Review in-app** (S-06)                                                | **SUPPORTING** (z napięciem — patrz KROK 4 #3) | Algorytm pochodzi z **zewnętrznej** biblioteki ts-fsrs (`srs.ts:1`), więc rdzeniowej wiedzy domenowej tu nie tworzymy — integrujemy. W PRD wprost Non-Goal (`prd.md:163`). |
| **Authentication + Data Isolation** (login, RLS)                            | **GENERIC**                                    | W 100% off-the-shelf: Supabase Auth + Postgres RLS. Płaski model bez ról (`prd.md:140`). Guardrail izolacji jest krytyczny, ale realizowany gotowym mechanizmem.           |
| **Transient input handling**                                                | **GENERIC** (właściwość, nie subdomena)        | Realizowany strukturalnie przez NIE-zapisywanie wejścia — brak osobnej logiki.                                                                                             |

---

## KROK 3 — Kandydaci na agregaty i ich niezmienniki

| Kandydat na agregat                                | Niezmiennik (MUSI być zawsze prawdziwy)                                                 | Cytat źródłowy                               | Status egzekucji w kodzie                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flashcard** (root)                               | Należy do dokładnie jednego użytkownika                                                 | `prd.md:140` ("tylko na własnych fiszkach")  | **EGZEKWUJE** — `user_id UUID NOT NULL REFERENCES auth.users` `…flashcard_schema.sql:4` + RLS `:13-27`                                                      |
| **Flashcard**                                      | `word` i `translation` zawsze niepuste                                                  | `prd.md:104` (FR-007); `prd.md:132`          | **EGZEKWUJE (podwójnie)** — DB `NOT NULL` `…flashcard_schema.sql:5-6` + zod `min(1)` `flashcards/index.ts:35-36`, `[id].ts:9-10`                            |
| **Flashcard**                                      | Raz zaakceptowana fiszka nie znika bez intencjonalnego usunięcia („Brak utraty fiszek") | `prd.md:51` (Guardrail)                      | **CZĘŚCIOWO** — usunięcie tylko przez explicit DELETE z confirm; ale kolumna `deleted_at` istnieje i NIE jest używana jako siatka bezpieczeństwa (patrz #2) |
| **Flashcard**                                      | Użytkownik widzi/operuje tylko własne                                                   | `prd.md:49,140`                              | **EGZEKWUJE (RLS)** — ale niespójnie wzmacniane filtrem `user_id` (patrz #4)                                                                                |
| **GenerationRequest / CandidateBatch** (transient) | Wklejony tekst nie pozostaje w storage po przetworzeniu                                 | `prd.md:50,126` (Guardrail + NFR)            | **EGZEKWUJE strukturalnie** — `generate.ts` i trasa `generate.ts` nigdy nie zapisują `input` do DB; żyje tylko w pamięci żądania                            |
| **GenerationRequest**                              | Wejście ograniczone (nie cały dokument)                                                 | `prd.md:174` (Open Q#2)                      | **EGZEKWUJE** — `MAX_INPUT_LENGTH = 5000` `flashcards/generate.ts:11,18`                                                                                    |
| **CandidateBatch**                                 | AI zwraca tylko „worthy" jednostki, odrzuca trywialne                                   | `prd.md:134` (Business Logic)                | **DEKLARUJE (miękko)** — wyłącznie instrukcja w prompcie `generate.ts:10-11`; brak twardej reguły; jakość niemierzalna (patrz #1)                           |
| **ReviewState** (osadzony w Flashcard, 1:1)        | `state` ∈ {0,1,2,3}                                                                     | migracja `…srs_state.sql:15`                 | **EGZEKWUJE** — `CHECK (state BETWEEN 0 AND 3)` `…srs_state.sql:15`                                                                                         |
| **ReviewState**                                    | `reps` rośnie monotonicznie; brak lost-update przy współbieżnej ocenie                  | `srs.ts:129-132` (komentarz + lessons.md)    | **EGZEKWUJE** — optymistyczna blokada `.eq("reps", row.reps)` `srs.ts:138`; konflikt → 409                                                                  |
| **ReviewState**                                    | Do powtórki trafiają tylko karty `due <= now`, najstarsze pierwsze                      | migracja `…srs_state.sql:18`; `srs.ts:79-80` | **EGZEKWUJE** — `lte("due", now)…order("due")` `srs.ts:79-80`                                                                                               |

---

## KROK 4 — Rozjazdy MODEL vs KOD

> Najcenniejsza część: gdzie wiedza domenowa istnieje w dokumentach, a kod jej nie odwzorowuje
> (albo odwzorowuje inaczej). Uszeregowane od najpoważniejszego.

| #     | Dokument mówi X                                                                                                                          | Kod robi Y                                                                                                                                                                                                                                                                                                                              | Dowód (plik:linia)                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Sukces produktu = mierzalny: „≥75% kandydatów AI zaakceptowanych" i „≥75% kolekcji powstaje przez AI"** (dwa Primary Success Criteria) | **Kod nie odróżnia fiszek AI od ręcznych** — brak kolumny `source`/`origin`; zaakceptowany kandydat i ręczna fiszka zapisują IDENTYCZNY wiersz tym samym `POST /api/flashcards`. Akceptacja/odrzucenie kandydata nie jest nigdzie liczone. **Obie metryki sukcesu są niemierzalne.**                                                    | Brak `source` w `…flashcard_schema.sql:2-10` i `src/types.ts:1-20`; ten sam INSERT dla obu ścieżek `flashcards/index.ts:69-73`; success criteria `prd.md:40-41`                                           |
| **2** | **Guardrail „Brak utraty fiszek"**; PRD §FR-010: „hard-delete w MVP… soft-delete można dodać później" (`prd.md:114`)                     | **Kolumna `deleted_at` istnieje i jest na wpół martwa**: (a) DELETE robi **HARD delete**, nigdy nie ustawia `deleted_at`; (b) lista kolekcji NIE filtruje `deleted_at`; (c) tylko serwis SRS broni się filtrem na kolumnie, której nic nie zapala. Niezmiennik soft-delete zadeklarowany w 3 miejscach, egzekwowany w 0 ścieżek zapisu. | `deleted_at` w schemacie `…srs_state.sql` (brak — kolumna z `…flashcard_schema.sql:8`); HARD delete `flashcards/[id].ts:84`; brak filtra w liście `flashcards/index.ts:22`; filtr tylko w `srs.ts:78,120` |
| **3** | **PRD: „Własne UI nauki + integracja z algorytmem SRS" = Non-Goal** (`prd.md:163`); „Statystyki postępu… v2+" (`prd.md:169`)             | **Pełny flow powtórek SRS jest zaimplementowany** (ts-fsrs, trasy `/api/flashcards/due` i `/[id]/review`, migracja 10 kolumn, `ReviewSession.tsx`). PRD jest **nieaktualny** względem roadmapy, która świadomie rozszerzyła zakres (S-06).                                                                                              | Kod: `srs.ts:1-147`, `flashcards/due.ts`, `flashcards/[id]/review.ts`, `…srs_state.sql`; rozjemca: `roadmap.md:139-152` ("rozszerza zakres MVP poza pierwotne Non-Goal"); stale PRD `prd.md:163`          |
| **4** | **Izolacja danych = twardy guardrail** (`prd.md:49`) — implikuje obronę w głąb                                                           | **Niespójne wzmocnienie**: lista (`select("*")`), eksport, PATCH i DELETE polegają **wyłącznie na RLS** (brak `.eq("user_id")`); tylko serwis SRS dokłada jawny filtr `user_id`. Jeden błąd w polityce RLS = wyciek bez drugiej linii obrony na ścieżkach kolekcji.                                                                     | Brak `user_id` filtra: `flashcards/index.ts:22`, `export.ts:26-29`, `[id].ts:48-53,84`; jawny filtr: `srs.ts:77,118,137`                                                                                  |
| **5** | **Business Logic: „generuje… tłumaczenie"** dla persony uczącej się **języka obcego** — implikuje język ojczysty użytkownika             | **Język tłumaczenia zakodowany na sztywno = polski**, niezależnie od użytkownika. Akceptowalne dla single-user MVP (autor), ale zawęża model multi-user, który PRD deklaruje od dnia 1 (`prd.md:34`).                                                                                                                                   | `generate.ts:9` ("Always use Polish as the translation language, regardless of the source language") vs wieloużytkownikowość `prd.md:34,148`                                                              |
| **6** | **„Fiszka godna / trywialna" — reguła domenowa** z otwartymi kryteriami (Open Q#3, `prd.md:175`)                                         | Reguła żyje **wyłącznie jako zdanie w prompcie** — brak progu, frequency rank, miary trudności; niewersjonowana, nietestowalna jako reguła. To świadoma decyzja MVP, ale rdzeniowa reguła jest poza kontrolą kodu.                                                                                                                      | `generate.ts:10-11` (jedyna lokalizacja); status otwarty `prd.md:175`                                                                                                                                     |

---

## KROK 5 — Ranking refaktoru

Uszeregowanie kandydatów wg **wartości** (jak rdzeniowy jest niezmiennik) × **ryzyka**
(jak słabo jest dziś egzekwowany).

| Ranga  | Kandydat                                                      | Wartość                                                                                               | Ryzyko (luka dziś)                                                                                                                                | Wynik  |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **#1** | **Provenance fiszki (`source`: ai \| manual)** — rozjazd #4.1 | **Najwyższa** — to dosłowna definicja sukcesu produktu (oba Primary Success Criteria, `prd.md:40-41`) | **Najwyższe** — 0% pokrycia; hipoteza produktu jest **niefalsyfikowalna** bez tej kolumny                                                         | **#1** |
| **#2** | **Spójność niezmiennika soft-delete** — rozjazd #4.2          | Średnia — guardrail „Brak utraty fiszek" (`prd.md:51`)                                                | Wysokie — kolumna-pułapka: zadeklarowana w 3 miejscach, egzekwowana w 0; przyszły dev filtrujący `deleted_at` w liście po cichu zmieni zachowanie | **#2** |
| **#3** | **Rekonsyliacja PRD ↔ kod dla SRS** — rozjazd #4.3            | Średnia — dokument modelu wprowadza w błąd                                                            | Niskie — kod działa; to dryf dokumentacji, nie błąd runtime                                                                                       | **#3** |
| **#4** | **Jednolita obrona w głąb na `user_id`** — rozjazd #4.4       | Niska (RLS już chroni)                                                                                | Średnie — brak drugiej linii obrony na ścieżkach kolekcji                                                                                         | **#4** |

### #1 do refaktoru — i dlaczego

**Dodać fiszce trwałą proweniencję (`source: 'ai' | 'manual'`) oraz lekki licznik akceptacji/odrzuceń kandydatów.**

To jedyny refaktor, który dotyka **rdzenia sensu produktu**, a nie peryferii. 10xCards istnieje
po to, by AI zastąpiło ręczne przepisywanie — a obie miary tego, czy to się udaje
(`≥75% kandydatów zaakceptowanych`, `≥75% kolekcji z AI`), są dziś **niemożliwe do policzenia**,
bo wiersz zaakceptowanego kandydata jest bit-w-bit identyczny z wierszem ręcznym
(`flashcards/index.ts:69-73`). Produkt nie potrafi odpowiedzieć na pytanie, dla którego powstał.
Wartość najwyższa (definicja sukcesu) spotyka ryzyko najwyższe (zerowa egzekucja) — to czyni go
bezkonkurencyjnym #1. Pozostałe rozjazdy to korekty bezpieczeństwa i higieny dokumentacji;
ten jeden decyduje, czy w ogóle wiadomo, że produkt działa.

---

## Podsumowanie

Artefakt destyluje domenę 10xCards z bogatego materiału źródłowego (PRD, roadmap, dwie migracje,
9 zarchiwizowanych zmian) i mapuje ją na rozproszoną implementację Astro SSR + Supabase, w której
logika domenowa żyje w trzech warstwach (ograniczenia SQL, schematy zod, serwisy), bez dedykowanej
warstwy agregatów. Zbudowano Ubiquitous Language (13 pojęć z cytatami), sklasyfikowano subdomeny
— **rdzeniem jest generacja kandydatów AI wraz z regułą „worthy vs trivial"**, podczas gdy kolekcja,
eksport i powtórki SRS to subdomeny wspierające, a auth/izolacja są generyczne. Wskazano kandydatów
na agregaty (Flashcard jako root, transient GenerationRequest, osadzony ReviewState) i ich
niezmienniki: część jest egzekwowana solidnie (własność `user_id`, niepuste `word`/`translation`,
`state ∈ 0..3`, guard lost-update na `reps`, transient input), a część tylko deklarowana.
Najważniejszy wniosek to lista 6 rozjazdów MODEL↔KOD, z których **#1 — brak proweniencji fiszki
(`source: ai|manual`) — czyni oba kryteria sukcesu produktu niemierzalnymi** i jest rekomendowanym
refaktorem o najwyższym priorytecie. Dwa kolejne sygnały warte uwagi: kolumna `deleted_at` jest
„na wpół martwa" (zadeklarowany, lecz nieegzekwowany soft-delete), a PRD jest nieaktualny względem
roadmapy w sprawie SRS (zaimplementowany flow powtórek wciąż figuruje w PRD jako Non-Goal).
