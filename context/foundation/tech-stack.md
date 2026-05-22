---
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
---

## Why this stack

10xCards is a solo-built, after-hours language-learning flashcard app with a 3-week MVP window. The PRD requires email+password auth and AI-generated flashcard candidates from pasted text on day 1. The 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind + Supabase + Cloudflare Pages) clears all four agent-friendly quality gates: typed (TypeScript project-wide), convention-based (opinionated layout and routing), popular in training data, and well-documented. Supabase ships auth and PostgreSQL with a TypeScript SDK, covering `has_auth` and flashcard persistence without extra integration work. AI generation runs through an Astro API route calling the LLM SDK — no additional framework needed. Cloudflare Pages edge deploy is free-tier-friendly and matches the small-scale, low-QPS profile in the PRD. GitHub Actions with auto-deploy-on-merge suits the solo shipping cadence. Bootstrapper confidence is first-class.
