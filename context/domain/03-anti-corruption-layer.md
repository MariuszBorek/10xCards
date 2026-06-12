---
title: "10xCards — Warstwa antykorupcyjna dla przeciekającej zależności (plan refaktoru)"
created: 2026-06-12
type: refactor-plan
---

# 10xCards — Anti-Corruption Layer dla przeciekającej zależności

> **Produkt tego dokumentu to PLAN refaktoru, nie kod.** Każde twierdzenie o stanie bieżącym
> jest zakotwiczone cytatem `plik:linia` zweryfikowanym w repozytorium. Trzeci dokument serii
> domenowej: `01-domain-distillation.md` ZMAPOWAŁ domenę, `02-invariant-aggregate-refactor.md`
> wybrał niezmiennik rdzeniowy i zaprojektował agregat-strażnik. Ten ODKRYWA, którą **zewnętrzną
> zależność** przepuszczamy przez granice warstw, WYBIERA najgorszy przeciek i projektuje
> **warstwę antykorupcyjną (ACL)** — jedyne miejsce wiedzy o kształcie tej zależności.

## KROK 0 — Kontekst odkryty

**Stack** (`package.json`, README): Astro 6 SSR + React 19 islands + Supabase (Postgres + Auth +
RLS) + Tailwind 4, deploy Cloudflare Workers. **Warstwy kodu:** persystencja (`supabase/migrations/*`),
trasy API (`src/pages/api/*` — `prerender = false`, walidacja zod), serwisy (`src/lib/services/*`),
typy współdzielone (`src/types.ts`), wyspy React (`src/components/*`).

**Zależności zewnętrzne z manifestu** (`package.json:22-46`), kandydaci do przecieku przez warstwy:

