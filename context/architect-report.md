---
title: "Moduł 4 (10xArchitect) — sumaryczny raport architektoniczny"
created: 2026-06-12
type: architect-summary
---

# Moduł 4 — Raport architektoniczny (ścieżka 10xArchitect)

> Two-pager oparty **wyłącznie** na artefaktach L2–L5. Twierdzenia strukturalne są zakotwiczone w źródle.
> Gdzie artefaktu brak — napisane wprost „BRAK artefaktu". Artefakty pochodzą z **dwóch** repozytoriów.

## 1. Opisane projekty

| Repo                                       | Stack                                                                                                 | Skala (orientacyjnie)                                                                                                                  | Artefakty                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Mattermost** (`IdeaProjects/mattermost`) | Monorepo 3 stacków: serwer Go, webapp TypeScript/React, e2e (Cypress + Playwright)                    | Duże; `app` 1795 dotknięć/rok, `admin_console` SCC = 1054 moduły, 382 pliki migracji postgres (`repo-map.md:50,94`; `research.md:226`) | **L2** mapa, **L3** research, **L4** plan refaktoru |
| **10xCards** (`aiCourse/10xCards`)         | Astro 6 SSR + React 19 islands + Supabase (Postgres+Auth+RLS) + Tailwind 4, deploy Cloudflare Workers | Małe MVP; brak warstwy domenowej DDD, logika rozproszona DB/zod/serwisy (`01:30-45`)                                                   | **L5** trzy notatki DDD (01/02/03)                  |

## 2. Mapa projektu — Mattermost (z L2)

1. **Hub `server/channels/app`** — piasta logiki backendu, 1795 dotknięć/rok; 66–70% zmian sąsiednich warstw przechodzi przez nią (`repo-map.md:50,65,115`).
2. **Megazwój `admin_console`** — jeden SCC = 1054 moduły (admin_console 327, post_view 65, user_settings 55, actions 33); izolacja = przepisanie pół apki (`repo-map.md:94,114`).
3. **Entry pointy / kolejność czytania** — `app/server.go` → `app/post.go`+`channel.go` → `model/config.go` → `admin_definition.tsx` → kontrakt `client4.ts↔client4.go` (`repo-map.md:143-150`).
4. **Strefa najwyższego ryzyka** — `actions/websocket_actions.ts` (fan-out 93): client+store+actions+SCC naraz → każda zmiana kończy się e2e, nie unit (`repo-map.md:113`).
5. **Największy unknown** — graf importów istnieje **tylko dla frontu**; couplingi backendu Go są `unknown`, znane wyłącznie z co-change w gicie (`repo-map.md:76,158`).

## 3. Analiza ficzera — Mattermost (z L3)

**Badany przepływ i dlaczego.** Ścieżka zapisu posta `POST /api/v4/posts` — bo przechodzi dokładnie przez najgorętsze strefy ryzyka mapy: hub `app` (🔴3), fan-out WebSocket/actions (🔴1), szew store regenerowany (`research.md:39-44`).

**Feature overview.** Input z webappu (Redux/Client4) wchodzi przez cienką fasadę REST `api4.createPost`, hub `app.CreatePost` wykonuje logikę domeny (dedup, mentions, hooki pluginów, embeds), stan zmienia się w transakcyjnym `SqlPostStore.SaveMultiple` (INSERT Posts + liczniki kanału), a zwracany jest `201 Created` z postem + asynchroniczny fan-out (WebSocket, push, search index) (`research.md:39,52-56,84-87`).

**Technical debt (3 najważniejsze, ≥1 potwierdzone ast-grepem):**

