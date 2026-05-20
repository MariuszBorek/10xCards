---
project: 10xCards
context_type: greenfield
created: 2026-05-20
updated: 2026-05-20
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "zakres tematyczny fiszek"
      decision: "tylko fiszki językowe (słówka obcojęzyczne); ogólne fiszki edukacyjne (historia, biologia, programowanie) wykluczone z MVP — uznane za inny produkt"
    - topic: "persona scope"
      decision: "primary persona = autor projektu (osoba ucząca się języka); MVP od pierwszego dnia obsługuje multi-user infrastrukturalnie (login), bo planowane otwarcie dla innych uczących się"
    - topic: "źródło puli słówek"
      decision: "dwa kanały: (a) notatki z lekcji/kursu/podręcznika — większy tekst do przerobienia, (b) ad-hoc pojedyncze słówka napotkane w życiu (rozmowa, ulica, film)"
    - topic: "insight vs status quo"
      decision: "podobne rozwiązania istnieją, ale są zamknięte / drogie / niewygodne; przewaga 10xCards = otwarte, prostsze UX, dostosowane do indywidualnego workflow użytkownika"
    - topic: "model dostępu"
      decision: "pełne logowanie email+hasło od pierwszego dnia (nie lokalny profil), żeby uniknąć bolesnej migracji single→multi-user w przyszłości"
    - topic: "role w MVP"
      decision: "płaski model — wszyscy zalogowani są równymi userami, każdy widzi tylko swoje fiszki; brak adminów, brak płatnych planów w MVP"
    - topic: "zakres MVP vs czas"
      decision: "scope-down: v1 ogranicza się do flow 'wklej tekst → AI generuje → akceptuj/edytuj → zapisz → eksportuj CSV'. Wycięte z v1: własne UI nauki, integracja z algorytmem SRS, statystyki. Eksport CSV pełni rolę pomostu do Anki (gdzie SRS działa)."
    - topic: "timeline budget"
      decision: "3 tygodnie after-hours, bez hard deadline. Mieści się w heurystyce shape — brak potrzeby timeline-acknowledgment."
  frs_drafted: 11
  quality_check_status: accepted
---

# 10xCards — shape notes

Seed (z `idea-notes.md`): aplikacja do generowania fiszek edukacyjnych z pomocą AI, integrowana z gotowym algorytmem spaced-repetition. W toku fazy 1 zawężono do **fiszek językowych** (słówka obcojęzyczne).

## Vision & Problem Statement

Osoba ucząca się języka obcego regularnie zbiera pulę nowych słówek — z notatek z lekcji/podręcznika oraz z ad-hoc kontaktów z językiem (rozmowa, film, ulica). Żeby uczyć się ich efektywnie metodą spaced-repetition, musi przerobić tę pulę na fiszki — co dzisiaj oznacza ręczne wpisywanie słowa, tłumaczenia, czasem przykładu i części mowy do Anki/Quizlet. Na pulę kilkudziesięciu słówek schodzą godziny. Koszt jest na tyle duży, że wielu uczących się rezygnuje z fiszek mimo dowodów na skuteczność spaced-repetition.

Generatywne LLM-y rozwiązują dokładnie tę żmudną część — z pojedynczego słowa lub większego kawałka tekstu potrafią wyciągnąć dobrej jakości parę "słowo ↔ tłumaczenie" wraz z kontekstem. Konkurencyjne rozwiązania w tej przestrzeni istnieją, ale są zamknięte, drogie lub mają niewygodne UX-y oderwane od realnego workflow uczącego się. Wartość 10xCards leży w połączeniu trzech rzeczy: (1) generowania fiszek z dowolnego wkleionego tekstu, (2) szybkiego ręcznego dodawania pojedynczego słówka napotkanego ad-hoc, (3) integracji z gotowym, sprawdzonym algorytmem powtórek — wszystko podporządkowane workflow jednej osoby, która sama używa tej aplikacji do nauki.

