---
project: 10xCards
researched_at: 2026-05-24T00:00:00Z
recommended_platform: Cloudflare Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Pages.**

The project is already wired with the `@astrojs/cloudflare` adapter, `wrangler.jsonc`, and `.dev.vars` conventions — Cloudflare Pages is the zero-friction path. It scored 5/5 across all agent-friendly criteria (CLI-first via `wrangler`, fully managed serverless runtime, llms.txt + GitHub markdown docs, deterministic `wrangler pages deploy` API, and a GA MCP server with Claude Code integration). Combined with the developer's existing Cloudflare familiarity and a generous free tier (100k requests/day, no credit card), no competing platform offers a better fit for this solo, after-hours MVP.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Pages** | Pass | Pass | Pass | Pass | Pass | **5/5** |
| **Vercel** | Pass | Pass | Pass | Partial | Pass | **4.5/5** |
| **Netlify** | Pass | Pass | Partial | Pass | Pass | **4.5/5** |
| **Railway** | Pass | Pass | Pass | Pass | Partial | **4/5** |
| **Fly.io** | Pass | Partial | Partial | Pass | Partial | **3/5** |
| **Render** | Partial | Pass | Pass | Partial | Partial | **3/5** |

### Shortlisted Platforms

#### 1. Cloudflare Pages (Recommended)

The project's `@astrojs/cloudflare` adapter, `wrangler.jsonc`, and `.dev.vars` setup are already in place — no migration cost. Free tier covers 100k requests/day with no credit card. `wrangler` is a first-class CLI that handles deploy, rollback, log tailing, and secret management without touching the dashboard. Cloudflare publishes `llms.txt` indexes at `/workers/llms.txt` and `/pages/llms.txt`, and has dedicated Claude Code integration docs at `developers.cloudflare.com/agent-setup/claude-code/`. The GA MCP server exposes Workers deployments, KV, DNS, and analytics for structured agent queries. The one friction point is an active React 19 + Cloudflare build compatibility bug (#15796) that requires monitoring.

#### 2. Vercel

