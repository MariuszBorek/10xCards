---
title: "10xCards — Niezmiennik rdzeniowy i agregat-strażnik (plan refaktoru)"
created: 2026-06-12
type: refactor-plan
---

# 10xCards — Niezmiennik rdzeniowy i agregat-strażnik

> **Produkt tego dokumentu to PLAN refaktoru, nie kod.** Każde twierdzenie o stanie
> bieżącym jest zakotwiczone cytatem `plik:linia` zweryfikowanym w repozytorium.
> Sekwel `01-domain-distillation.md`: tamten dokument ZMAPOWAŁ domenę i wskazał
> rozjazdy MODEL↔KOD; ten WYBIERA jeden niezmiennik (przez soczewkę „rdzeniowy ×
> najsłabiej egzekwowany") i projektuje agregat, który staje się jedynym jego strażnikiem.

## KROK 0 — Kontekst (skrót, pełnia w `01`)

Stack: **Astro 6 SSR + React 19 islands + Supabase (Postgres + Auth + RLS)**, deploy
Cloudflare Workers. Logika biznesowa żyje rozproszona w trzech warstwach — ograniczenia
SQL (`supabase/migrations/*`), schematy zod w trasach (`src/pages/api/flashcards/*`)
i serwisy proceduralne (`src/lib/services/*`). **Nie ma warstwy domenowej DDD** — „Fiszka"
to anemiczny rekord `interface Flashcard` (`src/types.ts:1-20`) bez metod egzekwujących reguły.
Infrastruktura testowa **istnieje**: vitest (`vitest.config.ts`, katalogi `test/{authz,generation,
persistence,rls,output-safety}/`) i Playwright (`playwright.config.ts`, `tests/e2e/*`). To zmienia
KROK 5 — refaktor może iść **test-first**.

---

## KROK 1 — IDENTYFIKACJA niezmienników biznesowych

Reguły, które w tej domenie MUSZĄ być zawsze prawdziwe. Wyciągnięte z dokumentów ORAZ z kodu.

| #      | Niezmiennik                                                                                                                                                                                                                                                 | Źródło (dokument)                                                                                                                                                                       | Gdzie żyje / jest egzekwowany w kodzie                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1** | **Każda fiszka ma trwałą proweniencję: powstała przez AI albo ręcznie — i ta proweniencja jest ustalana przy tworzeniu i nigdy się nie zmienia** (edycja zaakceptowanego kandydata NIE zmienia go w „ręczny" — akceptacja z edycją wciąż liczy się jako AI) | `prd.md:40` ("≥75% fiszek wygenerowanych przez AI zaakceptowanych"); `prd.md:41` ("≥75% kolekcji powstaje przez AI"); `prd.md:67` ("Accepting with or without edit adds the candidate") | **NIGDZIE.** Brak kolumny `source` (`…flashcard_schema.sql:2-10`); ten sam INSERT bez proweniencji dla obu ścieżek (`flashcards/index.ts:69-73`)                                                        |
| **N2** | **Każdy zaprezentowany kandydat AI kończy dokładnie jedną zarejestrowaną decyzją** (akcept → fiszka; odrzut → policzony), tak by „% zaakceptowanych" było policzalne                                                                                        | `prd.md:40`; `prd.md:67` (accept/reject/edit); Business Logic `prd.md:135-136`                                                                                                          | **NIGDZIE serwerowo.** Odrzut żyje wyłącznie w stanie React (`GenerateView.tsx:87-89`); serwer NIGDY się o nim nie dowiaduje. Liczba „zaprezentowanych" nieutrwalona                                    |
| **N3** | **Tekst wklejony do generacji jest transient — nie pozostaje w storage po przetworzeniu**                                                                                                                                                                   | `prd.md:50`; `prd.md:126` (NFR)                                                                                                                                                         | **EGZEKWUJE strukturalnie** — `generate.ts` przyjmuje `input` jako parametr i nigdy go nie persystuje (`generate.ts:25,38`)                                                                             |
| **N4** | **Fiszka należy do dokładnie jednego użytkownika; nikt nie widzi cudzych**                                                                                                                                                                                  | `prd.md:49`; `prd.md:140`                                                                                                                                                               | **EGZEKWUJE** — `user_id NOT NULL` + 4 polityki RLS (`…flashcard_schema.sql:4,13-27`)                                                                                                                   |
| **N5** | **`word` i `translation` zawsze niepuste**                                                                                                                                                                                                                  | `prd.md:104` (FR-007)                                                                                                                                                                   | **EGZEKWUJE podwójnie** — DB `NOT NULL` (`…flashcard_schema.sql:5-6`) + zod `min(1)` (`flashcards/index.ts:35-36`, `[id].ts:9-10`)                                                                      |
| **N6** | **Brak utraty fiszek — zaakceptowana fiszka znika tylko przez intencjonalne usunięcie**                                                                                                                                                                     | `prd.md:51` (Guardrail)                                                                                                                                                                 | **NIESPÓJNIE** — kolumna `deleted_at` istnieje (`…flashcard_schema.sql:8`), ale DELETE robi HARD delete (`[id].ts:84`), lista jej nie filtruje (`index.ts:22`), a tylko SRS jej broni (`srs.ts:78,120`) |
| **N7** | **`reps` rośnie monotonicznie; brak lost-update przy współbieżnej ocenie SRS**                                                                                                                                                                              | `srs.ts:129-132` + `lessons.md`                                                                                                                                                         | **EGZEKWUJE** — optymistyczna blokada `.eq("reps", row.reps)` → konflikt 409 (`srs.ts:138,143`)                                                                                                         |
| **N8** | **Do powtórki trafiają tylko karty `due <= now`, najstarsze pierwsze**                                                                                                                                                                                      | migracja `…srs_state.sql:18`; `srs.ts:79-80`                                                                                                                                            | **EGZEKWUJE** — `lte("due", now)…order("due")` (`srs.ts:79-80`)                                                                                                                                         |
| **N9** | **`state` ∈ {0,1,2,3}**                                                                                                                                                                                                                                     | migracja `…srs_state.sql:15`                                                                                                                                                            | **EGZEKWUJE** — `CHECK (state BETWEEN 0 AND 3)`                                                                                                                                                         |

---

## KROK 2 — KLASYFIKACJA i wybór #1

Każdy niezmiennik na trzech osiach: **(a) rdzeniowość** (jak bardzo dotyka sensu produktu),
**(b) rozsmarowanie** (po ilu warstwach żyje), **(c) egzekucja** (realnie egzekwowany /
tylko deklarowany / naruszalny). Odwołanie do wizji: _„Wartość 10xCards leży w połączeniu…
generowania fiszek z dowolnego tekstu"_ (`prd.md:24`); north star roadmapy: _„jakość generacji
AI: jeśli kandydaci są złej jakości, cały produkt traci rację bytu"_ (`roadmap.md:20,24`).

| #                          | (a) Rdzeniowość                                                     | (b) Rozsmarowanie                            | (c) Egzekucja                                       | Werdykt                                     |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| **N1 proweniencja**        | **MAKSYMALNA** — to dosłowna definicja obu Primary Success Criteria | DB + route + UI (3 warstwy, 0 z nich go zna) | **ZERO** — kolumny brak                             | **rdzeniowy × niemal nieegzekwowany**       |
| **N2 księgowanie decyzji** | **MAKSYMALNA** — bez tego „% zaakceptowanych" jest niepoliczalny    | UI (jedyny strażnik) + brak na serwerze      | **ZERO serwerowo; klient jest jedynym strażnikiem** | **rdzeniowy × egzekucja TYLKO na kliencie** |
| N3 transient               | Średnia (guardrail)                                                 | Strukturalny                                 | Solidna                                             | dobrze chroniony                            |
| N4 izolacja                | Wysoka (guardrail)                                                  | RLS + miejscami filtr                        | Solidna (RLS); niespójny defense-in-depth           | dobrze chroniony                            |
| N5 niepuste pola           | Niska (higiena)                                                     | DB + zod                                     | Solidna podwójna                                    | dobrze chroniony                            |
| N6 brak utraty             | Średnia                                                             | DB + 3 trasy                                 | **Niespójna** (kolumna-pułapka)                     | kandydat #2, ale subdomena wspierająca      |
| N7/N8/N9 SRS               | Średnia (zewn. algorytm)                                            | serwis SRS                                   | Solidna                                             | dobrze chroniony                            |

### Wybór: **N1 + N2 łącznie — „Niezmiennik proweniencji i kompletnego księgowania decyzji"**

N1 i N2 to **dwie strony jednej reguły rdzeniowej** i muszą być egzekwowane razem: proweniencja
(`source: ai|manual`) daje **mianownik/licznik AI-share**, a księgowanie decyzji daje **mianownik
acceptance-rate**. Wybieram je jako jeden niezmiennik, bo:

- **Najbardziej rdzeniowy:** 10xCards istnieje, by AI zastąpiło ręczne przepisywanie fiszek.
  Obie miary, czy to się udaje (`≥75% kandydatów zaakceptowanych`, `≥75% kolekcji z AI`,
  `prd.md:40-41`), zależą wyłącznie od tego niezmiennika. Bez niego **hipoteza produktu jest
  niefalsyfikowalna** — produkt nie potrafi odpowiedzieć na pytanie, dla którego powstał.
- **Najsłabiej egzekwowany — i to w najgorszy możliwy sposób:** nie „brakuje walidacji", ale
  **jedyne dziś istniejące egzekwowanie żyje na KLIENCIE** (`GenerateView.tsx`). To dokładnie
  wzorzec, którego agregat-strażnik ma się pozbyć: decyzja domenowa podejmowana w przeglądarce,
  niewidoczna dla serwera, niepoliczalna.

N6 (brak utraty) to mocny kandydat #2, ale subdomena **wspierająca** (kolekcja), nie rdzeń —
zostaje poza zakresem tego planu (osobny refaktor).

---

## KROK 3 — DIAGNOZA wybranego niezmiennika (gdzie dziś żyje reguła)

### 3.1 Ścieżka akceptacji — proweniencja gubiona przy zapisie

Kandydat AND ręczna fiszka zapisują **bit-w-bit identyczny wiersz** tym samym endpointem:

```
src/pages/api/flashcards/index.ts:34-38   bodySchema = { word, translation, context }   ← BRAK source
src/pages/api/flashcards/index.ts:69-73   .insert({ user_id, word, translation, context })  ← BRAK source
supabase/migrations/20260527000000_flashcard_schema.sql:2-10                              ← BRAK kolumny source
src/types.ts:1-20  interface Flashcard                                                    ← BRAK pola source
```

Po INSERT informacja „to był kandydat AI" jest **bezpowrotnie utracona**. Metryka AI-share
(`prd.md:41`) jest niepoliczalna.

### 3.2 Klient jest JEDYNYM strażnikiem decyzji accept/reject

```
src/components/generate/GenerateView.tsx:67-85   handleAccept → POST /api/flashcards (zapisuje fiszkę)
src/components/generate/GenerateView.tsx:87-89   handleReject → setCandidates(... status:"rejected")   ← TYLKO stan React
src/components/generate/GenerateView.tsx:91       visibleCandidates = filter(status !== "rejected")     ← znika z DOM
```

**Odrzut nigdy nie opuszcza przeglądarki.** Serwer nie zna ani liczby zaprezentowanych
kandydatów, ani liczby odrzuconych — `generate.ts` zwraca listę i o niej zapomina:

```
src/pages/api/flashcards/generate.ts:50-52   const candidates = await generate...(input); return {candidates}  ← nic nie utrwala
src/lib/services/generate.ts:25              generateFlashcardCandidates(input): Promise<Candidate[]>          ← czysta funkcja, bez batcha
```

Metryka acceptance-rate (`prd.md:40`) nie ma ani licznika, ani mianownika.

### 3.3 Akcept-z-edycją — reguła „edycja ≠ ręczne" nieobecna

PRD jest jednoznaczny: _„Accepting (with or without edit) adds the candidate"_ (`prd.md:67`) —
zaakceptowany kandydat po edycji **wciąż jest fiszką AI**. W kodzie ta reguła nie istnieje, bo
nie ma czego oznaczać: `onSave` i `onAccept` wołają tę samą `handleAccept` (`GenerateView.tsx:159,163`),
która POST-uje bez proweniencji. Gdy kolumna `source` powstanie naiwnie, łatwo o regresję
„edytowany kandydat = manual" — agregat musi tę regułę zakodować wprost.

### 3.4 Brak preconditions i „połykanie" zamiast zatrzymania

`handleAccept` przy błędzie zapisu **po cichu cofa spinner i nic nie mówi** (`GenerateView.tsx:82-84`:
`catch → saving:false`). Nie ma żadnej reguły domenowej, którą można by naruszyć fail-fast — bo
nie ma agregatu. Akceptacja to „goły INSERT", więc nie ma miejsca, w którym nielegalna operacja
(np. akcept kandydata z już zamkniętego batcha) mogłaby się zatrzymać nazwanym błędem.

**Podsumowanie diagnozy:** niezmiennik rdzeniowy produktu jest egzekwowany w **0 warstwach
serwerowych**; jego jedyny ślad to ulotny stan React. To czyni go #1 — najwyższa wartość spotyka
zerową (a właściwie ujemną: client-side) egzekucję.

---

## KROK 4 — PROJEKT agregatu-strażnika

### 4.1 Agregat-root: `GenerationBatch`

Operacja domenowa, dziś rozsmarowana po kliencie i gołym INSERT, to: **„zrecenzuj partię
kandydatów AI; część zaakceptuj (→ fiszki `source='ai'`), resztę odrzuć — i to wszystko ma
być policzalne".** Jej naturalny agregat-root to **partia generacji**, a `Flashcard` jest bytem
tworzonym wyłącznie przez jej fabryki.

**Niezmienniki, których `GenerationBatch` jest JEDYNYM strażnikiem:**

1. `candidates_presented` jest ustalane przy otwarciu batcha i **niezmienne** (mianownik acceptance-rate).
2. `candidates_accepted` **nigdy nie przekracza** `candidates_presented` (`accepted ≤ presented`).
3. Każda fiszka utworzona przez `acceptCandidate` ma `source='ai'` i `generation_batch_id = batch.id`.
4. Fiszka utworzona przez `createManual` ma `source='manual'` i `generation_batch_id = NULL`.
5. `source` jest **immutable** — żadna metoda ani trasa nigdy go nie aktualizuje.

### 4.2 Model danych (migracja — minimalna, zgodna z transient N3)

```sql
-- NOWA tabela: jeden wiersz na wywołanie /generate. Daje mianownik acceptance-rate.
CREATE TABLE generation_batches (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidates_presented INTEGER     NOT NULL CHECK (candidates_presented >= 0),
  candidates_accepted  INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accepted_le_presented CHECK (candidates_accepted <= candidates_presented)  -- N2 na poziomie DB
);
ALTER TABLE generation_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own" ON generation_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON generation_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON generation_batches FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Proweniencja na fiszce (N1). Backfill istniejących wierszy → 'manual' (były tworzone przed regułą).
ALTER TABLE flashcards
  ADD COLUMN source              TEXT NOT NULL DEFAULT 'manual'
                                 CHECK (source IN ('ai','manual')),
  ADD COLUMN generation_batch_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL;
ALTER TABLE flashcards ALTER COLUMN source DROP DEFAULT;  -- po backfillu: source musi być jawnie podany

-- N1 immutable: blokuje JAKĄKOLWIEK zmianę source po utworzeniu (defense-in-depth poza warstwą domeny).
CREATE OR REPLACE FUNCTION enforce_source_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'flashcard.source is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_source_immutable BEFORE UPDATE ON flashcards
  FOR EACH ROW EXECUTE FUNCTION enforce_source_immutable();
```

> **Świadoma decyzja (transient N3):** NIE przechowujemy treści kandydatów ani per-kandydat
> rekordów decyzji — tylko liczniki na batchu. Dzięki temu odrzuty nie zostawiają tekstu w
> storage (spójność z guardrail `prd.md:50`), a acceptance-rate = `Σ candidates_accepted /
Σ candidates_presented` jest w pełni policzalny. `candidates_accepted` jest **event-counterem**
> (rośnie w chwili akceptacji), więc późniejsze usunięcie fiszki nie zafałszuje miary.

### 4.3 Atomowość — akceptacja w JEDNEJ transakcji (Postgres RPC)

`supabase-js` nie daje wielostatementowych transakcji po stronie klienta, więc atomowy
„INSERT fiszki + INCREMENT licznika + precondition" idzie do funkcji Postgres (`SECURITY INVOKER`,
żeby RLS dalej obowiązywało):

