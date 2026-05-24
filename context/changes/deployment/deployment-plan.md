# Cloudflare Workers Deployment Plan — 10xCards

## Context

Deploy the 10xCards app (Astro 6 SSR + React 19) to Cloudflare Workers for the first time.

The `wrangler.jsonc` is already wired for **Cloudflare Workers with Assets** (the newer, recommended pattern — not Cloudflare Pages). It uses a `main` field pointing to `@astrojs/cloudflare/entrypoints/server` and an `assets` binding pointed at `./dist`. The deploy command is `npx wrangler deploy` — **not** `wrangler pages deploy`.

Both known React 19 + Cloudflare build issues (#15796 and #12824) are closed/resolved. No workaround needed.

The only missing pieces: Cloudflare auth, project name decision, Supabase production credentials, secrets wiring, and executing the deploy.

---

## Prerequisites

### A — Node.js

- [ ] Confirm Node.js v22.14.0 is available: `node -v`
  - If not: install via [nvm](https://github.com/nvm-sh/nvm): `nvm install 22.14.0 && nvm use 22.14.0`
  - Or install directly from [nodejs.org](https://nodejs.org/) — pick LTS v22.x
- [ ] Confirm npm is available: `npm -v`

### B — Wrangler CLI

Wrangler is already in `devDependencies` (`wrangler@^4.x`) — no global install needed.
All commands use `npx wrangler` which resolves the local version.

- [ ] Run `npx wrangler --version` to confirm it resolves (requires `node_modules` installed)
  - If `node_modules` is absent: `npm install`

### C — Cloudflare account

- [ ] Create a free Cloudflare account at [cloudflare.com](https://cloudflare.com) (no credit card required)
  - Free tier covers: 100,000 Workers requests/day, unlimited static assets
- [ ] Have account email + password ready for the OAuth flow in Phase 2

### D — Supabase account (for full auth support)

- [ ] Create a free Supabase account at [supabase.com](https://supabase.com)
- [ ] Create a new project (choose a region close to your users; free tier allows 2 active projects)
- [ ] Wait for project to finish provisioning (~1–2 minutes)
- [ ] Go to Dashboard → **Settings** → **API**:
  - Copy **Project URL** → this is `SUPABASE_URL`
  - Copy **anon public** key → this is `SUPABASE_KEY`
  - **Do not use the `service_role` key** — it bypasses RLS and must never be exposed
- [ ] Go to Dashboard → **Authentication** → **URL Configuration**:
  - Set **Site URL** to the production Workers URL (set this after deploy in Phase 8 if URL not yet known; use a placeholder like `https://10x-cards.example.workers.dev` for now)
  - Add the production URL to **Redirect URLs** as well
  - **Edge case**: If email confirmation is enabled, confirmation links will redirect to the Site URL. If Site URL still points to localhost after deploy, users receive broken confirmation links.
- [ ] *(Optional)* Disable email confirmation for initial testing: Dashboard → Authentication → Email → toggle **Confirm email** off

> If skipping Supabase for now: the app will deploy without auth. `src/lib/supabase.ts` returns `null` when env vars are absent — auth pages render but operations silently no-op.

---

## Phase 1 — Pre-flight checks

- [ ] Verify Node version: `node -v` → should match `.nvmrc` (`v22.14.0`)
- [ ] Verify wrangler is available: `npx wrangler --version` → should be `4.x`
- [ ] Run a local build to confirm no compile errors: `npm run build`
  - **Edge case**: If the build fails with a `require is not defined` or `MessageChannel` error, both issues are now closed upstream. Check that `@astrojs/cloudflare` is on `^13.5.0` (it is) and react on `^19.2.6` (it is) — this build combination is confirmed working.

---

## Phase 2 — Cloudflare authentication

- [ ] Log in to Cloudflare: `npx wrangler login`
  - Opens browser OAuth. Tokens are stored in `~/.wrangler/config/default.toml`.
- [ ] Confirm auth: `npx wrangler whoami`
  - **Edge case**: If `whoami` returns an error or wrong account, run `npx wrangler logout` then `npx wrangler login` again.

---

## Phase 3 — Decide and set the project name

The `wrangler.jsonc` currently has `"name": "10x-astro-starter"`. This name becomes:
- The Workers subdomain: `https://10x-astro-starter.<account>.workers.dev`
- The name shown in the Cloudflare dashboard

**Action needed before first deploy:**
- [ ] Edit `wrangler.jsonc` `"name"` field to the intended production name (e.g., `"10x-cards"`)

> Once a project is deployed under a name, renaming requires deleting and re-deploying. Pick the final name now.

---

## Phase 4 — Supabase production setup

The app reads `SUPABASE_URL` and `SUPABASE_KEY` via `astro:env/server`. `src/lib/supabase.ts` gracefully returns `null` if these are absent — the app will load without auth, but sign-in/sign-up will not work.

Choose one path:

### Option A — Connect a cloud Supabase project (auth fully working)

- [ ] Create a project at [supabase.com](https://supabase.com) (free tier)
- [ ] Go to Dashboard → Settings → API → copy **Project URL** and **anon public key**
- [ ] Note them for Phase 5 (secrets wiring) — do NOT put them in `wrangler.jsonc`
- [ ] If there are schema migrations to run against the cloud DB: `npx supabase db push --db-url <cloud-db-url>`
  - **Edge case**: Local `supabase/config.toml` sets `site_url = "http://127.0.0.1:3000"`. After deploy, update it to the production Workers URL in your Supabase dashboard under Authentication → URL Configuration → Site URL. Without this, email confirmation redirects will land on localhost.

### Option B — Deploy without Supabase (auth disabled for now)

- [ ] Skip Phase 4 entirely — the app will load, auth pages will render, but operations will silently no-op
- [ ] Secrets in Phase 5 can be skipped; revisit when ready

---

## Phase 5 — Wire production secrets

Secrets must be set via `wrangler secret put` — they cannot live in `wrangler.jsonc` (that file is committed to the repo).

- [ ] `npx wrangler secret put SUPABASE_URL` → paste value when prompted
- [ ] `npx wrangler secret put SUPABASE_KEY` → paste value when prompted
- [ ] Verify both are registered: `npx wrangler secret list`
  - **Edge case**: `secret list` only shows names, not values. If you set the wrong value, re-run `wrangler secret put` for that key — it overwrites the previous value.

---

## Phase 6 — Create `.dev.vars` for local Workers dev (optional but recommended)

The `.dev.vars` file does not currently exist. Without it, `wrangler dev` will start without Supabase credentials (auth won't work locally in Workers runtime mode).

- [ ] `cp .env.example .dev.vars`
- [ ] Fill in `SUPABASE_URL` and `SUPABASE_KEY` values in `.dev.vars`
- [ ] Confirm `.dev.vars` is in `.gitignore` (it should already be — the starter template includes it)
  - **Edge case**: If `.dev.vars` is NOT in `.gitignore`, add it immediately before filling in credentials.

> Note: `npm run dev` (`astro dev`) uses Vite + Node runtime and reads `.env`. `wrangler dev` uses the actual Workers runtime and reads `.dev.vars`. Both are valid for local development — they test slightly different runtime behaviors.

---

## Phase 7 — Build and deploy

- [ ] `npm run build` — produces `dist/` (final pre-deploy check)
- [ ] `npx wrangler deploy`
  - Wrangler reads `wrangler.jsonc`, uploads `dist/` (assets binding), and deploys the Worker
  - On first run it creates the project in Cloudflare under the `name` you set in Phase 3
  - **Edge case — first deploy creates project automatically**: No manual project creation step needed. The Workers project is provisioned on first `wrangler deploy`.
  - **Edge case — assets binding `ASSETS` name conflict**: `wrangler.jsonc` uses `"binding": "ASSETS"` — this is the reserved Cloudflare Pages binding name. For Workers (our case), this is fine and intentional. Only relevant if you ever mix Pages and Workers in the same account.
  - **Edge case — `nodejs_compat` flag drift**: The `compatibility_date` in `wrangler.jsonc` is `"2026-05-08"`. If a deploy fails with an unexpected Node.js API error, check if Cloudflare changed what `nodejs_compat` enables for that date. Fix by updating `compatibility_date` deliberately to a tested date.

---

## Phase 8 — Verification

- [ ] Note the live URL printed by `wrangler deploy` (format: `https://<name>.<account>.workers.dev`)
- [ ] Open the URL in a browser — the landing page should load
- [ ] Navigate to `/auth/signup` — sign-up form should render
- [ ] Create a test account (if Supabase is connected) — confirm success redirect
- [ ] Navigate to `/dashboard` without being logged in — should redirect to `/auth/signin`
- [ ] Tail live production logs: `npx wrangler tail --format=pretty`
  - **Edge case — secrets not picked up (auth silently fails)**: If auth calls fail with no visible error, secrets may not be registered. Run `npx wrangler secret list` — both `SUPABASE_URL` and `SUPABASE_KEY` must appear. If missing, re-run `wrangler secret put` and re-deploy (`npm run build && npx wrangler deploy`). A new deployment is required for new secrets to take effect.
  - **Edge case — 30s fetch timeout**: Long LLM calls to OpenRouter (if added in the future) may hit the Workers 30-second outbound fetch hard limit. Mitigate by adding server-side input length caps before forwarding.
  - **Edge case — 10ms CPU limit on free tier**: If preprocessing text before calling an external API, keep it minimal. Free tier caps CPU time at 10ms/request; exceeding it produces opaque `1101 Worker Exceeded` errors. Upgrade to the $5/month Workers Paid plan if this becomes a constraint.

---

## Critical files to modify

| File | Change |
|---|---|
| `wrangler.jsonc` | Update `"name"` field to final production name (Phase 3) |
| `.dev.vars` | Create from `.env.example`, fill in Supabase credentials (Phase 6) |

## Files that must NOT be modified

| File | Why |
|---|---|
| `wrangler.jsonc` | Never add secret/env var values here — it's committed to the repo |
| `astro.config.mjs` | Adapter and env schema are correctly configured |
| `src/lib/supabase.ts` | Handles missing secrets gracefully — no changes needed |

## Reference commands

```bash
# Pre-flight build check
npm run build

# Cloudflare auth
npx wrangler login
npx wrangler whoami

# Secrets
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret list

# Deploy
npm run build && npx wrangler deploy

# Live log tail
npx wrangler tail --format=pretty
```
