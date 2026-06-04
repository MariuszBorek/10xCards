/**
 * Auth setup project — runs ONCE before the E2E specs (see playwright.config.ts).
 *
 * It seeds a fresh, confirmed user via the service-role admin API (reusing the
 * same `test/helpers/supabase.ts` seeding spine the integration suite uses), signs
 * that user in through the app's own endpoint, and saves the session so every spec
 * starts already authenticated — the "authenticate without the UI" rule. A fresh
 * per-run user also keeps each spec isolated: it begins with an empty collection.
 */
import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { seedUser, hasTestEnv } from "../../test/helpers/supabase";

const authFile = "tests/e2e/.auth/user.json";
const seedRecordFile = "tests/e2e/.auth/seed-user.json";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

setup("authenticate", async ({ request }) => {
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

  // Persist the authenticated session for every dependent project.
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await request.storageState({ path: authFile });

  // Record the seeded user id so the cleanup (teardown) project can delete it.
  fs.writeFileSync(seedRecordFile, JSON.stringify({ id: user.id }));
});
