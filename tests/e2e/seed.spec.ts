/**
 * SEED E2E TEST — the exemplar every generated E2E test in this repo is modeled on.
 *
 * What you show here is what the agent (and the next contributor) reproduces:
 * if this file uses getByRole, generated tests use getByRole; if this file had a
 * waitForTimeout, every generated test would inherit that flake. Keep it clean.
 *
 * Risk protected (context/foundation/test-plan.md §2, Risk #4 — silent data loss):
 *   "A user adds a flashcard, receives success, but the row never lands — the
 *    collection shows empty after a reload."
 * This is browser-level on purpose: it crosses auth → routing → the POST /api/flashcards
 * handler → RLS → Postgres, and back through an SSR reload + client fetch. No unit or
 * integration test can prove the *whole* chain survives a real page reload.
 *
 * The four conventions this seed demonstrates (see references/seed-test-pattern.md):
 *   1. Role-based locators   — getByRole / getByPlaceholder, never CSS or DOM structure.
 *   2. Wait for state        — expect(...).toBeVisible(), never page.waitForTimeout().
 *   3. Unique test data      — a timestamp suffix so parallel runs and re-runs never collide.
 *   4. Cleanup + risk-tied name — the test name binds to Risk #4; the row is deleted at the end.
 */
import { test, expect } from "@playwright/test";

/**
 * Authenticate WITHOUT driving the sign-in UI.
 *
 * Logging in through the form on every test is slow and makes an auth flake fail
 * unrelated tests. The Playwright convention is a one-time `setup` project that signs
 * in and writes the session to a storageState file; specs then start already logged in.
 *
 * Isolation note: this storageState should belong to a *freshly seeded, per-run user*
 * — reuse the service-role seeding helper this repo already has at
 * `test/helpers/supabase.ts` (the two-user pattern from the runner-bootstrap change).
 * A fresh user starts with an empty collection, so after we add ONE card there is
 * exactly one "Delete" button on the page and cleanup needs no fragile scoping.
 *
 * Until that setup project exists, point this at the storageState it produces:
 */
test.use({ storageState: "tests/e2e/.auth/user.json" });

test("manually added flashcard survives a page reload (Risk #4: silent data loss)", async ({ page }) => {
  // Unique per run — a timestamp suffix so concurrent workers and re-runs never collide,
  // and so our assertion below matches OUR row and nobody else's.
  const word = `seed-word-${Date.now()}`;
  const translation = "wzorcowe tłumaczenie";

  // --- Setup: land on the collection (a protected route; storageState carries the session).
  // Wait for the React island to hydrate before typing. The collection fetches its
  // list from a useEffect, which only runs AFTER hydration — so waiting for that GET
  // is a reliable "the form is now interactive" signal. Without it, fills land on the
  // pre-hydration DOM and get wiped when React mounts (state-not-time, the hard way).
  const collectionLoaded = page.waitForResponse(
    (res) => res.url().includes("/api/flashcards") && res.request().method() === "GET",
  );
  await page.goto("/collection");
  await collectionLoaded;

  // --- Action: add a flashcard through the real UI.
  // The inputs have no <label>, but their placeholder supplies the accessible name
  // (the a11y tree exposes them as textbox "Word" / "Translation"), so role-based
  // locators work and stay robust against CSS/structure changes.
  await page.getByRole("textbox", { name: "Word" }).fill(word);
  await page.getByRole("textbox", { name: "Translation" }).fill(translation);
  await page.getByRole("button", { name: "Add" }).click();

  // --- Assert (wait for STATE, not time): the new card renders. toBeVisible() retries
  // until the optimistic update lands; no sleeps, no arbitrary timeouts.
  await expect(page.getByText(word, { exact: true })).toBeVisible();

  // --- The actual risk check: does the row SURVIVE a real reload?
  // A success toast can fire while the write silently failed; only a reload — which
  // re-fetches from the API / DB — proves the data actually persisted. This is the
  // assertion that goes red the moment Risk #4 materializes.
  await page.reload();
  await expect(page.getByText(word, { exact: true })).toBeVisible();

  // --- Cleanup: remove our row so the test is repeatable and leaves no residue.
  // Relies on the per-run-user isolation above (empty collection → one Delete button).
  await page.getByRole("button", { name: "Delete" }).click();
  // The confirm lives in a dialog; scope to it so we click the dialog's Delete, not the card's.
  const confirmDialog = page.getByRole("dialog", { name: "Delete flashcard?" });
  await confirmDialog.getByRole("button", { name: "Delete" }).click();

  // Confirm the cleanup actually took effect (wait for state, not time).
  await expect(page.getByText(word, { exact: true })).toBeHidden();
});