## User & Persona

**Persona główna**: osoba ucząca się języka obcego we własnym tempie (samouk; może równolegle chodzić na kurs/lekcje, ale fiszki tworzy dla siebie, nie dla cudzego programu).

- **Kontekst**: uczy się regularnie, najczęściej wieczorami / między obowiązkami; ma świadomość metody spaced-repetition (zna Anki, ale go zniechęca koszt tworzenia fiszek).
- **Moment**: ma "kupkę" nowych słówek do przerobienia — albo skopiowane z notatek/podręcznika, albo zapamiętane ad-hoc z dnia. Chce zamienić to na fiszki możliwie szybko i wrócić do nauki.
- **Cel pierwszy**: skrócić czas między "napotkałem nowe słowo" a "zacząłem je powtarzać" z kilkudziesięciu minut do kilku sekund.

W MVP: primary persona = autor projektu (osoba ucząca się). Aplikacja od pierwszego dnia ma infrastrukturę multi-user (login email+hasło), ale UX i funkcje są optymalizowane pod doświadczenie indywidualnego uczącego się; inni użytkownicy są wtórni i przechodzą przez ten sam flow.

## Access Control

Pełne logowanie od pierwszego dnia: rejestracja i logowanie email + hasło. Płaski model użytkowników — brak ról (brak admina, brak premium/free). Każdy zalogowany użytkownik widzi i operuje **tylko na własnych fiszkach**; izolacja danych między kontami jest twarda.

- **Sign-up**: użytkownik tworzy konto samodzielnie przez formularz (email + hasło).
- **Sign-in**: standardowy login email + hasło; sesja utrzymywana między wejściami.
- **Niezalogowany dostęp do trasy chronionej**: redirect do ekranu logowania.
- **Wylogowanie**: dostępne w UI.
- **Reset hasła**: w MVP — TBD (patrz `## Open Questions`); domyślnie zakładamy reset przez email link, ale to nie jest jeszcze przesądzone.

Decyzja "login od dnia 1, nie lokalny profil" wynika z planu, by produkt był otwarty dla kolejnych uczących się — migracja single-user → multi-user jest bolesna, więc lepiej zacząć od właściwej topologii.

## Success Criteria

MVP zostaje zawężone do flow: **wklej tekst → AI generuje fiszki → user akceptuje/edytuje/odrzuca → zapisuje kolekcję → eksportuje do CSV pod Anki**. Własne UI nauki i integracja z algorytmem SRS wycięte z v1 — Anki obsługuje powtórki "outside the app". Manualne tworzenie pojedynczej fiszki i edycja/usuwanie w kolekcji zostają w MVP (cheap features).

### Primary

- **≥ 75% fiszek wygenerowanych przez AI jest zaakceptowanych przez użytkownika** (akceptacja może być z edycją; odrzucenie = "nie nadaje się"). Mierzy jakość wyjścia AI — bez tego cała propozycja wartości znika.
- **≥ 75% wszystkich fiszek w kolekcji użytkownika powstaje przez AI**, nie ręcznie. Mierzy, czy AI-flow faktycznie zastępuje żmudne ręczne wpisywanie (gdyby user nadal manualnie robił większość fiszek, MVP rozwiązuje pozorny problem).

### Secondary

Brak. Świadoma decyzja — trzymamy się dwóch jasnych Primary.

### Guardrails

- **Izolacja danych między kontami** — żaden zalogowany użytkownik nigdy nie widzi cudzych fiszek ani cudzych wkleinych tekstów. Wyciek = katastrofa, bo notatki bywają osobiste (np. słownictwo medyczne, prawnicze, prywatne).
- **Tekst wklejony do generacji nie pozostaje w storage dostępnym operatorowi po zakończeniu przetwarzania** — input jest "transient": użyty tylko do wygenerowania fiszek, potem znika z systemu.
- **Brak utraty fiszek** — raz zaakceptowana fiszka nie znika z kolekcji bez intencjonalnego usunięcia przez użytkownika. Bug typu "zaakceptowałem 30 fiszek, w widoku lista pusta" = użytkownik odchodzi i już nie wraca.