```sql
CREATE OR REPLACE FUNCTION accept_candidate(
  p_batch_id UUID, p_word TEXT, p_translation TEXT, p_context TEXT
) RETURNS flashcards AS $$
DECLARE v_batch generation_batches; v_card flashcards;
BEGIN
  SELECT * INTO v_batch FROM generation_batches WHERE id = p_batch_id FOR UPDATE;  -- blokada wiersza
  IF NOT FOUND THEN RAISE EXCEPTION 'BatchNotFound';            END IF;            -- precondition
  IF v_batch.candidates_accepted >= v_batch.candidates_presented
     THEN RAISE EXCEPTION 'BatchFullyDecided';                  END IF;            -- N2 fail-fast

  INSERT INTO flashcards (user_id, word, translation, context, source, generation_batch_id)
    VALUES (v_batch.user_id, p_word, p_translation, p_context, 'ai', p_batch_id)   -- N1: source='ai'
    RETURNING * INTO v_card;
  UPDATE generation_batches SET candidates_accepted = candidates_accepted + 1
    WHERE id = p_batch_id;                                                          -- licznik, atomowo
  RETURN v_card;
END; $$ LANGUAGE plpgsql SECURITY INVOKER;
```

### 4.4 Agregat w TypeScript — `src/lib/domain/generation-batch.ts`

