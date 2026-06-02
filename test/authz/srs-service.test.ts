import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDueCards, reviewCard } from "@/lib/services/srs";
import {
  deleteUser,
  isSupabaseReachable,
  seedUser,
  signedInClient,
  type SeededUser,
  type TestSupabaseClient,
} from "../helpers/supabase";

// Risk #1 — endpoint authorization at the service seam. `getDueCards` and
// `reviewCard` both take a signed-in client + a userId and scope the row with
// `.eq("user_id", userId)` ON TOP of RLS. These tests prove the belt-and-
// suspenders path never crosses accounts: B, signed in as B, cannot read or
// review A's card through the service, while A can do both with their own card.
//
// Oracle: the PRD per-user isolation guardrail + the service contract
// ("scope to the passed userId; throw 'Flashcard not found' when no row
// matches"). Asserted against outcomes, never the query shape.

const reachable = await isSupabaseReachable();

// The service signatures are typed against the SSR client (NonNullable<ReturnType
// of @/lib/supabase.createClient>); the test harness builds a bare supabase-js
// client. Both are the same underlying `SupabaseClient` class, so this widening
// cast is sound and keeps the test exercising the real JWT → PostgREST path.
type ServiceClient = Parameters<typeof getDueCards>[0];

describe.skipIf(!reachable)("authz: srs service scopes to the caller (Risk #1)", () => {
  let userA: SeededUser;
  let userB: SeededUser;
  let clientA: TestSupabaseClient;
  let clientB: TestSupabaseClient;
  let aCardId: string;

  beforeAll(async () => {
    userA = await seedUser();
    userB = await seedUser();
    clientA = await signedInClient(userA.email, userA.password);
    clientB = await signedInClient(userB.email, userB.password);

    // A fresh row defaults `due = NOW()`, so A's card is immediately due.
    const { data, error } = await clientA
      .from("flashcards")
      .insert({ user_id: userA.id, word: "scoped", translation: "zakres" })
      .select()
      .single();
    if (error || !data) throw new Error(`seed A's card failed: ${error?.message ?? "no row"}`);
    aCardId = data.id;
  });

  afterAll(async () => {
    if (userA) await deleteUser(userA.id); // CASCADE drops A's flashcards
    if (userB) await deleteUser(userB.id);
  });

  it("B is authenticated as B (guards against the unauthenticated false-pass)", async () => {
    const { data, error } = await clientB.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(userB.id);
  });

  it("getDueCards as B does not include A's card", async () => {
    const due = await getDueCards(clientB as ServiceClient, userB.id);
    expect(due.map((c) => c.id)).not.toContain(aCardId);
    // B owns nothing, so the queue is empty — not merely "A's card filtered out".
    expect(due).toEqual([]);
  });

  it("reviewCard as B against A's card throws 'Flashcard not found'", async () => {
    await expect(reviewCard(clientB as ServiceClient, userB.id, aCardId, "good")).rejects.toThrow(
      "Flashcard not found",
    );
  });

  it("getDueCards as A returns A's own due card", async () => {
    const due = await getDueCards(clientA as ServiceClient, userA.id);
    expect(due.map((c) => c.id)).toContain(aCardId);
  });

  it("reviewCard as A advances A's own card", async () => {
    const updated = await reviewCard(clientA as ServiceClient, userA.id, aCardId, "good");
    expect(updated.id).toBe(aCardId);
    // A successful review increments reps from the seeded 0 — proves the write landed.
    expect(updated.reps).toBe(1);
  });
});