Timeline budget: **3 tygodnie after-hours**, brak hard deadline.

## Functional Requirements

### Authentication

- FR-001: User can register an account using email and password. Priority: must-have
  > Socrates: Counter-arguments considered ("magic link / passwordless lepsze UX", "OAuth wycina onboardowanie"). Resolution: stands as written — email+password jest standardem zrozumiałym dla wszystkich, bez dodatkowego buildoutu (mail provider, OAuth client).
- FR-002: User can sign in with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "bez 'remember me' codzienny login zniechęca użytkownika wracającego do flashcard appki". Resolution: kept; sesja musi być długożyjąca / wspierać 'remember me' — design detail przekazany do downstream (stack-selector / impl plan).
- FR-003: User can sign out. Priority: must-have
  > Socrates: Counter-argument considered: "auto-expiry sesji wystarczy". Resolution: stands as written — explicit logout jest oczekiwany przez 99% web-userów; brak = dziwne, koszt implementacji zerowy.

### AI flashcard generation

- FR-004: User can submit foreign-language input — from a single word to a longer passage of text/notes — and request AI generation of flashcard candidates. Priority: must-have
  > Socrates: Counter-argument considered: "range single-word vs paragraph jest za szeroki; jeden form/prompt skompromituje oba przypadki". Resolution: stands as written w MVP — jeden adaptacyjny prompt; jakość per-długość wejdzie do `## Open Questions` jako kwestia prompt-engineering downstream.
- FR-005: User can review each generated flashcard candidate and accept it, reject it, or edit its content before accepting. Priority: must-have
  > Socrates: Counter-arguments considered ("decision fatigue przy 30 kandydatach", "edit będzie pomijany"). Resolution: stands as written — trzy akcje są standardowym review UX; bulk-accept można dodać w v2 jeśli okaże się potrzebne.
- FR-006: Accepted candidates are persisted to the user's flashcard collection; rejected candidates are not. Priority: must-have
  > Socrates: Counter-argument considered: "rejected = lost forever; brak undo lub 'review later'". Resolution: stands as written — mental model 'odrzucam = decyduję świadomie' jest prosty i zgodny ze scope MVP; ewentualny undo w sesji review = v2.

### Manual flashcard creation

- FR-007: User can manually create a single flashcard by entering word + translation (and optionally a context sentence). Priority: must-have
  > Socrates: Counter-argument considered: "redundantne z FR-004 (AI obsługuje single-word)". Resolution: stands as written — manual entry to escape hatch dla przypadku gdy user zna tłumaczenie i nie chce 'wydawać' tokenów AI; dwa formy są tanie do utrzymania w MVP.

### Collection management

- FR-008: User can browse the full list of flashcards in their own collection. Priority: must-have
  > Socrates: Counter-arguments considered ("bez search/filter duża kolekcja jest write-only", "paginacja niezdefiniowana"). Resolution: stands as written — MVP startuje od małej kolekcji; search/sort/filter trafia do `## Open Questions` jako rzecz do rozważenia, gdy kolekcja przekroczy ~200 fiszek.
- FR-009: User can edit any existing flashcard in their collection. Priority: must-have
  > Socrates: Counter-argument considered: "edit after-the-fact to power-user feature; większość userów nigdy nie edytuje". Resolution: stands as written — AI generuje halucynacje, więc edit jest TANIM mechanizmem naprawy; bez niego user musiałby delete + manual-add, co jest gorszym UX.
