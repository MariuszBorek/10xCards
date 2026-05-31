# Navigation Improvements (S-05) Implementation Plan

## Overview

Authenticated pages `/dashboard`, `/collection`, and `/generate` currently render with no navigation bar — there is no consistent way to move between views. The home page (`/`) already shows an auth-aware `Topbar`, but it lives inline inside `Welcome.astro` and is used nowhere else. This plan introduces a shared authenticated layout (`AppLayout.astro`) that owns the cosmic background and a reused, extended `Topbar`, then migrates the three target pages onto it. Home and auth pages stay structurally as-is.

## Current State Analysis

- **`Layout.astro`** (`src/layouts/Layout.astro:38`) is a bare shell: `<head>` + a config-error `Banner` + `<slot/>` on a white `<body>`. It carries **no** navigation and **no** background.
- **Each page draws its own full-screen `bg-cosmic min-h-screen` background**, not the layout:
  - `dashboard.astro:8` — `<div class="bg-cosmic flex min-h-screen items-center justify-center p-4">`
  - `CollectionView.tsx:113` — `<div className="bg-cosmic min-h-screen p-6">` wrapping `<div className="mx-auto max-w-2xl space-y-6">`
  - `GenerateView.tsx:88` — `<div className="bg-cosmic min-h-screen p-6">` wrapping `<div className="mx-auto max-w-2xl space-y-6">`
- **`Topbar.astro`** (`src/components/Topbar.astro:1-40`) is the only existing nav. It reads `Astro.locals.user`, and:
  - authenticated: shows `user.email`, links to `/dashboard`, `/collection`, and a `POST /api/auth/signout` form button.
  - unauthenticated: shows "Not signed in", links to `/auth/signin`, `/auth/signup`.
  - It is mounted only in `Welcome.astro:28` (the home page).
- **`/generate` is missing from Topbar's links** entirely.
- **Dashboard duplicates sign-out**: `dashboard.astro:25-32` has its own `POST /api/auth/signout` form, independent of Topbar's.
- **`collection.astro` / `generate.astro` are thin Astro wrappers** that mount React islands with `client:load` (`collection.astro:7`, `generate.astro:7`). Topbar is an Astro component and **cannot be imported into a `.tsx` view** — nav placement must happen at the `.astro`/layout level.
- **Middleware** (`src/middleware.ts`) populates `Astro.locals.user` on every request and protects `/dashboard`, `/generate`, `/collection`. So inside `AppLayout`, `Astro.locals.user` is guaranteed present for these routes.
- **Auth pages** (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) use `Layout.astro` directly and correctly show no nav — they must keep none.

### Key Discoveries:

- The per-page cosmic background is the load-bearing constraint: a nav rendered "above the slot" in `Layout.astro` would appear on the white body strip above each page's cosmic area — visually broken. The background must move into the shared authenticated layout so the nav sits inside it.
- `Topbar.astro` is auth-aware and already wired to the correct sign-out endpoint — extend and reuse it rather than build a new React navbar (no client JS needed).
- `Astro.url.pathname` is available in Astro components for active-route detection.
- React views own their outer `bg-cosmic min-h-screen`; to let the layout own the background cleanly, that outer wrapper is stripped from each view while keeping the inner `mx-auto max-w-2xl` content block.

## Desired End State

Navigating to `/dashboard`, `/collection`, or `/generate` shows a consistent nav bar at the top of the cosmic background with: a `10xCards` brand link (→ `/`), links to Dashboard / Generate / Collection, the signed-in user's email, and a Sign out button. The link for the current page is visually highlighted. The bar is a responsive flex row that wraps/shrinks gracefully on small screens (no hamburger). Auth pages and the home page are unchanged in structure; the home page's existing inline Topbar continues to work (inheriting the new Generate link and active-highlight, with the brand element off).

Verified by: visiting each of the three pages and seeing one nav bar correctly placed on the cosmic background; clicking each link navigates correctly; the active link is highlighted; sign-out works; auth pages still show no nav; `npm run build` and `npx astro check` pass.

## What We're NOT Doing