Cienka warstwa domeny ponad RPC; **jedyne** miejsce, gdzie reguła jest egzekwowana w aplikacji.
Nielegalna operacja rzuca **nazwany błąd domenowy**, nie loguje-i-jedzie dalej.

```ts
// src/lib/domain/errors.ts
export class DomainError extends Error {}
export class BatchNotFoundError extends DomainError {} // precondition: batch istnieje i należy do usera
export class BatchFullyDecidedError extends DomainError {} // N2: accepted < presented

// src/lib/domain/generation-batch.ts
export async function openBatch(sb, userId, candidates: FlashcardCandidate[]): Promise<{ batchId: string }> {
  const { data, error } = await sb
    .from("generation_batches")
    .insert({ user_id: userId, candidates_presented: candidates.length })
    .select("id")
    .single();
  if (error) throw new DomainError("Failed to open batch");
  return { batchId: data.id };
}

export async function acceptCandidate(sb, batchId, content: FlashcardCandidate): Promise<Flashcard> {
  const { data, error } = await sb.rpc("accept_candidate", {
    p_batch_id: batchId,
    p_word: content.word,
    p_translation: content.translation,
    p_context: content.context ?? null,
  });
  if (error?.message?.includes("BatchNotFound")) throw new BatchNotFoundError();
  if (error?.message?.includes("BatchFullyDecided")) throw new BatchFullyDecidedError();
  if (error) throw new DomainError("Failed to accept candidate");
  return data as Flashcard;
}

// Fabryka fiszki ręcznej — JEDYNA ścieżka source='manual'.
export async function createManual(sb, userId, c: FlashcardCandidate): Promise<Flashcard> {
  const { data, error } = await sb
    .from("flashcards")
    .insert({ user_id: userId, word: c.word, translation: c.translation, context: c.context ?? null, source: "manual" }) // N1
    .select()
    .single<Flashcard>();
  if (error) throw new DomainError("Failed to save flashcard");
  return data;
}
```