- FR-010: User can delete any existing flashcard from their collection. Priority: must-have
  > Socrates: Counter-arguments considered ("delete-without-undo niebezpieczny", "soft-delete vs hard-delete"). Resolution: stands as written — w MVP confirm dialog wystarczy; soft-delete można dodać później jeśli okaże się potrzebne (low-cost decision do podjęcia w design).

### Export

- FR-011: User can export their flashcard collection to a CSV file that imports into Anki without manual modification. Priority: must-have
  > Socrates: Counter-arguments considered ("Anki lock-in vs inne SRS", "format Anki zmienia się w wersjach"). Resolution: stands as written — Anki jest de-facto standardem wśród hardcore SRS-userów; format CSV jest na tyle prosty, że można wystawić wariant 'generic CSV' w v2 jeśli okaże się potrzebne.

> **FR-004 (delete account) wycięty z MVP po fazie 4.5 Socrates**: w `idea-notes.md` nie był wymieniony explicit, dorzucony w fazie 4 jako RODO-readiness. Po Socratesie zdecydowano: dla małego/prywatnego deploymentu RODO-self-service-delete jest overkillem; alternatywa = email-do-admina. Trafia do `## Non-Goals` (faza 6).

## Business Logic

Dla wkleionego przez użytkownika obcojęzycznego wejścia — od pojedynczego słowa po dłuższy tekst — aplikacja decyduje, jakie pary słowo ↔ tłumaczenie (opcjonalnie ze zdaniem przykładowym) najlepiej oddają nową wiedzę językową w nim zawartą, i prezentuje je użytkownikowi jako kandydatów do recenzji.

Wejście, które rule konsumuje, to surowy tekst w języku obcym, w którym uczy się persona — od jednego słowa zapamiętanego z rozmowy, przez listę słówek z notatek, po cały akapit z artykułu/podręcznika. Aplikacja sama (a) identyfikuje, które jednostki językowe w tym wejściu warto zamienić na fiszki (np. nieoczywiste słowa, idiomy, rzadkie odmiany), (b) generuje dla każdej takiej jednostki tłumaczenie i opcjonalny krótki kontekst, (c) odrzuca jednostki trywialne / oczywiste / niegodne fiszki (rzeczy które user już zna lub które są zbyt podstawowe w stosunku do reszty wejścia).

Wyjściem jest lista kandydatów na fiszki, którą użytkownik napotyka w widoku review — każdy kandydat z trzema akcjami (akceptuj / odrzuć / edytuj). Akceptacja przenosi kandydata do trwałej kolekcji użytkownika; pozostałe znikają. Reguła operuje **na poziomie pojedynczego wywołania generacji**: aplikacja nie pamięta wcześniejszych wejść ani nie odnosi propozycji do wcześniejszej zawartości kolekcji użytkownika (deduplication, level-adaptation — explicit poza MVP, świadoma decyzja w fazie 5).

## Non-Functional Requirements

- Generacja kandydatów na fiszki jest operacją asynchroniczną z punktu widzenia użytkownika; dla każdej operacji trwającej dłużej niż dwie sekundy użytkownik widzi ciągły, widoczny wskaźnik postępu — okno aplikacji nigdy nie wygląda na "zawieszone" bez sygnału.
- Tekst wprowadzony przez użytkownika do generacji nie pozostawia śladu w storage dostępnym operatorowi po zakończeniu żądania, które go zużyło. Wejście jest transient — żyje tylko na czas wytworzenia kandydatów; po tym momencie aplikacja nie ma sposobu na rekonstrukcję tego, co user wkleił.
- Aplikacja pozostaje funkcjonalnie używalna w dwóch najnowszych wersjach głównych czterech przeglądarek desktopowych (Chrome, Firefox, Safari, Edge). Wcześniejsze wersje ani środowiska mobilne nie są gwarantowane w MVP.
- Krytyczne pola formularzy (logowanie, rejestracja, wprowadzanie hasła) potwierdzają wprowadzony znak użytkownikowi w czasie krótszym niż 200 ms. Pisanie nigdy nie "wisi" za użytkownikiem.

