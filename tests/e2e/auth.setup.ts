/**
 * Auth setup project — runs ONCE before the E2E specs (see playwright.config.ts).
 *
 * It seeds fresh, confirmed users via the service-role admin API (reusing the same
 * `test/helpers/supabase.ts` seeding spine the integration suite uses), signs each in
 * through the app's own endpoint, and saves the session so every spec starts already
 * authenticated — the "authenticate without the UI" rule.
 *
 * One seeded user PER SPEC that mutates the shared collection. Specs run fullyParallel,
 * so two specs sharing one user would see each other's rows in the same collection
 * (e.g. two "Delete" buttons → a strict-mode flake). A dedicated user per spec keeps
 * each one starting from an empty collection and fully independent.
 */
import { test as setup, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { seedUser, hasTestEnv } from "../../test/helpers/supabase";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

async function seedAndPersistSession(request: APIRequestContext, authFile: string, seedRecordFile: string) {
  if (!hasTestEnv()) {
    throw new Error(
      "E2E auth setup needs SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY. " +
        "Run `npx supabase start` and copy the keys into .env (see .env.example).",
    );
  }

  // Seed a confirmed user with a per-run-unique email (admin API).
  const user = await seedUser();

  // Sign in through POST /api/auth/signin. It reads FORM data and 302-redirects
  // to "/" on success, or to "/auth/signin?error=..." on failure — so we assert
  // the redirect target, not just the status. maxRedirects:0 keeps the Set-Cookie
  // session on this single response for storageState to capture.
  const res = await request.post("/api/auth/signin", {
    form: { email: user.email, password: user.password },
    // Astro's CSRF protection (security.checkOrigin, on by default for SSR)
    // rejects form POSTs whose Origin doesn't match the host — a real browser
    // form submission sends this, so we must too.
    headers: { Origin: BASE_URL },
    maxRedirects: 0,
  });
  expect(res.status(), "sign-in should respond with a redirect").toBe(302);
  expect(res.headers().location, "successful sign-in redirects to /").toBe("/");

  // Persist the authenticated session for the dependent specs.
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await request.storageState({ path: authFile });

  // Record the seeded user id so the cleanup (teardown) project can delete it.
  fs.writeFileSync(seedRecordFile, JSON.stringify({ id: user.id }));
}

// Default session — used by seed.spec.ts (and any spec that doesn't override storageState).
setup("authenticate", async ({ request }) => {
  await seedAndPersistSession(request, "tests/e2e/.auth/user.json", "tests/e2e/.auth/seed-user.json");
});

// Dedicated session for the critical-flow spec, so it never shares a collection with seed.spec.ts.
setup("authenticate critical-flow user", async ({ request }) => {
  await seedAndPersistSession(
    request,
    "tests/e2e/.auth/critical-flow.json",
    "tests/e2e/.auth/seed-user-critical-flow.json",
  );
});
