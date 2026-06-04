// CI fail-fast guard against the "green-but-hollow" trap.
//
// The integration suites use `describe.skipIf(!(await isSupabaseReachable()))`,
// so a missing/blank Supabase env makes the entire authorization/RLS/persistence
// spine SKIP and `vitest run` still exits 0. That is correct for local dev (no
// Supabase, no Docker) but catastrophic in CI: a dropped secret would turn a
// security regression into a green build.
//
// This guard runs ONLY under CI (process.env.CI). When CI is set and the test
// env is incomplete, it exits non-zero with a message naming the missing vars,
// before any suite runs. Local dev (no CI) is untouched — it returns 0 so the
// skip-on-missing-env behaviour keeps working.
//
// Run via Node's built-in type stripping (no tsx dependency):
//   node --experimental-strip-types test/ci-guard.ts

import { hasTestEnv } from "./helpers/supabase.ts";

if (!process.env.CI) {
  // Local dev: nothing to enforce. Suites skip cleanly when env is absent.
  process.exit(0);
}

if (hasTestEnv()) {
  console.log("[ci-guard] Supabase test env present — integration suites will run.");
  process.exit(0);
}

const required = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((name) => !process.env[name]);

console.error(
  "[ci-guard] FAIL: running under CI but the Supabase test env is incomplete.\n" +
    `[ci-guard] Missing/blank: ${missing.join(", ")}\n` +
    "[ci-guard] The integration suites would SKIP and the job would pass while testing nothing.\n" +
    "[ci-guard] Ensure `supabase start` ran and .env was written with all three keys before `npm test`.",
);
process.exit(1);