### 4.5 Cienkie trasy — parse → metoda agregatu → mapowanie błędu

Egzekucja przenosi się **z klienta na serwer**. Trasy nie zawierają reguł — tylko walidują
wejście, wołają metodę agregatu i mapują błąd domenowy na status HTTP.

```ts
// POST /api/flashcards            (index.ts) — TYLKO ręczne tworzenie → createManual (source='manual')
// POST /api/flashcards/accept     (NOWA)     — { batchId, word, translation, context } → acceptCandidate
//        BatchNotFoundError    → 404
//        BatchFullyDecidedError → 409   (fail-fast: zatrzymuje, nie „połyka")
// POST /api/flashcards/generate   — po wygenerowaniu: openBatch(...) → zwraca { batchId, candidates }
```

Klient (`GenerateView`) przestaje być strażnikiem: `handleAccept` woła `/api/flashcards/accept`
z `batchId`; `handleReject` może pozostać czysto kliencki (mianownik znamy z `candidates_presented`,
więc odrzut = `presented − accepted − pending` jest wyliczalny bez round-tripu).

---

## KROK 5 — Before/After, plan faz, testy, nazwy load-bearing

### 5.1 Before / After (każde dzisiejsze miejsce reguły)

| Miejsce                           | BEFORE                                             | AFTER                                                                                                         |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `…flashcard_schema.sql`           | brak `source`, brak batcha (`:2-10`)               | `source` (CHECK ai\|manual, immutable trigger) + `generation_batch_id`; nowa tabela `generation_batches`      |
| `flashcards/index.ts` POST        | jeden INSERT bez proweniencji, oba flow (`:69-73`) | tylko ręczne → `createManual` (`source='manual'`)                                                             |
| `flashcards/generate.ts`          | zwraca `{candidates}`, nic nie utrwala (`:50-52`)  | `openBatch()` → zwraca `{batchId, candidates}`                                                                |
| **(nowa)** `flashcards/accept.ts` | — (akcept szedł przez `/api/flashcards`)           | `acceptCandidate()` via RPC, atomowo, `source='ai'`                                                           |
| `GenerateView.tsx` handleAccept   | POST `/api/flashcards` bez proweniencji (`:67-85`) | POST `/api/flashcards/accept` z `batchId`                                                                     |
| `GenerateView.tsx` handleReject   | tylko stan React, serwer ślepy (`:87-89`)          | bez zmian (mianownik z `presented`) — odrzut policzalny                                                       |
| `[id].ts` PATCH                   | update word/translation/context (`:48-53`)         | bez zmian + trigger DB gwarantuje, że `source` nigdy się nie zmieni (N1 immutable, w tym dla accept-z-edycją) |
| `src/types.ts`                    | `Flashcard` bez `source` (`:1-20`)                 | `+ source: 'ai' \| 'manual'; generation_batch_id: string \| null`                                             |