- **God-method `App.CreatePost`** — 322 linie (`app/post.go:162-483`), wysoka złożoność → trudne pokrycie gałęziowe. ✅ ast-grep verified (`research.md:299,338`).
- **Krytyczna walidacja bez testów Go** — recipients persistent-notification (`app/post.go:210-218`) i gałęzie burn-on-read w store: 0 trafień config-keys w testach (✅ ast-grep #10), regresja przejdzie CI niezauważona (`research.md:301,334`).
- **Niewidzialny blast radius backendu** — brak grafu importów Go, blast radius wyłącznie z co-change; dodatkowo coupling przez regenerację (`store.go`+`timerlayer`+`retrylayer`+mocks) zawyża metryki (`research.md:309-311`).

## 4. Plan refaktoryzacji — Mattermost (z L4)

**Co refaktoryzowane.** Dekompozycja god-method `App.CreatePost` (C1) na nazwane helpery koordynowane przez `createPostContext`, za siatką testów charakteryzujących + quick-win C2: usunięcie runtime type-assert `*SqlTemporaryPostStore` na ścieżce burn-on-read (`plan.md:6-9`). Docelowo `CreatePost` czyta się jako orkiestrator `validate → prepare → save → post-save` (`plan.md:32-37`).

**Czego świadomie NIE robimy.** Nie konsolidujemy szerszego dispatch BoR (~18 guardów + ~13 reveal call-sites); nie ruszamy 3 niezmienników bezpieczeństwa BoR; nie budujemy generycznego frameworka pipeline; nie zmieniamy public API / modelu / webappu (`plan.md:48-58`).

**Fazy + weryfikacja:**

- Faza 0 — siatka testów charakteryzujących (C1 branches + 5 gałęzi BoR). _Auto: `go test`/`go build`/`make lint`; ręcznie: spot-check mutacji_ (`plan.md:109-118`).
- Faza 1 — C2 quick-win, usunięcie type-assert. _Auto: grep pusty + storetest + BoR app tests; ręcznie: atomowość zapisu_ (`plan.md:152-162`).
- Faza 2 — `createPostContext` + 3 leaf-helpery. _Auto: `TestCreatePost` + diff tylko `app/post.go`; ręcznie: krótszy body_ (`plan.md:194-203`).
- Faza 3 — klaster pre-save preparation. _Auto: `TestCreatePost` + strip-branch green; ręcznie: brak reorderingu_ (`plan.md:227-237`).
- Faza 4 — tangled Save region (deferowalna, jeśli spike pokaże nierozdzielny seam). _Auto: `TestCreatePost`+`TestCreatePostDeduplicate`+full app suite; ręcznie: dedup + brak driftu BoR_ (`plan.md:268-280`).

## 5. Domena wg DDD — 10xCards (z L5)

**Ubiquitous language (kluczowe + rozjazdy model-vs-kod):**

- **Flashcard** — para słowo↔tłumaczenie jednego usera; anemiczny `interface Flashcard`, bez metod (`01:56`).
- **Candidate / GenerationRequest** — propozycja AI, transient input; rdzeń produktu (`01:57-58`).
- **Worthy/Trivial** — rdzeniowa reguła jakości żyje **tylko w prompcie** `generate.ts:10-11`, brak jako reguła kodu (`01:59`).
- **Rozjazd #1 (najpoważniejszy):** Success Criteria wymagają „≥75% kandydatów AI zaakceptowanych / ≥75% kolekcji z AI", ale **kod nie odróżnia fiszek AI od ręcznych** — brak kolumny `source`, identyczny INSERT dla obu ścieżek → obie metryki niemierzalne (`01:116`).
- **Rozjazd #3:** pełny flow SRS jest zaimplementowany, choć PRD wciąż figuruje go jako Non-Goal — dryf dokumentacji (`01:118`).

**Niezmiennik #1 i agregat.** Wybrany niezmiennik: **proweniencja + kompletne księgowanie decyzji** (N1 `source: ai|manual` immutable + N2 policzalność accept/reject). Dziś egzekwowany w 0 warstwach serwerowych — jedyny ślad to ulotny stan React (`GenerateView.tsx:87-89`). Agregat-strażnik: **`GenerationBatch`** (nowa tabela `generation_batches` z `candidates_presented/accepted`, RPC `accept_candidate` z `FOR UPDATE`, fiszka tworzona wyłącznie przez fabryki agregatu) (`02:34-35,64,142-152`).

**Anti-Corruption Layer.** Przeciekająca zależność #1: **`ts-fsrs`** — przecieka przez **kształt**, nie symbol, do **3 warstw / ~7 plików** (DB, `types.ts`, 4 trasy API, klient `ReviewSession`). 10-polowy `Card` zrekonstruowany 1:1 w czterech kopiach (K1–K4); nazwy kolumn DB = nazwy pól biblioteki, więc „wymień bibliotekę" = „migruj bazę" (`03:64-72,136-149`). ACL: port `Scheduler` + value object `ReviewSchedule` + adapter `review-schedule.ts` jako jedyny posiadacz `ts-fsrs` (kryterium grep: `03:332`).

## 6. Decyzje, które należą do mnie

AI zmapowało aktywność/strukturę (L2), prześledziło przepływ i policzyło dług (L3) oraz zaproponowało dekompozycję i wzorce DDD (L4/L5) — ale rozstrzygnięcia kierunkowe pozostają moje. **Po pierwsze**, wybór jednego badanego przepływu (zapis posta) spośród sześciu stref ryzyka — bo to on łączy najwięcej gorących obszarów naraz. **Po drugie**, zakres planu: świadome wycięcie szerszego refaktoru BoR i deferowalność najtrudniejszej Fazy 4 — AI dało opcje, ja przesądziłem, że bezpieczeństwo BoR to twarda granica nietykalna. **Po trzecie**, w 10xCards wybór niezmiennika #1 (proweniencja, nie soft-delete ani izolacja) — bo to jedyny, który dotyka definicji sukcesu produktu, a nie peryferii. **Po czwarte**, decyzja, że `ts-fsrs` (nie `@supabase`) jest przeciekiem #1, mimo że oba są kandydatami — bo intencja wymienialności jest tu zadeklarowana i złamana. To są osądy wartości i ryzyka; AI je oświetliło, ja je podjąłem.