- Not restructuring the home page (`/` / `Welcome.astro`) layout or its hero — it keeps its inline `<Topbar/>`.
- Not adding nav to auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`).
- Not building a new React navbar, dropdown menu, avatar, or mobile hamburger menu; not installing new shadcn components.
- Not changing the sign-out endpoint, auth flow, middleware, or `PROTECTED_ROUTES`.
- Not redesigning the cosmic theme, page content, or the internal layout of CollectionView/GenerateView beyond removing their outer background wrapper.

## Implementation Approach

Single shared nav component (`Topbar.astro`, extended) used in one place that matters: a new `AppLayout.astro` that wraps the existing `Layout.astro`, owns the `bg-cosmic min-h-screen` background, and renders the nav above a content `<slot/>`. The three authenticated pages switch to `AppLayout`. For the two React-island pages, the outer cosmic/background wrapper moves out of the `.tsx` view (now owned by the layout); the views keep their inner content container. Work is ordered nav-component → layout → page migration so each phase builds on a verified prior one.

## Critical Implementation Details

- **Background ownership must transfer atomically per page.** When a page switches to `AppLayout` (which sets `bg-cosmic min-h-screen`), its own `bg-cosmic min-h-screen` wrapper must be removed in the same change — otherwise you get a doubled background / nested `min-h-screen` and broken vertical sizing. Dashboard additionally centers content (`flex items-center justify-center`); decide centering placement when moving its wrapper (the layout provides height; dashboard's content can keep a centered inner container if desired).
- **`Topbar` is shared with home.** Extending it (Generate link, active highlight) also affects the home page's bar. This is intended and low-risk: on `/`, no nav link matches the pathname (nothing highlighted), and the Generate link only renders when authenticated. The brand element is gated behind a prop (default off) so home stays as-is.

## Phase 1: Extend the Topbar nav

### Overview

Add the Generate link, an optional brand element, and active-route highlighting to `Topbar.astro`, keeping it a responsive flex row. No new client JS.

### Changes Required:

#### 1. Topbar component

**File**: `src/components/Topbar.astro`

**Intent**: Make the existing auth-aware nav cover all authenticated destinations, support a brand anchor for the app shell, and indicate the current page — without changing its unauthenticated behavior or its home-page usage.

**Contract**:
- Reads `Astro.locals.user` (unchanged) and `Astro.url.pathname` (new) in the frontmatter.
- New prop `brand?: boolean` (default `false`). When true, render a left-aligned `10xCards` link to `/`. Home (`Welcome.astro`) renders `<Topbar/>` without it, so it stays off there.
- Authenticated link set becomes: `/dashboard` (Dashboard), `/generate` (Generate), `/collection` (Collection), then the existing sign-out form. Unauthenticated set (`/auth/signin`, `/auth/signup`) unchanged.
- Active highlighting: a link whose `href` matches `Astro.url.pathname` gets a distinct style (e.g. brighter text / underline) via a `cn()`-style conditional class. Keep the existing purple link styling for inactive links.
- Layout stays a flex row using the existing container classes; allow wrapping (`flex-wrap`) and let the email truncate/hide on the smallest screens via responsive classes so 4 links + email + sign-out don't overflow.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- On `/` (home), the Topbar still renders correctly with no brand element and no regressions.
- Authenticated Topbar shows Dashboard, Generate, Collection, email, Sign out.
- The link matching the current URL is visibly highlighted.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Create AppLayout.astro

### Overview

Introduce a shared authenticated layout that owns the cosmic background and renders the nav above page content.

### Changes Required:

#### 1. AppLayout component

**File**: `src/layouts/AppLayout.astro` (new)

**Intent**: Provide a single chrome for authenticated pages — cosmic background + nav + content slot — so individual pages no longer own background or nav.

**Contract**:
- Accepts a `title?: string` prop and forwards it to the wrapped `Layout.astro` (`<Layout title={title}>`), reusing the existing `<head>` and config banner.
- Renders the page shell: a `bg-cosmic min-h-screen` container (matching the cosmic background currently in the pages), with `<Topbar brand />` near the top inside a padded wrapper, then a `<slot/>` for page content.
- Padding/spacing mirrors the current page wrappers (e.g. `p-4 sm:p-8`) so migrated content keeps comparable margins.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A throwaway/manual check (or the first migrated page in Phase 3) renders the cosmic background with the nav at top — no white strip above the nav.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Migrate the three pages onto AppLayout

### Overview

Switch `/dashboard`, `/collection`, and `/generate` to `AppLayout`, removing their own background wrappers (and dashboard's duplicate sign-out). Transfer background ownership atomically per page.

### Changes Required:

#### 1. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Render dashboard content inside `AppLayout`, dropping its self-owned cosmic background and its now-redundant sign-out form (the nav provides sign-out).

**Contract**:
- Import and use `AppLayout` (`<AppLayout title="Dashboard">`) instead of `Layout`.
- Remove the outer `bg-cosmic flex min-h-screen items-center justify-center p-4` wrapper (background/height now from `AppLayout`); keep the inner card content (`Welcome, {user?.email}`, the Generate CTA). Preserve centered presentation as desired via an inner container.
- Remove the duplicate `POST /api/auth/signout` form (`dashboard.astro:25-32`).

#### 2. Collection page + view

**Files**: `src/pages/collection.astro`, `src/components/collection/CollectionView.tsx`

**Intent**: Place the collection island inside `AppLayout` and strip the view's outer full-screen background so the layout owns it.

**Contract**:
- `collection.astro`: use `<AppLayout title="Collection">` wrapping `<CollectionView client:load />` instead of `Layout`.
- `CollectionView.tsx`: remove the outer `<div className="bg-cosmic min-h-screen p-6">` wrapper (`CollectionView.tsx:113`); keep the inner `<div className="mx-auto max-w-2xl space-y-6">` content as the component's root. The island returns just the content container.

#### 3. Generate page + view

**Files**: `src/pages/generate.astro`, `src/components/generate/GenerateView.tsx`

**Intent**: Same migration as collection — island inside `AppLayout`, outer background removed.

**Contract**:
- `generate.astro`: use `<AppLayout title="Generate Flashcards">` wrapping `<GenerateView client:load />`.
- `GenerateView.tsx`: remove the outer `<div className="bg-cosmic min-h-screen p-6">` wrapper (`GenerateView.tsx:88`); keep the inner `<div className="mx-auto max-w-2xl space-y-6">` content as the root.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `/dashboard`, `/collection`, `/generate` each show exactly one nav bar on the cosmic background — no doubled background, no white strip, no nested scroll/height glitch.
- Each nav link navigates correctly; the active page is highlighted; user email shows; Sign out works and redirects home.
- Dashboard shows no second sign-out button.
- Auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) and home (`/`) are unchanged.
- Collection CRUD/export and Generate flows still work (no regression from removing the outer wrapper).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Manual Testing Steps:

1. Sign in, visit `/dashboard` — confirm nav bar on cosmic background, active "Dashboard" highlighted, email + Sign out present, no duplicate sign-out.
2. Click Generate → `/generate` renders with nav, "Generate" highlighted, GenerateView works.
3. Click Collection → `/collection` renders with nav, "Collection" highlighted; add/edit/delete/export a flashcard to confirm no regression.
4. Click the `10xCards` brand → lands on `/`.
5. Click Sign out → redirected to `/`, session cleared.
6. Visit `/auth/signin` and `/auth/signup` while signed out — confirm no nav bar.
7. Resize to mobile width on each page — nav wraps/shrinks gracefully, no overflow.

(There are no automated tests in this project yet — `npx astro check`, `npm run lint`, and `npm run build` are the automated gates.)

## Performance Considerations

Negligible. The nav is a static Astro component (server-rendered, zero added client JS). Moving the background into `AppLayout` does not change the rendered DOM weight meaningfully.

## Migration Notes

No data or schema changes. Per-page background ownership must transfer in the same change that switches each page to `AppLayout` (see Critical Implementation Details) to avoid doubled backgrounds.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05)
- Existing nav: `src/components/Topbar.astro:1-40`
- Shared layout: `src/layouts/Layout.astro:38`
- Background-owning views: `src/pages/dashboard.astro:8`, `src/components/collection/CollectionView.tsx:113`, `src/components/generate/GenerateView.tsx:88`
- Sign-out endpoint: `src/pages/api/auth/signout.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extend the Topbar nav

#### Automated

- [x] 1.1 Type-check passes: `npx astro check`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Build passes: `npm run build`

#### Manual

- [x] 1.4 Home Topbar renders correctly with no brand element, no regressions
- [x] 1.5 Authenticated Topbar shows Dashboard, Generate, Collection, email, Sign out
- [x] 1.6 Link matching current URL is visibly highlighted

### Phase 2: Create AppLayout.astro

#### Automated

- [ ] 2.1 Type-check passes: `npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Build passes: `npm run build`

#### Manual

- [ ] 2.4 Cosmic background renders with nav at top, no white strip above nav

### Phase 3: Migrate the three pages onto AppLayout

#### Automated

- [ ] 3.1 Type-check passes: `npx astro check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`

#### Manual

- [ ] 3.4 Each target page shows exactly one nav bar on cosmic background, no doubled bg / white strip / height glitch
- [ ] 3.5 Nav links navigate correctly, active page highlighted, email shows, Sign out works
- [ ] 3.6 Dashboard has no second sign-out button
- [ ] 3.7 Auth pages and home unchanged
- [ ] 3.8 Collection CRUD/export and Generate flows still work