### 5.2 Plan faz (test-first tam, gdzie to możliwe)

Projekt MA runner (vitest) i dyscyplinę testową (`test/{authz,generation,persistence,rls}/`),
więc fazy z logiką idą **test-first** (RED → GREEN → REFACTOR).

- **Faza 1 — Migracja (test-first: `test/persistence/`, `test/rls/`).**
  RED: testy że (a) INSERT bez `source` jest odrzucony, (b) UPDATE `source` rzuca błąd triggera,
  (c) `candidates_accepted > candidates_presented` łamie CHECK, (d) RLS na `generation_batches`
  izoluje konta. GREEN: napisz migrację. Backfill istniejących fiszek → `'manual'`.
- **Faza 2 — Agregat + błędy domenowe (test-first: `test/domain/generation-batch.test.ts`).**
  RED: testy preconditions i fabryk (lista poniżej). GREEN: `errors.ts`, `generation-batch.ts`,
  RPC `accept_candidate`.
- **Faza 3 — Trasy (test-first: `test/generation/`, `test/authz/`).**
  RED: `accept` mapuje `BatchFullyDecidedError→409`, `BatchNotFoundError→404`; `generate` zwraca
  `batchId`; `/api/flashcards` POST ustawia `source='manual'`. GREEN: cienkie handlery.