Vercel scored 4.5/5 and has a mature DX story (preview URLs, instant rollbacks, `vercel rollback` CLI). Its `llms-full.txt` and GA MCP server are strong agent-tooling signals. The blocker for this project is twofold: switching from `@astrojs/cloudflare` to `@astrojs/vercel` requires a real adapter migration, and there is an active esbuild parse error on generated script chunks in Astro 6 builds (GitHub issue #16258, unfixed as of May 2026). On the Hobby free tier, rollback is limited to the immediately prior deployment and the 10-second function timeout is tight for LLM API calls.

#### 3. Netlify

Netlify scored 4.5/5 and has the most mature MCP story of the three (GA since June 2025, full Netlify API coverage including deploy + env var management). Free tier is generous at ~150k requests/month. The `@astrojs/netlify` adapter is GA and supports Astro 6 SSR. It loses to Cloudflare on zero-migration-cost and docs quality (no llms.txt in the standard GitHub-markdown format used by Cloudflare and Vercel). A good fallback if Cloudflare's React 19 build bug becomes blocking.

## Anti-Bias Cross-Check: Cloudflare Pages

### Devil's Advocate — Weaknesses

1. **React 19 build bug is active** — `@astrojs/cloudflare` + React 19 triggers a `MessageChannel ReferenceError` during builds (GitHub issue #15796, open as of May 2026). The project uses React 19 specifically. This is a real, unresolved build breakage, not a theoretical risk.
2. **10ms CPU time limit on free tier** — Workers free plan caps CPU time at 10ms per request. Any CPU-intensive step added before calling OpenRouter (text chunking, regex preprocessing on pasted input) will silently produce `1101 Worker Exceeded` errors that are notoriously hard to diagnose.
3. **Preview environment logs are not tailable** — `wrangler pages deployment tail` only works for production deployments. Debugging CI preview builds requires going to the Cloudflare dashboard UI — an agent cannot access this programmatically.
4. **Pages vs. Workers CLI confusion** — `wrangler pages deploy` and `wrangler deploy` are different commands, hit different APIs, and have different pricing tiers. Platform docs frequently conflate them; using the wrong one produces confusing, opaque failures.
5. **Outgoing fetch timeout ceiling** — Workers impose a 30-second hard timeout on outbound HTTP requests. OpenRouter LLM calls on long pasted text (full textbook paragraphs, subtitle blocks) may approach or exceed this limit. No transparent retry or streaming fallback exists at the platform level.

### Pre-Mortem — How This Could Fail

The team deployed 10xCards to Cloudflare Pages in week one. It felt obvious — the project was already wired with `@astrojs/cloudflare`, `wrangler pages deploy` just worked, and the free tier had no credit card requirement. Three months later, the project was silently broken on the main flashcard generation feature. The React 19 + Cloudflare adapter build bug (#15796) had been present at launch but only manifested after upgrading React from 19.0.0 to 19.1.x. The fix required pinning React and blocking all dependency updates for weeks. Meanwhile, real users pasting longer language-learning passages — a paragraph from a textbook, a subtitles block from a film — started hitting the 30-second outgoing fetch timeout on OpenRouter calls. This surfaced as cryptic 524 timeout errors with no stack trace in production logs. Debugging was slow because preview environment logs weren't available via CLI; every investigation required opening the Cloudflare dashboard. Finally, an innocent text-normalization step added to strip diacritics before sending to OpenRouter pushed total CPU time past the 10ms free-tier cap, causing sporadic 1101 errors on inputs of ordinary length. Each issue was fixable in isolation, but the combination — build fragility, timeout ceiling, CPU cap, poor preview observability — made the platform feel hostile for an iterative after-hours project.

### Unknown Unknowns

- **`astro:env` secrets in Cloudflare context**: The project uses `astro:env/server` for `SUPABASE_URL`/`SUPABASE_KEY`. In Cloudflare Workers, secrets must be set via `wrangler secret put` — they are not picked up from `.dev.vars` in production. A developer who sets secrets in `wrangler.jsonc` plaintext instead will silently commit credentials to the repo.
- **Free tier limit is per-account, not per-project**: The 100k requests/day free tier applies to the entire Cloudflare account. If a second Workers or Pages project shares the account, limits compound silently.
- **`nodejs_compat` flag behavior changes across runtime versions**: `wrangler.jsonc` sets `nodejs_compat`. Cloudflare periodically updates what this flag enables; breaking changes have landed silently between versions. The `compatibility_date` field in `wrangler.jsonc` pins the runtime version — if it drifts, behavior can change on the next deploy without any code change.
- **"ASSETS" is a reserved Cloudflare Pages binding name**: Accidentally naming any future binding (KV, R2, Durable Object) `ASSETS` causes deployment failure with an opaque error message.

## Operational Story

- **Preview deploys**: Every git push to a non-production branch triggers an automatic preview deployment on Cloudflare Pages with a unique URL (e.g. `abc123.10x-cards.pages.dev`). Preview URLs are public by default — protect sensitive previews with Cloudflare Access. Fork PRs from external contributors do not get preview deployments on the free tier.
- **Secrets**: Environment variables and tokens are set via `wrangler secret put <KEY>` (scoped to the specific Pages project). Secrets are encrypted at rest and never appear in `wrangler.jsonc` or logs. For local development, secrets go in `.dev.vars` (gitignored); for CI, set them as GitHub Actions secrets and pass via `wrangler pages deploy --env` or Cloudflare's GitHub integration.
- **Rollback**: `wrangler rollback [deployment-id]` reverts a Workers deployment instantly (routing layer, ~1 second). For Cloudflare Pages, use `wrangler pages deployment create` pointing to a prior build artifact, or trigger a rollback via the Cloudflare dashboard. Database migrations (Supabase) do not roll back automatically — always make schema changes backward-compatible before deploying new app code.
- **Approval**: Secrets rotation (`wrangler secret put`), project deletion, and domain configuration require a human. Routine deploys (`wrangler pages deploy`), log tailing (`wrangler pages deployment tail`), and environment variable reads can be performed by an agent unattended.
- **Logs**: Production logs: `wrangler pages deployment tail` (streaming, real-time). Preview environment logs: not available via CLI — use Cloudflare dashboard. For structured log querying, Cloudflare MCP server exposes observability tools readable by Claude Code.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| React 19 + `@astrojs/cloudflare` build breakage on upgrade | Devil's advocate | High | High | Pin React to tested version (19.0.0); add a `engines` constraint in `package.json`; monitor GitHub issue #15796 before upgrading React |
| OpenRouter LLM calls hitting 30s Workers fetch timeout on long inputs | Devil's advocate | Medium | High | Cap input length server-side before forwarding to OpenRouter; implement streaming response if supported by OpenRouter; add user-visible error for oversized inputs |
| 10ms CPU time cap causing `1101 Worker Exceeded` on added preprocessing | Devil's advocate | Medium | Medium | Keep text preprocessing minimal in the Worker (offload to the LLM prompt); upgrade to paid tier ($5/month, 30s CPU) if free tier proves too tight |
| Secrets committed to repo via `wrangler.jsonc` plaintext | Unknown unknowns | Low | Critical | Enforce `wrangler secret put` for all sensitive values; add a pre-commit hook that scans `wrangler.jsonc` for secret-shaped strings |
| Pages/Workers CLI confusion causing wrong deployment type | Devil's advocate | Low | Medium | Document the correct command in CLAUDE.md: `wrangler pages deploy ./dist` for this project; never use bare `wrangler deploy` |
| Free tier request limit exceeded due to cross-project account sharing | Unknown unknowns | Low | Medium | Keep 10xCards in a dedicated Cloudflare account or sub-account; monitor usage in dashboard |
| Preview URL exposure (sensitive data accessible publicly) | Pre-mortem | Low | Medium | Enable Cloudflare Access on preview deployments before sharing external preview URLs |
| `nodejs_compat` flag behavior drift on `compatibility_date` change | Unknown unknowns | Low | Low | Pin `compatibility_date` in `wrangler.jsonc` to a tested date; update deliberately, not automatically |

## Getting Started

1. **Authenticate with Cloudflare**: `npx wrangler login` — opens browser OAuth flow and stores credentials locally.
2. **Create the Pages project**: `npx wrangler pages project create 10x-cards --production-branch main` — links the project to your Cloudflare account.
3. **Set production secrets**: `npx wrangler secret put SUPABASE_URL --env production` and `npx wrangler secret put SUPABASE_KEY --env production` — these replace `.dev.vars` in production.
4. **Deploy**: `npm run build && npx wrangler pages deploy ./dist` — builds the Astro SSR bundle and deploys to Cloudflare Pages. The output URL is printed on success.
5. **Verify**: `npx wrangler pages deployment tail` — streams production request logs in real time to confirm the deployment is serving correctly.

> Note: `wrangler dev` already runs the workerd runtime for local development (as documented in CLAUDE.md). The dev→production parity is high — no separate local Cloudflare dev setup is needed beyond what is already in place.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions auto-deploy is available but not planned here)
- Production-scale architecture (multi-region, HA, DR)
