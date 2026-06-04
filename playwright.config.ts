import { defineConfig, devices } from "@playwright/test";

// Playwright runs in plain Node and does NOT auto-load .env. The auth setup
// project seeds a user with the service-role key, so load the same env the
// app's dev server reads. Node 22 ships process.loadEnvFile(); tolerate a
// missing file — the setup project fails with a clear message if keys are absent.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env present; auth.setup.ts surfaces the missing-keys error explicitly
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "tests/e2e",
  // Each spec is fully isolated (own data + cleanup), so run them in parallel.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Capture a trace on a retry so a flake can be debugged without re-running.
    trace: "on-first-retry",
  },
  projects: [
    // 1) Sign in once and save the session; 2) the cleanup project deletes the
    // seeded user after everything else finishes (teardown runs last).
    { name: "setup", testMatch: /.*\.setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /.*\.teardown\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Start every test already authenticated (no UI sign-in per test).
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  // Start the app (astro dev reads .env, Node runtime) before the suite, and
  // reuse an already-running dev server locally so the loop stays fast.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