- **Faza 4 — Klient (E2E: `tests/e2e/`, przez `/10x-e2e`).** `GenerateView` woła `accept` z `batchId`;
  flow accept/edit/reject; weryfikacja że accept-z-edycją zapisuje `source='ai'`.
- **Faza 5 — Rekonsyliacja (nie-test).** Zaktualizować `01-domain-distillation.md` (rozjazd #1
  zamknięty), zarejestrować nowe nazwy (5.4), odnotować w `lessons.md` regułę „decyzja domenowa
  nie żyje na kliencie".

### 5.3 Przypadki testowe niezmiennika (legalne i nielegalne)

| #             | Operacja                                                          | Oczekiwanie                                                                |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| T1            | `acceptCandidate` na świeżym batchu (presented=3)                 | fiszka `source='ai'`, `generation_batch_id=batch`, `candidates_accepted=1` |
| T2            | `acceptCandidate` 4× na batchu presented=3                        | 4. rzuca **`BatchFullyDecidedError`** (HTTP 409); `accepted` zostaje 3     |
| T3            | `acceptCandidate` z nieistniejącym/cudzym `batchId`               | **`BatchNotFoundError`** (HTTP 404), brak INSERT                           |
| T4            | `acceptCandidate` z edytowaną treścią                             | zapis udany, `source='ai'` (edycja ≠ manual — `prd.md:67`)                 |
| T5            | `createManual`                                                    | fiszka `source='manual'`, `generation_batch_id=NULL`                       |
| T6            | UPDATE `flashcards SET source='manual'` na wierszu AI (PATCH/SQL) | odrzucone przez trigger (N1 immutable)                                     |
| T7            | dwie równoległe akceptacje na batchu z 1 wolnym slotem            | dokładnie jedna sukces, druga `BatchFullyDecided` (gwarancja `FOR UPDATE`) |
| T8            | INSERT do `flashcards` bez `source`                               | odrzucone (`NOT NULL` po DROP DEFAULT)                                     |
| T9 (RLS)      | user B czyta/aktualizuje batch usera A                            | 0 wierszy / odmowa                                                         |
| T10 (metryka) | batch presented=4, 3× accept                                      | acceptance-rate batcha = 3/4; AI-share liczy `source='ai'`                 |