| Pakiet                                   | Rola                                              | Pierwsza ocena przecieku                |
| ---------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| **`ts-fsrs@^5.4.1`**                     | algorytm spaced-repetition (harmonogram powtórek) | **silny przeciek** — patrz niżej        |
| `@supabase/ssr`, `@supabase/supabase-js` | klient DB + Auth                                  | słaby przeciek (DI'owany) — kandydat #2 |
| `zod@^4`                                 | walidacja wejścia w trasach                       | brak przecieku (żyje tylko w trasach)   |
| `ts-fsrs` typy `Card/Rating/State`       | **kontrakt danych** biblioteki                    | **to jest właściwy nośnik przecieku**   |

**Deklaracja wymienialności (kluczowy sygnał).** Roadmapa traktuje bibliotekę SRS jako **celowo
wymienialną integrację**, nie własny kod:

- _„algorytm SRS pochodzi z **zewnętrznej** biblioteki (np. ts-fsrs), a nie z własnej implementacji"_
  (`roadmap.md:141`).
- Otwarta decyzja na wprost: _„Wybór biblioteki SRS (**ts-fsrs / inna**) i jej dojrzałość/licencja"_
  (`roadmap.md:148`).
- Dokument 01 klasyfikuje SRS jako subdomenę **WSPIERAJĄCĄ**: _„Algorytm pochodzi z zewnętrznej
  biblioteki ts-fsrs… więc rdzeniowej wiedzy domenowej tu nie tworzymy — **integrujemy**"_
  (`01-domain-distillation.md:86`).

To intencja: „ts-fsrs ma dać się wymienić". KROK 3 pokaże, że **kod jej nie dotrzymuje**.

---

## KROK 1 — IDENTYFIKACJA przeciekających zależności

### 1.1 `ts-fsrs` — przeciek przez KSZTAŁT, nie przez symbol

Plik serwisu **deklaruje izolację wprost**:

```
src/lib/services/srs.ts:6-8   "The single home for ts-fsrs usage … Routes and the client never import ts-fsrs."
```

Dla **instrukcji `import`** to prawda — grep symbolu pakietu trafia tylko w serwis i komentarze typów:

```
src/lib/services/srs.ts:1     import { fsrs, Rating, show_diff_message, type Card, type Grade } from "ts-fsrs";
src/types.ts:9,22             (tylko komentarze: "ts-fsrs Card, mapped 1:1", "maps to ts-fsrs Rating")
```

Ale **KSZTAŁT danych biblioteki** — 10-polowy interfejs `Card`, enum `State` (0..3), semantyka
`Rating/Grade` — przeciekł **strukturalnie** do trzech innych warstw, gdzie został **zrekonstruowany
1:1**. Cztery równoległe kopie tej samej listy 10 pól:

| #   | Kopia kształtu `ts-fsrs.Card`                                    | Dowód (`plik:linia`)                                                                                                                |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Persystencja** — 10 kolumn, komentarz przyznaje 1:1            | `…flashcard_srs_state.sql:2` (_„Columns map 1:1 to the **ts-fsrs@5.4.1 Card interface** (10 persistable fields)"_); kolumny `:7-16` |
| K2  | **Typ współdzielony** — `interface Flashcard` osadza 10 pól FSRS | `src/types.ts:9-19` (komentarz `:9` _„ts-fsrs Card, mapped 1:1"_)                                                                   |
| K3  | **Mapper hydratacji** DB→Card                                    | `srs.ts:29-43` (`rowToCard`)                                                                                                        |
| K4  | **Mapper serializacji** Card→DB                                  | `srs.ts:45-60` (`cardToColumns`)                                                                                                    |

Dodatkowo enum `State` biblioteki (potwierdzony w dokumentacji: `New/Learning/Review/Relearning`)
jest **zakodowany jako liczba** w więzie DB i w typie: `CHECK (state BETWEEN 0 AND 3)`
(`…flashcard_srs_state.sql:15`) oraz `state: number` (`types.ts:18`). Numeryczna kardynalność enuma
biblioteki stała się ograniczeniem bazy danych.

### 1.2 Przeciek przez granicę serwer→klient (kontrakt wire)

`Flashcard` (z 10 polami FSRS) jest bazą **DTO odpowiedzi API**, więc kształt `Card` jedzie
**przez sieć do przeglądarki**:

```
src/types.ts:25-28            interface DueCard extends Flashcard { preview: … }      ← 10 pól FSRS + preview
src/pages/api/flashcards/due.ts:3,22-23    getDueCards → return { cards }            ← DueCard[] na wire
src/pages/api/flashcards/[id]/review.ts:4,45-46  reviewCard → return { card }        ← pełny Flashcard na wire
src/pages/api/flashcards/index.ts:22,28    select("*") → return { flashcards: data } ← wszystkie kolumny FSRS na wire
src/pages/api/flashcards/index.ts:73,79    POST insert → return { flashcard: data }  ← pełny Flashcard na wire
```

Klient **deserializuje payload, którego kształt dyktuje `ts-fsrs`**, mimo że używa tylko 5 pól:

```
src/components/review/ReviewSession.tsx:4    import type { DueCard, ReviewRating } from "@/types";
src/components/review/ReviewSession.tsx:17   const [cards, setCards] = useState<DueCard[]>([]);
src/components/review/ReviewSession.tsx:29,33 json.cards as DueCard[]  → setCards(json.cards)
src/components/review/ReviewSession.tsx:50,88,92-93,120  używa wyłącznie: id, word, translation, context, preview
```

Dziewięć pól harmonogramu (`stability`, `difficulty`, `elapsed_days`, `scheduled_days`,
`learning_steps`, `reps`, `lapses`, `state`, `due`, `last_review`) jest **przesyłane do klienta,
który ich nigdy nie czyta** — kontrakt wire ciągnie za sobą wewnętrzny model biblioteki SRS.

### 1.3 Kontrprzykład w tym samym repo — jak wygląda zrobione dobrze

`anki-export.ts` bierze **tylko domenowe pola**, nie cały rekord biblioteki:

```
src/lib/services/anki-export.ts:31   buildAnkiTsv(rows: Pick<Flashcard, "word" | "translation" | "context">[])
```

To dowód, że projekt POTRAFI zwężać kontrakt do pól domenowych — robi to dla eksportu, ale **nie
dla SRS**, gdzie cały `Card` przecieka do typu, schematu i wire.

### 1.4 `@supabase` — kandydat #2 (dla porównania)

Klient Supabase jest **wstrzykiwany jako parametr** (port de-facto), a `createServerClient`
występuje w **jednym** pliku:

```
src/lib/supabase.ts:1            import { createServerClient, parseCookieHeader } from "@supabase/ssr";  ← jedyne miejsce konstrukcji
src/lib/services/srs.ts:71,108   getDueCards(supabase, …) / reviewCard(supabase, …)   ← klient DI'owany, nie importowany
src/env.d.ts:3                   user: import("@supabase/supabase-js").User | null     ← jedyny przeciek typu
```

Jedyny realny przeciek to typ `User` w `env.d.ts:3`. To **lepiej odizolowane** niż `ts-fsrs` —
dlatego Supabase jest #2, nie #1.

---

## KROK 2 — KLASYFIKACJA i wybór #1

| Oś                                                  | `ts-fsrs`                                                                                                                                                                                          | `@supabase`                                                            | `zod`           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| **(a) warstwy / pliki dotknięte**                   | **4 warstwy / ~7 plików**: DB (migracja), typy (`types.ts`), 4 trasy API, klient (`ReviewSession`)                                                                                                 | 2 (konstruktor w `supabase.ts`, typ `User` w `env.d.ts`); reszta DI    | 1 (tylko trasy) |
| **(b) koszt/ryzyko wymiany dziś**                   | **MAKSYMALNY** — wymiana biblioteki = rename kolumn DB (= nazwy pól `Card`) + migracja danych + zmiana DTO wire + `types.ts`; już dziś pin do wersji (komentarz _„until ts-fsrs v6"_, `srs.ts:51`) | Niski–średni — klient za seamem DI; wymiana dotyka 1 pliku konstrukcji | Znikomy         |
| **(c) deklaracja wymienialności (intencja vs kod)** | **JEST i jest złamana** — roadmapa: „ts-fsrs / **inna**" (`roadmap.md:148`), „integrujemy" (`01:86`); kod welduje `Card` do schematu i wire                                                        | Brak deklaracji, że ma być wymienialny; i tak jest za seamem           | n/d             |

### Wybór #1: **`ts-fsrs`**

Najgorszy przeciek, bo wygrywa na wszystkich trzech osiach naraz:

- **Najszerszy rozsmar** — kształt `Card` jest _de-facto schematem_ tabeli, typu domenowego,
  kontraktu wire i typu stanu Reacta (cztery kopie listy 10 pól: K1–K4 z 1.1).
- **Najwyższy koszt wymiany** — i to **mimo** deklarowanej wymienialności. Nazwy kolumn DB są
  nazwami pól biblioteki (`…srs_state.sql:7-16`), więc „wymień bibliotekę" = „migruj bazę". Pin do
  wersji jest już napięty: pole `elapsed_days` jest oznaczone jako _deprecated_ i utrzymywane tylko
  „dla round-tripu… until ts-fsrs v6" (`srs.ts:51`) — czyli przeciek już dziś blokuje upgrade
  _tej samej_ biblioteki, nie tylko podmianę na inną.
- **Najmocniejszy sygnał rozjazdu intencja↔kod** — dokumenty mówią „to wymienialna integracja
  subdomeny wspierającej" (`roadmap.md:141,148`, `01:86`), a kod traktuje wewnętrzny model
  biblioteki jak własny model domenowy. Dokładnie ten rozjazd ACL ma usunąć.

`@supabase` zostaje **kandydatem #2** (osobny, mniejszy refaktor: schować typ `User` za własnym
`AuthUser`), ale jest już w dużej mierze za seamem DI — nie pali się.

---

## KROK 3 — DIAGNOZA

### 3.1 Duplikacja kształtu (cztery kopie tej samej listy pól)

```
…flashcard_srs_state.sql:7-16   due, stability, difficulty, elapsed_days, scheduled_days,
                                learning_steps, reps, lapses, state, last_review     ← K1 (DB)
src/types.ts:10-19              te same 10 pól jako kolumny interface Flashcard      ← K2 (typ współdzielony)
src/lib/services/srs.ts:30-43   rowToCard: { due, stability, …, last_review }        ← K3 (mapper DB→Card)
src/lib/services/srs.ts:46-60   cardToColumns: { due, stability, …, last_review }    ← K4 (mapper Card→DB)
```

Dodanie/rename/usunięcie pola w `ts-fsrs` wymusza **zsynchronizowaną edycję w czterech miejscach
w trzech warstwach**. Komentarz przy K4 sam to przyznaje: `elapsed_days` jest _deprecated_, ale
trzymane „for round-trip fidelity… **column exists until ts-fsrs v6**" (`srs.ts:51`) — schemat bazy
jest _przypięty do wersji biblioteki_.

### 3.2 Przeciek przez granicę serwer→klient (groźny kierunek)

To nie jest „biblioteka serwerowa w bundlu klienta" (import `ts-fsrs` zostaje na serwerze —
`srs.ts:1`), ale **jego DANE** przekraczają granicę: wire DTO `DueCard` (`types.ts:25-28`) niesie
10 pól FSRS, a `ReviewSession` trzyma je w stanie Reacta (`ReviewSession.tsx:17`), czytając z nich
tylko 5 (`:50,88,92-93,120`). Wewnętrzny model harmonogramu biblioteki stał się **publicznym
kontraktem API** — każdy konsument (klient, przyszłe integracje) jest sprzężony z `ts-fsrs`.

### 3.3 Rozjazd deklaracja↔kod (cytat + dowód złamania)

| Deklaracja (intencja)                                                                                                | Dowód, że kod jej nie dotrzymuje                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| „algorytm SRS pochodzi z **zewnętrznej** biblioteki (np. ts-fsrs), a nie z własnej implementacji" (`roadmap.md:141`) | Nazwy kolumn = nazwy pól `Card`; migracja przyznaje „map 1:1 to the ts-fsrs Card interface" (`…srs_state.sql:2`) — biblioteka _jest_ schematem |
| „Wybór biblioteki SRS (ts-fsrs / **inna**)" jako otwarta decyzja (`roadmap.md:148`)                                  | Wymiana „na inną" dziś dotyka DB + typów + 4 tras + klienta (KROK 1) — decyzja faktycznie zabetonowana                                         |
| „integrujemy" (subdomena wspierająca, `01:86`)                                                                       | `Flashcard` (rdzeń kolekcji) osadza 10 pól biblioteki SRS (`types.ts:9-19`) — wspierające „wyciekło" w rdzeń                                   |

### 3.4 Otwarte pytanie zależne od kontraktu biblioteki

`elapsed_days` jest _deprecated_ w `ts-fsrs` (eslint-disable `@typescript-eslint/no-deprecated`,
`srs.ts:51`) i — wg dokumentacji oraz komentarza w kodzie — znika w v6. Dziś decyzja „czy nadal
persystować to pole" jest **rozsmarowana**: zaszyta w komentarzu mappera (`srs.ts:51`), w komentarzu
migracji (`…srs_state.sql:2`) i w typie (`types.ts:13`). Nie ma jednego miejsca, gdzie ta decyzja
kontraktowa należy. **Rozstrzygnięcie (KROK 4.6):** to decyzja adaptera ACL, nie warstwy API ani
schematu współdzielonego.

**Podsumowanie diagnozy:** deklarowana izolacja `ts-fsrs` jest prawdziwa tylko dla _importu_; jego
_kształt danych_ przeciekł do persystencji, typu współdzielonego i kontraktu wire (4 kopie pól,
3 warstwy), a numeryczny enum `State` zabetonował się w więzie DB. Intencja („wymienialna integracja
wspierająca") rozjeżdża się z kodem („model biblioteki = nasz schemat"). To czyni `ts-fsrs` przeciekiem
#1.

---

## KROK 4 — PROJEKT ACL

### 4.1 Granica i nazwa: value object `ReviewSchedule` + port `Scheduler`

ACL = **jeden moduł** `src/lib/domain/review-schedule.ts`, który jako **jedyny** zna `ts-fsrs`.
Reszta kodu zna wyłącznie:

- **`ReviewSchedule`** — domenowy _value object_ niezmiennego stanu powtórki (opaque dla wyższych
  warstw; jego pola wewnętrzne to szczegół adaptera).
- **`CardState`** — domenowy enum (`new | learning | review | relearning`) zamiast nagiej liczby
  0..3 (port nie zna numerów biblioteki).
- **`ReviewRating`** — już istnieje (`types.ts:23`); ACL mapuje go na `Rating` biblioteki wewnątrz.
- **`Scheduler`** — port (interfejs) z dwiema operacjami domenowymi.

```ts
// src/lib/domain/scheduler.ts  — PORT (zero importów z ts-fsrs)
export type CardState = "new" | "learning" | "review" | "relearning";
export interface ReviewSchedule {
  /* opaque; konstruowany i czytany TYLKO przez adapter */
}
export type IntervalPreview = Record<ReviewRating, string>; // gotowe etykiety, nie obiekty Card

export interface Scheduler {
  /** Świeży harmonogram dla nowej fiszki (zastępuje createEmptyCard()). */
  fresh(now: Date): ReviewSchedule;
  /** Cztery podglądy interwałów dla ocen again/hard/good/easy. */
  previews(s: ReviewSchedule, now: Date): IntervalPreview;
  /** Zastosuj ocenę → nowy harmonogram (zastępuje scheduler.next). */
  apply(s: ReviewSchedule, rating: ReviewRating, now: Date): ReviewSchedule;
  /** Persystencja ⇄ domena: jedyne miejsce znające kształt kolumn FSRS. */
  fromColumns(row: Record<string, unknown>): ReviewSchedule;
  toColumns(s: ReviewSchedule): Record<string, unknown>;
}
```

### 4.2 Adapter — jedyny posiadacz `ts-fsrs`

```ts
// src/lib/domain/review-schedule.ts  — ADAPTER (JEDYNY import "ts-fsrs" w całym repo)
import { fsrs, Rating, show_diff_message, createEmptyCard, type Card, type Grade } from "ts-fsrs";
import type { Scheduler, ReviewSchedule, CardState } from "./scheduler";
import type { ReviewRating } from "@/types";

const engine = fsrs();
const TIME_UNITS = ["s", "min", "h", "d", "mo", "y"];

const RATING_MAP: Record<ReviewRating, Grade> = {
  // ← przeniesione z srs.ts:18-23
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};
const STATE_TO_DOMAIN: CardState[] = ["new", "learning", "review", "relearning"]; // 0..3 → enum domenowy

// ReviewSchedule = cienki wrapper na Card; pole `card` NIE wycieka poza ten plik.
type Impl = { card: Card };

export const scheduler: Scheduler = {
  fresh: (now) => ({ card: createEmptyCard(now) }) as ReviewSchedule,
  apply: (s, rating, now) => ({ card: engine.next((s as Impl).card, now, RATING_MAP[rating]).card }) as ReviewSchedule,
  previews: (s, now) => {
    const p = engine.repeat((s as Impl).card, now);
    return {
      again: show_diff_message(p[Rating.Again].card.due, now, true, TIME_UNITS),
      hard: show_diff_message(p[Rating.Hard].card.due, now, true, TIME_UNITS),
      good: show_diff_message(p[Rating.Good].card.due, now, true, TIME_UNITS),
      easy: show_diff_message(p[Rating.Easy].card.due, now, true, TIME_UNITS),
    };
  },
  // KROK 3.4 rozstrzygnięte TUTAJ: decyzja o `elapsed_days` (deprecated → v6) żyje w adapterze.
  fromColumns: (row) =>
    ({
      card: {
        /* ISO→Date, mapowanie kolumn — dawne srs.ts:30-43 */
      },
    }) as ReviewSchedule,
  toColumns: (s) => ({
    /* Date→ISO, mapowanie Card→kolumny — dawne srs.ts:46-60 */
  }),
};
```

`Card`, `Rating`, `Grade`, `State`, `fsrs`, `createEmptyCard`, `show_diff_message` — **wszystkie
żyją tylko w tym pliku**. Serwis `srs.ts` (jeśli zostaje) woła **port**, nie bibliotekę.

### 4.3 Serwis SRS odchudzony do portu

`getDueCards` / `reviewCard` przestają importować `ts-fsrs`; wołają `scheduler.*`:

```ts
// src/lib/services/srs.ts  (po refaktorze — zero "ts-fsrs")
import { scheduler } from "@/lib/domain/review-schedule";
// reviewCard: const next = scheduler.apply(schedule, rating, now);  zamiast engine.next(...)
// getDueCards: preview = scheduler.previews(schedule, now);          zamiast scheduler.repeat(...)
```

### 4.4 Typy współdzielone i wire DTO — rozdzielenie domeny od harmonogramu

`Flashcard` przestaje osadzać 10 pól FSRS. Stan harmonogramu staje się **opaque** (persystowany,
nieeksponowany w kontrakcie wire). Klient dostaje **gotowe dane domenowe**, nie surowy `Card`:

```ts
// src/types.ts  (po refaktorze)
export interface Flashcard {
  // ← rdzeń: bez pól biblioteki SRS
  id;
  user_id;
  word;
  translation;
  context;
  deleted_at;
  created_at;
}
// Wire DTO dla nauki — TYLKO to, czego klient używa:
export interface DueCardView {
  id: string;
  word: string;
  translation: string;
  context: string | null;
  preview: Record<ReviewRating, string>; // gotowe etykiety z portu, zero pól Card
}
```

### 4.5 Persystencja — kolumny zostają, ale wiedza o nich należy do adaptera

Migracja danych nie jest celem tego planu (ryzyko), więc nazwy kolumn FSRS w tabeli mogą zostać —
ale **mapowanie kolumna↔harmonogram zna wyłącznie `fromColumns/toColumns`** w adapterze.
Numeryczny `state` (`…srs_state.sql:15`) jest tłumaczony na `CardState` w adapterze, więc reszta
kodu nie zna konwencji „0=New". (Opcjonalna faza-V2: rename kolumn na neutralne `srs_*` lub kolumna
`jsonb srs_state`, by nawet schemat nie zdradzał nazw pól biblioteki — poza zakresem tego planu.)