## Non-Goals

### Z `idea-notes.md` (oryginalny seed)

- **Własny algorytm spaced-repetition** (typu SuperMemo, Anki). MVP integruje się z istniejącym ekosystemem (Anki) przez eksport CSV; budowanie własnego SRS = miesięcy pracy. v2+.
- **Import wielu formatów (PDF, DOCX, EPUB, itp.)** MVP przyjmuje tylko surowy tekst (paste). Import plików dodaje parsing, OCR, edge cases — wycięte.
- **Współdzielenie zestawów fiszek między użytkownikami.** MVP jest single-user-focused. Sharing wymaga ACL, permissions, public/private flags — duża praca.
- **Integracje z innymi platformami edukacyjnymi** (Duolingo, Memrise, language learning apps). Brak partnerstw, brak ich API. Eksport CSV jest jedynym mostem.
- **Aplikacja mobilna (iOS, Android, PWA).** Tylko web desktop w MVP. Mobile = v2+ (przeglądarka mobilna może działać "incydentalnie", ale nie jest gwarantowana).

### Wyłonione podczas shape (`/10x-shape`)

- **Fiszki edukacyjne ogólne** (historia, biologia, programowanie, definicje, koncepty). MVP jest dedykowany **nauce języka obcego** — formularze, prompt LLM-a i UX są pod słownictwo. Inne dziedziny = osobny produkt. (z fazy 1)
- **Własne UI nauki + integracja z algorytmem SRS** (own study view, własny scheduler powtórek). Wyciety z v1 w fazie 3 scope-down; user wgrywa wyeksportowany CSV do Anki, gdzie SRS jest sprawdzony. v2+.
- **Self-service usuwania konta** (delete-with-cascade fiszek). RODO-readiness przez self-service uznane za overkill dla małego/prywatnego deploymentu w fazie 4.5. Alternatywa: email-do-admina. v2+.
- **Reset hasła** (forgot password flow z email-linkiem). Świadomie poza MVP — user zgłasza się do admina, jeśli zapomni hasła. v2+. (z fazy 4)
- **Deduplication przy generacji** — AI nie sprawdza, czy zaproponowane słowo jest już w kolekcji użytkownika. User zobaczy duplikaty i odfiltruje je manualnie. Deduplication wymaga lookupu w bazie per kandydat — koszt poza MVP. (z fazy 5)
- **Level-adaptive generation** — AI nie zna poziomu użytkownika (A1 vs C1), proponuje uniwersalnie. Profil poziomu i adaptive prompting = v2+. (z fazy 5)
- **Search / sort / filter w widoku kolekcji** — MVP daje flat list. Search wchodzi do roadmapy gdy kolekcja użytkowników przekroczy ~200 fiszek. (Open Question z fazy 4.5)
- **Statystyki postępu nauki** (ile fiszek powtórzonych, success rate, streaks). Skoro nie ma własnego SRS w MVP, nie ma własnych metryk powtórek — statystyki dostarcza Anki po imporcie. v2+.

## Open Questions

