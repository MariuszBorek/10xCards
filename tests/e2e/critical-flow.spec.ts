/**
 * CRITICAL-FLOW E2E — the core value path, end to end in a real browser.
 *
 * Risk protected (context/foundation/test-plan.md §3 Phase 3 — the
 * paste→generate→accept→export critical flow that ties Risks #4/#1/#2 together at the
 * one layer that can prove a *real file download*):
 *   "The core value path silently breaks somewhere across auth → routing → generate
 *    (mock) → accept/persist (RLS) → export — a user pastes text, gets candidates,
 *    accepts one, and the Anki export download never produces the saved card."
 *
 * Browser-level on purpose: a real file download (the .txt the browser writes from a
 * Blob + <a download>) cannot be proven below e2e, and the path crosses every internal
 * boundary (auth cookie → SSR route → POST /api/flashcards under RLS → GET hydration →
 * GET /api/flashcards/export). Internal boundaries stay REAL; only OpenRouter is mocked
 * — via OPENROUTER_MOCK=true in .env. That mock lives server-side (src/lib/services/
 * generate.ts), so page.route() could not intercept it; it makes generation
 * deterministic — "ephemeral" is the first mock candidate.
 *
 * Conventions mirror seed.spec.ts: role-based locators, wait-for-state (never time),
 * authenticate via storageState (no UI sign-in), per-test cleanup, risk-tied name.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Dedicated per-run seeded user (auth.setup writes this storageState) so this spec
// never shares a collection with seed.spec.ts under fullyParallel — full isolation.
test.use({ storageState: "tests/e2e/.auth/critical-flow.json" });

test("paste → generate → accept → export yields a downloadable Anki file with the saved card (critical value path)", async ({
  page,
}) => {
  // The cold path compiles several SSR routes on first hit (astro dev), so give the
  // full journey headroom beyond the 30s default — these compiles are one-time per run.
  test.setTimeout(60_000);
  const sourceText = "Ein kurzer deutscher Text zum Generieren von Karteikarten.";

  // --- Setup: land on the generation page (protected route; storageState carries the session).
  await page.goto("/generate");

  const pasteBox = page.getByRole("textbox", { name: "Paste foreign language text here…" });
  const generateBtn = page.getByRole("button", { name: "Generate" });

  // Hydration gate (wait for state, not time): GenerateView is a `client:load` island
  // with no on-load fetch to anchor on, so clicking before React hydrates is silently
  // lost. `fill` can't gate hydration — it writes the DOM value directly, which sticks
  // even on the pre-hydration static node. Instead, prove the handler is wired with a
  // behavioral, network-free signal: clicking Generate while EMPTY renders React's
  // client-side validation message. Retry until it appears (the empty click is
  // idempotent — it never fires a request and never disables the button).
  await expect(async () => {
    await generateBtn.click();
    await expect(page.getByText("Please enter some text to generate flashcards.")).toBeVisible({ timeout: 1000 });
  }).toPass();

  // --- Action: paste and generate for real. The fill clears the validation message;
  // anchor on the real POST so we proceed only once candidates have come back.
  await pasteBox.fill(sourceText);
  const generated = page.waitForResponse(
    (res) => res.url().includes("/api/flashcards/generate") && res.request().method() === "POST",
  );
  await generateBtn.click();
  await generated;

  // The deterministic mock returns "ephemeral" first; exact:true binds to the word
  // node, not the "An ephemeral moment of beauty." context sentence.
  await expect(page.getByText("ephemeral", { exact: true })).toBeVisible();

  // --- Accept the first candidate. The mock is deterministic ("ephemeral" is first),
  // and persistence is re-verified by the *word* on /collection below, so this index is
  // safe. The accepted card flips to its saved state.
  await page.getByRole("button", { name: "Accept" }).first().click();
  await expect(page.getByText("✓ Saved")).toBeVisible();

  // --- Cross to the collection. Wait for its hydration GET (the list fetch in a
  // useEffect) before asserting — mirrors seed.spec.ts. The accepted row surviving an
  // SSR navigation + a fresh API/DB read proves it persisted across the RLS boundary.
  const collectionLoaded = page.waitForResponse(
    (res) => res.url().includes("/api/flashcards") && res.request().method() === "GET",
  );
  await page.goto("/collection");
  await collectionLoaded;
  await expect(page.getByText("ephemeral", { exact: true })).toBeVisible();

  // --- Export: the button enables only with ≥1 card (the accept above). Capture the
  // browser download and assert BOTH the dated filename AND that the saved word is
  // actually in the file — so a broken accept/persist/export turns this red, not merely
  // absent.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to Anki" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^anki-export-\d{4}-\d{2}-\d{2}\.txt$/);
  const contents = fs.readFileSync(await download.path(), "utf8");
  expect(contents).toContain("ephemeral");

  // --- Cleanup: remove the accepted row so the test leaves no residue (per-run-user
  // isolation → the accepted card is the only one; mirrors seed.spec.ts:78-84).
  await page.getByRole("button", { name: "Delete" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Delete flashcard?" });
  await confirmDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("ephemeral", { exact: true })).toBeHidden();
});