### 4.6 Rozstrzygnięcie otwartego pytania (KROK 3.4)

`elapsed_days` (deprecated, znika w v6 — `srs.ts:51`): **decyzję „persystuj dla round-tripu vs.
porzuć przy v6" koduje adapter** (`review-schedule.ts`, `toColumns/fromColumns`) — nie komentarz
w migracji, nie `types.ts`. Gdy przyjdzie v6: zmiana dotyka **jednego pliku** (adapter), bo to on
jest jedynym, który wie, że to pole biblioteki w ogóle istnieje.

---

## KROK 5 — Dowód izolacji + before/after

### 5.1 Dowód izolacji (kryterium grep)

**Kryterium sukcesu:** `grep -rn "ts-fsrs" src` zwraca **wyłącznie** `src/lib/domain/review-schedule.ts`.

| Plik                                               | Dziś zna `ts-fsrs` (kształt/symbol)?                                                   | Po refaktorze                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/lib/domain/review-schedule.ts` (NOWY adapter) | —                                                                                      | **TAK — jedyny** (symbol + kształt)                               |
| `src/lib/domain/scheduler.ts` (NOWY port)          | —                                                                                      | NIE (zero importów biblioteki)                                    |
| `src/lib/services/srs.ts`                          | TAK — `import` (`:1`), `rowToCard`/`cardToColumns` (`:29-60`), `RATING_MAP` (`:17-23`) | **NIE** — woła port                                               |
| `src/types.ts`                                     | TAK — 10 pól `Card` (`:9-19`), `ReviewRating` „maps to Rating" (`:22`)                 | **NIE** — `Flashcard` bez pól FSRS; `DueCardView` zwężony         |
| `…flashcard_srs_state.sql`                         | TAK — kolumny 1:1 (`:2,7-16`), enum `State` jako CHECK (`:15`)                         | kolumny zostają, ale **tylko adapter wie, że to pola biblioteki** |
| `src/pages/api/flashcards/due.ts`                  | TAK pośrednio — zwraca `DueCard` (10 pól) (`:22-23`)                                   | NIE — zwraca `DueCardView` (5 pól)                                |
| `src/pages/api/flashcards/[id]/review.ts`          | TAK pośrednio — zwraca pełny `Flashcard` (`:45-46`)                                    | NIE — zwraca widok bez pól FSRS                                   |
| `src/pages/api/flashcards/index.ts`                | TAK pośrednio — `select("*")` + zwrot `Flashcard` (`:22,28,73,79`)                     | NIE — projekcja kolumn domenowych                                 |
| `src/components/review/ReviewSession.tsx`          | TAK pośrednio — `DueCard[]` w stanie (`:4,17,29`)                                      | NIE — `DueCardView[]` (tylko pola używane)                        |

### 5.2 Before / After (każde dzisiejsze miejsce wiedzy)

| Miejsce                  | BEFORE                                                                             | AFTER                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| import biblioteki        | `srs.ts:1` importuje `fsrs, Rating, show_diff_message, Card, Grade`                | jedyny import w `review-schedule.ts`; `srs.ts` importuje **port** |
| mapowanie DB⇄Card        | `rowToCard`/`cardToColumns` w serwisie (`srs.ts:29-60`)                            | `fromColumns`/`toColumns` w adapterze; serwis nie wie o `Card`    |
| operacja „następny stan" | `scheduler.next(...)` w serwisie (`srs.ts:127`)                                    | `scheduler.apply(schedule, rating, now)` (port)                   |
| podglądy interwałów      | `scheduler.repeat(...)` + `Rating.*` w serwisie (`srs.ts:88-96`)                   | `scheduler.previews(schedule, now)` (port)                        |
| typ współdzielony        | `Flashcard` osadza 10 pól FSRS (`types.ts:9-19`)                                   | `Flashcard` bez pól FSRS; harmonogram opaque                      |
| wire DTO nauki           | `DueCard extends Flashcard` — 10 pól na wire (`types.ts:25-28`, `due.ts:22-23`)    | `DueCardView` — `id/word/translation/context/preview`             |
| klient                   | `useState<DueCard[]>`, payload z 9 nieużywanymi polami (`ReviewSession.tsx:17,29`) | `useState<DueCardView[]>` — dostaje **gotowe dane domenowe**      |
| enum stanu               | naga liczba `state:number` + `CHECK 0..3` (`types.ts:18`, `…srs_state.sql:15`)     | `CardState` domenowy; mapowanie 0..3 zamknięte w adapterze        |
| decyzja `elapsed_days`   | rozsmarowana po komentarzach (`srs.ts:51`, `…srs_state.sql:2`, `types.ts:13`)      | jedna decyzja w `toColumns/fromColumns` adaptera (KROK 4.6)       |

**Dowód „UI dostaje dane domenowe, nie surowy obiekt biblioteki":** dziś `ReviewSession` deserializuje
`DueCard` z 10 polami `Card` i czyta 5 (`ReviewSession.tsx:50,88,92-93,120`); po refaktorze odbiera
`DueCardView` zawierający dokładnie te 5 pól — model harmonogramu `ts-fsrs` nigdy nie opuszcza serwera.

---

## KROK 6 — Weryfikacja i plan faz

### 6.1 Plan faz (test-first tam, gdzie możliwe — runner vitest istnieje)

Projekt ma vitest (`package.json:15`, katalogi `test/{authz,generation,persistence,rls,output-safety}/`),
więc fazy z logiką idą **test-first** (RED → GREEN → REFACTOR), zgodnie z konwencją z dokumentu 02.

- **Faza 1 — Port + adapter (test-first: `test/domain/review-schedule.test.ts`).**
  RED: testy charakteryzujące, że `apply(fresh, "good", t)` daje ten sam wynik co dzisiejsze
  `scheduler.next(createEmptyCard, t, Rating.Good)`; że `previews` zwraca 4 etykiety; round-trip
  `toColumns(fromColumns(row)) ≈ row`. GREEN: `scheduler.ts` (port) + `review-schedule.ts` (adapter),
  przeniesienie `rowToCard/cardToColumns/RATING_MAP/TIME_UNITS` z `srs.ts`.
- **Faza 2 — Serwis na porcie (test-first: `test/persistence/` / istniejące testy SRS).**
  RED: testy `reviewCard/getDueCards` bez zmiany zachowania. GREEN: `srs.ts` woła `scheduler.*`;
  usuń `import "ts-fsrs"` z serwisu.
- **Faza 3 — Typy + wire DTO + trasy (test-first: `test/generation/`, `test/authz/`).**
  RED: testy, że `/api/flashcards/due` zwraca tylko `id/word/translation/context/preview` (brak
  `stability` etc.); że `Flashcard` nie ma pól FSRS. GREEN: `DueCardView`, projekcje w trasach
  (`due.ts`, `[id]/review.ts`, `index.ts`).
- **Faza 4 — Klient (E2E: `tests/e2e/`, przez `/10x-e2e`).** `ReviewSession` na `DueCardView`;
  flow nauki bez regresji (reveal → ocena → następna; etykiety interwałów).
- **Faza 5 — Rekonsyliacja (nie-test).** Aktualizacja `01-domain-distillation.md` (przeciek `Card`
  zamknięty), rejestr nazw (6.3), wpis w `lessons.md`: „model wewnętrzny biblioteki nie jest
  kontraktem wire ani typem domenowym — chowaj go za portem/ACL".

### 6.2 Kryterium akceptacji (mierzalne)

1. `grep -rn "ts-fsrs" src` → **wyłącznie** `src/lib/domain/review-schedule.ts`.
2. `grep -rn "Card\|Rating\|Grade\|createEmptyCard\|show_diff_message\|fsrs(" src` → tylko adapter.
3. Odpowiedź `/api/flashcards/due` nie zawiera kluczy `stability/difficulty/elapsed_days/…/state`.
4. `Flashcard` w `types.ts` nie ma pól FSRS; wymiana biblioteki nie dotyka migracji, tras ani klienta.

### 6.3 Nowe nazwy „load-bearing" do rejestru kontraktów

> `docs/reference/contract-surfaces.md` jeszcze nie istnieje (jak odnotowano w dokumencie 02 §5.4) —
> utworzyć przy Fazie 5 i zarejestrować:

- **Port** `Scheduler` + value object `ReviewSchedule` + enum `CardState` (`src/lib/domain/scheduler.ts`)
  — domenowy kontrakt harmonogramu; **brak typów biblioteki**.
- **Adapter** `src/lib/domain/review-schedule.ts` — **jedyny** posiadacz `ts-fsrs`; tu żyje decyzja
  o `elapsed_days` (deprecated → v6).
- **Wire DTO** `DueCardView` (`id/word/translation/context/preview`) — zwężony kontrakt nauki;
  **nie poszerzać o pola harmonogramu**.
- **Zwężony** `Flashcard` (bez 10 pól FSRS) — rdzeń kolekcji nie zna biblioteki SRS.

### 6.4 Ryzyka i zakres

- **Nie ruszamy nazw kolumn DB** w tym planie (migracja danych = ryzyko); izolację daje już adapter.
  Rename kolumn / `jsonb srs_state` to opcjonalna faza-V2 poza zakresem.
- **Zachowanie bez zmian** — to refaktor strukturalny; testy charakteryzujące (Faza 1–2) pilnują,
  że harmonogram FSRS liczy identycznie jak dziś.

---

## Podsumowanie

Spośród zależności zewnętrznych 10xCards (`ts-fsrs`, `@supabase/*`, `zod`) jako przeciek #1 wybrano
**`ts-fsrs`**, bo jego model danych — 10-polowy `Card` i numeryczny enum `State` — przeciekł przez
trzy warstwy naraz: persystencję (migracja przyznaje „columns map 1:1 to the ts-fsrs Card interface",
`…srs_state.sql:2`), typ współdzielony (`Flashcard` osadza 10 pól, `types.ts:9-19`) i kontrakt wire
(`DueCard` niesie te pola do przeglądarki, którą czyta z nich tylko pięć — `ReviewSession.tsx:17,50`).
To czyni z wewnętrznego modelu biblioteki _de-facto schemat_ aplikacji, mimo że serwis sam deklaruje
izolację („the single home for ts-fsrs usage… routes and the client never import ts-fsrs", `srs.ts:6-8`)
— deklaracja prawdziwa dla _importu_, fałszywa dla _kształtu_. Rozjazd jest podwójnie udokumentowany:
roadmapa traktuje bibliotekę jako wymienialną integrację wspierającą („ts-fsrs / inna", `roadmap.md:148`;
„integrujemy", `01:86`), a kod ją betonuje — wymiana dziś dotyka DB, typów, czterech tras i klienta,
i już blokuje upgrade do v6 (`elapsed_days` deprecated, `srs.ts:51`). W odpowiedzi zaprojektowano ACL:
port `Scheduler` + value object `ReviewSchedule` + domenowy `CardState`, a jedynym posiadaczem `ts-fsrs`
zostaje adapter `src/lib/domain/review-schedule.ts`; typy i wire zwężają się do pól domenowych
(`DueCardView`), więc UI dostaje gotowe dane, nie surowy `Card`. Izolację potwierdza kryterium grep
(nazwa pakietu trafia wyłącznie w adapter), a plan idzie test-first w pięciu fazach z testami
charakteryzującymi, które gwarantują niezmienione zachowanie harmonogramu.