### 5.4 Nowe nazwy „load-bearing" do rejestru kontraktów

> `docs/reference/contract-surfaces.md` **nie istnieje jeszcze** (scaffold `/10x-init` go nie
> utworzył w tym repo) — utworzyć przy Fazie 5 i zarejestrować:

- **Tabela** `generation_batches` (kolumny `candidates_presented`, `candidates_accepted`) — mianownik/licznik acceptance-rate.
- **Kolumna** `flashcards.source` (`'ai' | 'manual'`, immutable) — proweniencja; **nie zmieniać semantyki bez migracji metryk**.
- **Kolumna** `flashcards.generation_batch_id` — wiązanie fiszki AI z batchem.
- **RPC** `accept_candidate(p_batch_id, p_word, p_translation, p_context)` — atomowa granica akceptacji.
- **Trigger** `trg_source_immutable` / funkcja `enforce_source_immutable` — strażnik N1 na poziomie DB.
- **Moduł domeny** `src/lib/domain/generation-batch.ts` + `errors.ts` (`DomainError`, `BatchNotFoundError`, `BatchFullyDecidedError`).
- **Trasa** `POST /api/flashcards/accept` — jedyna ścieżka `source='ai'`.

---

## Podsumowanie

Spośród dziewięciu zidentyfikowanych niezmienników 10xCards — od solidnie egzekwowanych (izolacja
RLS, niepuste pola, guard lost-update na `reps`, transient input) po naruszalne — jako #1 wybrano
**niezmiennik proweniencji i kompletnego księgowania decyzji** (`source: ai|manual` + policzalność
accept/reject), bo jest jednocześnie najbardziej rdzeniowy (to dosłowna definicja obu Primary
Success Criteria, `prd.md:40-41`) i najsłabiej egzekwowany — z 0% pokryciem serwerowym, a jego
jedyny dzisiejszy ślad to ulotny stan React (`GenerateView.tsx:87-89`), przez co odrzut kandydata
nigdy nie opuszcza przeglądarki, a zaakceptowany kandydat zapisuje wiersz bit-w-bit identyczny z
ręcznym (`flashcards/index.ts:69-73`). Diagnoza pokazała trzy luki: zgubioną proweniencję przy
zapisie, klienta jako jedynego strażnika decyzji oraz nieobecną regułę „akcept-z-edycją to wciąż
AI" (`prd.md:67`). W odpowiedzi zaprojektowano agregat-root `GenerationBatch` jako **jedyne miejsce**
egzekwowania reguły: metody z preconditions, nazwane błędy domenowe (`BatchFullyDecidedError`,
`BatchNotFoundError`) zamiast cichego „połykania", atomowa akceptacja w jednej transakcji Postgres
(RPC `accept_candidate` z `FOR UPDATE`), proweniencja niezmienna przez trigger DB, i cienkie trasy,
które przenoszą egzekucję z klienta na serwer. Plan idzie test-first (infrastruktura vitest/Playwright
już istnieje), z dziesięcioma przypadkami testowymi (legalne i nielegalne przejścia) oraz listą
siedmiu nowych nazw load-bearing do rejestru kontraktów — dzięki czemu po refaktorze produkt po raz
pierwszy potrafi policzyć, czy spełnia cel, dla którego powstał.
