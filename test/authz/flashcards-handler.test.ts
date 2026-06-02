import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/pages/api/flashcards/index";
import type { Flashcard } from "@/types";
import { makeApiContext } from "../helpers/handler";
import {
  deleteUser,
  isSupabaseReachable,
  seedUser,
  signedInClient,
  signedInCookieHeader,
  type SeededUser,
  type TestSupabaseClient,
} from "../helpers/supabase";

// Risk #1 — endpoint authorization through the REAL route handler. The list
// endpoint (`GET /api/flashcards`) carries NO app-layer user_id filter; RLS is
// its sole row-isolation backstop. This test proves the handler correctly wires
// the caller's session (from the Cookie header) into its Supabase client, so a
// session-wiring regression — which a service-level test cannot see — is caught.
//
// Oracle: the PRD isolation guardrail. Asserted on the response body's owner
// identity, never the query shape.

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)("authz: GET /api/flashcards returns only the caller's rows (Risk #1)", () => {
  let userA: SeededUser;
  let userB: SeededUser;
  let clientA: TestSupabaseClient;
  let clientB: TestSupabaseClient;
  let bCardId: string;

  beforeAll(async () => {
    userA = await seedUser();
    userB = await seedUser();
    clientA = await signedInClient(userA.email, userA.password);
    clientB = await signedInClient(userB.email, userB.password);

    const { error: aErr } = await clientA
      .from("flashcards")
      .insert({ user_id: userA.id, word: "alpha", translation: "a-owned" });
    if (aErr) throw new Error(`seed A's card failed: ${aErr.message}`);

    const { data: bRow, error: bErr } = await clientB
      .from("flashcards")
      .insert({ user_id: userB.id, word: "bravo", translation: "b-owned" })
      .select()
      .single();
    if (bErr || !bRow) throw new Error(`seed B's card failed: ${bErr?.message ?? "no row"}`);
    bCardId = bRow.id;
  });

  afterAll(async () => {
    if (userA) await deleteUser(userA.id); // CASCADE drops A's flashcards
    if (userB) await deleteUser(userB.id);
  });

  it("returns only B's rows when called with B's session cookie", async () => {
    const cookieHeader = await signedInCookieHeader(userB.email, userB.password);
    const res = await GET(makeApiContext({ cookieHeader }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { flashcards: Flashcard[] };

    // Every returned row belongs to B...
    expect(body.flashcards.length).toBeGreaterThan(0);
    expect(body.flashcards.every((c) => c.user_id === userB.id)).toBe(true);
    // ...specifically B's seeded card, and never A's.
    const ids = body.flashcards.map((c) => c.id);
    expect(ids).toContain(bCardId);
    expect(body.flashcards.some((c) => c.user_id === userA.id)).toBe(false);
  });
});