1. **Prompt engineering pod różne długości wejścia (FR-004).** Jeden adaptacyjny prompt dla single-word i dla paragrafu może dawać niespójną jakość. Owner: faza implementacji / iteration na prompcie. Wymaga eksperymentu z rzeczywistymi inputami.
2. **Limit długości wejścia do generacji (FR-004).** LLM-y mają token limit; w MVP zakładamy "umiarkowany akapit" (do ~kilkuset słów). Powyżej tej granicy decyzja: ucinać (jaki cap?), chunking + agregacja, czy odmawiać. Owner: implementacja.
3. **Co to "fiszka godna" / "fiszka trywialna" (Business Logic).** Reguła mówi że AI odrzuca "trywialne / oczywiste" jednostki. Konkretne kryteria odrzucenia (np. najpopularniejsze 1000 słów, predykcyjna miara trudności, frequency rank) — do ustalenia podczas iteracji nad promptem.
4. **Reset hasła (Access Control).** W MVP wyciety; alternatywa "email-do-admina" wymaga, by user wiedział gdzie pisać. Czy w UI logowania jest jakiś link "zapomniałeś?" → "skontaktuj się [adres]"? Owner: design downstream.
5. **Sesja: jak długa, jakie 'remember me' (Access Control / FR-002).** Counter-arg z fazy 4.5: "no remember-me = daily-login friction". Konkretna wartość session lifetime + opt-in 'remember me' — do downstream stack-selector / impl decision.
6. **Search/sort/filter w kolekcji (FR-008).** Z Socrates: 'flat list staje się write-only powyżej ~200 fiszek'. Wprowadzenie do roadmapy v2; decyzja kiedy/jak. Owner: post-MVP feedback.
7. **CSV-format kompatybilny z Anki (FR-011).** Anki ma kilka formatów importu (basic, cloze, reversed). MVP zakłada "basic" (front+back+optional context). Konkretne kolumny + escape rules dla diacritics/przecinków/cudzysłowów — do impl decision.

## Quality cross-check

Bramka 7 sprawdziła 5 elementów (Access Control, Business Logic one-sentence rule, Project artifacts, Timeline-cost acknowledged, Non-Goals — preserved behavior n/a dla greenfield). **Wszystkie obecne, brak gapów.** `quality_check_status: accepted`.

## Forward: tech-stack-selector (informational — NOT part of PRD)

Decyzje z shape, które są wejściem dla downstream `10x-tech-stack-selector`, ale **nie należą do PRD**:

- Produkt jest webowy (single-page lub MPA — do wyboru w stack-selectorze).
- Backend musi obsłużyć: auth (email+password, sesje long-lived), persystencję kolekcji fiszek, wywołanie LLM-a po stronie serwera (tekst wkleiny przez usera musi być transient — patrz NFR).
- LLM API jest external dependency. Wybór providera (OpenAI, Anthropic, lokalny model, hosted open-source) zostaje na stack-selectorze. NFR mówi: tekst inputu nie pozostaje u operatora — to zawęża providerów, którzy logują requesty.
- Eksport CSV: zwykłe POST → text/csv. Brak specjalnych wymagań stackowych.
- Brak mobile, brak offline, brak real-time → stack ma swobodę.

## User Stories

### US-01: User turns pasted notes into a flashcard set

- **Given** a logged-in user with foreign-language notes (a paragraph of text or a list of words)
- **When** they paste the notes into the AI generation form and submit
- **Then** the system returns a list of candidate flashcards (word ↔ translation, optionally with a short context sentence), each of which the user can accept, reject, or edit before saving (FR-004, FR-005, FR-006)

#### Acceptance Criteria

- Submitting an empty input shows an explanatory error, not a blank candidates list.
- During AI generation, the user sees continuous visible feedback (the operation may take several seconds).
- Each candidate appears with three actions visible at once: accept, edit, reject.
- Editing a candidate shows the word, translation, and context fields editable in-place.
- Accepting (with or without edit) adds the candidate to the user's collection immediately; rejected candidates are dropped on the floor.
- If the AI returns zero candidates for a non-empty input, the user sees an explanatory empty-state with the option to retry or add manually.

### US-02: User exports collection to Anki

- **Given** a logged-in user with at least one flashcard in their collection
- **When** they request a CSV export
- **Then** the system produces a CSV file that, when imported into Anki without any manual modification, results in flashcards matching the user's collection — word on front, translation on back, context where present (FR-011)

#### Acceptance Criteria

- The export covers all flashcards in the user's collection at the moment of request.
- Special characters (diacritics, quotes, commas) in flashcard content survive the round-trip into Anki.
- An empty collection does not produce a download — the user sees an empty-state message.

