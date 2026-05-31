# Navigation Improvements (S-05) — Plan Brief

> Full plan: `context/changes/navigation-improvements/plan.md`

## What & Why

Authenticated pages `/dashboard`, `/collection`, and `/generate` have no navigation bar — there's no consistent way to move between views (gap noticed during S-01–S-03). This plan gives those pages a shared, auth-aware nav bar by introducing an authenticated app layout and reusing the existing `Topbar` component.

## Starting Point

A working auth-aware nav (`Topbar.astro`) already exists but is mounted only on the home page, inside `Welcome.astro`. The shared `Layout.astro` carries no nav and no background — instead each page draws its own full-screen `bg-cosmic min-h-screen` background (dashboard inline; collection/generate inside their React islands). Dashboard also has its own duplicate sign-out form.

## Desired End State

The three authenticated pages render one consistent nav bar at the top of the cosmic background: a `10xCards` brand link, Dashboard / Generate / Collection links, the user's email, and Sign out — with the current page highlighted and the bar wrapping gracefully on mobile. Auth pages and the home page stay structurally unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Nav placement | Shared `AppLayout.astro` owning cosmic bg + nav | Single source of truth; nav sits correctly inside the cosmic background instead of on a white strip | Plan |
| Component | Reuse/extend existing `Topbar.astro` | Already auth-aware and wired to sign-out; zero new client JS | Plan |
| Nav items | Brand, Dashboard, Generate, Collection, email, Sign out | Covers all authenticated destinations (Generate was missing) | Plan |
| Pages in scope | dashboard, collection, generate; home & auth left as-is | S-05 targets; avoids duplicate nav on home and unwanted nav on auth | Plan |
| Active state | Highlight current route via `Astro.url.pathname` | Standard wayfinding, cheap in an Astro component | Plan |
| React-view change | Strip outer `bg-cosmic min-h-screen`, keep inner content | Layout owns the background; avoids doubled backgrounds | Plan |
| Responsive | Flex row, no hamburger | Enough for ~4 links, no JS, matches current Topbar | Plan |

## Scope

**In scope:** Extend `Topbar.astro` (Generate link, brand prop, active highlight); new `AppLayout.astro`; migrate dashboard/collection/generate onto it; remove dashboard's duplicate sign-out and the React views' outer background wrappers.

**Out of scope:** Home/auth page restructuring; new React navbar / dropdown / avatar / hamburger; new shadcn components; auth-flow, middleware, or theme changes; CollectionView/GenerateView internals beyond the outer wrapper.

## Architecture / Approach

`AppLayout.astro` wraps `Layout.astro` (reusing its `<head>`/banner), owns the `bg-cosmic min-h-screen` background, and renders `<Topbar brand />` above a content `<slot/>`. The three authenticated pages switch to `AppLayout`; the two React islands lose their outer cosmic wrapper (now layout-owned) and keep only their inner `mx-auto max-w-2xl` content.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extend Topbar | Generate link, brand prop, active highlight, responsive | Side-effect on home's shared Topbar (mitigated: brand off by default) |
| 2. AppLayout.astro | Shared authenticated chrome (bg + nav + slot) | Padding/spacing must match current page wrappers |
| 3. Migrate 3 pages | dashboard/collection/generate on AppLayout | Doubled background / nested min-h-screen if outer wrapper not removed atomically |

**Prerequisites:** None beyond the current codebase (F-01 already landed; runs parallel to S-04).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Removing the React views' outer `bg-cosmic min-h-screen` could shift their vertical sizing/centering — verify each view fills height under the layout (esp. dashboard's centered card).
- Extending the shared `Topbar` also affects the home page's bar; assumed acceptable (Generate link only when authed, brand gated off, no link highlighted on `/`).

## Success Criteria (Summary)

- Each of `/dashboard`, `/collection`, `/generate` shows exactly one correctly-placed nav bar with working links, active highlight, and sign-out.
- Auth pages and home are unchanged; no duplicate sign-out on dashboard.
- `npx astro check`, `npm run lint`, and `npm run build` all pass.
