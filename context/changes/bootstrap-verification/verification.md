---
bootstrapped_at: 2026-05-22T18:51:00Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: 10x-cards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-cards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**Why this stack**: 10xCards is a solo-built, after-hours language-learning flashcard app with a 3-week MVP window. The PRD requires email+password auth and AI-generated flashcard candidates from pasted text on day 1. The 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind + Supabase + Cloudflare Pages) clears all four agent-friendly quality gates: typed (TypeScript project-wide), convention-based (opinionated layout and routing), popular in training data, and well-documented. Supabase ships auth and PostgreSQL with a TypeScript SDK, covering `has_auth` and flashcard persistence without extra integration work. AI generation runs through an Astro API route calling the LLM SDK — no additional framework needed. Cloudflare Pages edge deploy is free-tier-friendly and matches the small-scale, low-QPS profile in the PRD. GitHub Actions with auto-deploy-on-merge suits the solo shipping cadence. Bootstrapper confidence is first-class.

## Pre-scaffold verification

| Signal      | Value                                          | Severity | Notes                                                            |
| ----------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------- |
| npm package | not run                                        | n/a      | cmd_template starts with `git clone`; npm check skipped         |
| GitHub repo | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh    | from card.docs_url; checked via GitHub API (gh CLI not available; used curl fallback) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install --cache /tmp/npm-cache-10xcards`

**Strategy**: git-clone (cloned starter repo without keeping its git history)

**Exit code**: 0 (npm install initially failed with EACCES on system npm cache owned by root; resolved by using a temp cache directory `/tmp/npm-cache-10xcards`)

**Files moved**: all scaffold files moved to cwd (node_modules, src/, public/, supabase/, astro.config.mjs, components.json, tsconfig.json, wrangler.jsonc, eslint.config.js, package.json, package-lock.json, .env.example, .github/, .husky/, .nvmrc, .prettierrc.json, .vscode/)

**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`, `README.md.scaffold`

**.gitignore handling**: append-merged — 4 lines added from starter not already present in cwd: `.astro/`, `.env.production`, `.dev.vars`, `.wrangler/`

**.bootstrap-scaffold cleanup**: deleted

**Note on npm cache**: `/Users/mariuszborek/.npm/_cacache/content-v2/sha512/c2/80` was owned by root from a prior `sudo npm install`. Used `--cache /tmp/npm-cache-10xcards` as a workaround. Recommend running `sudo chown -R $USER ~/.npm` to restore normal npm cache ownership.

## Post-scaffold audit

**Tool**: `npm audit --json`

**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW

**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (direct packages: `@astrojs/check` moderate, `wrangler` moderate)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (range 5.6.3–5.8.0) — GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization" (CVSS 7.5, CWE-770). Transitive — not a direct dependency. Fix available.

#### MODERATE findings

- **@astrojs/check** (>=0.9.3) — via `@astrojs/language-server`. Direct dependency. Fix: downgrade to `@astrojs/check@0.9.2` (semver major).
- **@astrojs/language-server** (>=2.14.0) — via `volar-service-yaml`. Transitive. Fix available (via `@astrojs/check@0.9.2`).
- **@cloudflare/vite-plugin** — via `miniflare`, `wrangler`, `ws`. Transitive. Fix available.
- **miniflare** — via `ws`. Transitive. Fix available.
- **volar-service-yaml** (<=0.0.70) — via `yaml-language-server`. Transitive. Fix available (via `@astrojs/check@0.9.2`).
- **wrangler** — via `miniflare`. Direct dependency. Fix available.
- **ws** (8.0.0–8.20.0) — GHSA-58qx-3vcg-4xpx — "Uninitialized memory disclosure" (CVSS 4.4, CWE-908). Transitive (in both `@supabase/realtime-js/node_modules/ws` and `node_modules/ws`). Fix available.
- **yaml** (2.0.0–2.8.2) — GHSA-48c2-rrv3-qjmp — "Stack Overflow via deeply nested YAML collections" (CVSS 4.3, CWE-674). Transitive. Fix available (via `@astrojs/check@0.9.2`).
- **yaml-language-server** — via `yaml`. Transitive. Fix available (via `@astrojs/check@0.9.2`).

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

These hints are carried forward for the future M1L4 skill ("Memory Architecture") to act on. In particular: `has_auth: true`, `has_ai: true`, `deployment_target: cloudflare-pages`, and `ci_provider: github-actions` will drive CLAUDE.md/AGENTS.md content generation in that skill.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review `CLAUDE.md.scaffold` and `README.md.scaffold` — diff them against your existing `CLAUDE.md` and `README.md` and merge anything useful.
- Copy `.env.example` to `.env` (for Node local dev) or `.dev.vars` (for Cloudflare local dev) and fill in `SUPABASE_URL` and `SUPABASE_KEY`.
- Run `npx supabase start` (requires Docker) to spin up local Supabase.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
- Fix npm cache ownership: `sudo chown -R $USER ~/.npm`
