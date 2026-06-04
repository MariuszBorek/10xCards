import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/pages/api/flashcards/index";
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

// Risk #4 — accepting candidates must never silently lose rows. Two proofs,
// both through the REAL create+list handlers / the real DB, never a mocked
// client (test-plan §6.4):
//
//  1. Round-trip: POST N distinct candidates through `POST /api/flashcards`
//     with B's session, then GET through `GET /api/flashcards`, and assert
//     EXACTLY those N come back for B and NONE of A's leak in. Asserted on the
//     response body's contents and owner identity, never the query shape
//     (lessons.md: assert the cross-account outcome, not the code path).
//
//  2. Forced write-rejection: an illegitimate insert (mismatched user_id) is
//     rejected by RLS `WITH CHECK`, i.e. a bad write does NOT succeed silently.
//     This is the failure the handler's `if (error) return 500` translates.

const reachable = await isSupabaseReachable();

const CANDIDATES = [
  { word: "hund", translation: "dog", context: "Der Hund läuft." },
  { word: "katze", translation: "cat", context: "Die Katze schläft." },
  { word: "vogel", translation: "bird", context: null },
] as const;

describe.skipIf(!reachable)("persistence: create+list round-trip never loses rows (Risk #4)", () => {
  let userA: SeededUser;
  let userB: SeededUser;
  let clientB: TestSupabaseClient;
  let cookieHeaderB: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    userA = await seedUser();
    userB = await seedUser();
    clientB = await signedInClient(userB.email, userB.password);
    cookieHeaderB = await signedInCookieHeader(userB.email, userB.password);

    // A owns one card that must NEVER appear in B's list (cross-account guard).
    const clientA = await signedInClient(userA.email, userA.password);
    const { error: aErr } = await clientA
      .from("flashcards")
      .insert({ user_id: userA.id, word: "alpha", translation: "a-owned" });
    if (aErr) throw new Error(`seed A's card failed: ${aErr.message}`);
  });

  afterAll(async () => {
    if (userA) await deleteUser(userA.id); // CASCADE drops A's flashcards
    if (userB) await deleteUser(userB.id);
  });

  it("returns exactly the N accepted candidates for the owner, none for the other user", async () => {
    // Accept each candidate through the REAL create handler with B's session.
    for (const candidate of CANDIDATES) {
      const res = await POST(makeApiContext({ cookieHeader: cookieHeaderB, method: "POST", body: candidate }));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { flashcard: Flashcard };
      expect(body.flashcard.user_id).toBe(userB.id);
      expect(body.flashcard.word).toBe(candidate.word);
      createdIds.push(body.flashcard.id);
    }
    expect(createdIds).toHaveLength(CANDIDATES.length);

    // Reload the collection through the REAL list handler with B's session.
    const listRes = await GET(makeApiContext({ cookieHeader: cookieHeaderB }));
    expect(listRes.status).toBe(200);
    const { flashcards } = (await listRes.json()) as { flashcards: Flashcard[] };

    // Exactly the N created come back — membership, not mere non-emptiness.
    expect(flashcards).toHaveLength(CANDIDATES.length);
    const returnedWords = flashcards.map((c) => c.word).sort();
    expect(returnedWords).toEqual(CANDIDATES.map((c) => c.word).sort());
    const returnedIds = flashcards.map((c) => c.id).sort();
    expect(returnedIds).toEqual([...createdIds].sort());

    // Every row is B's; A's "alpha" never leaks in (owner scoping).
    expect(flashcards.every((c) => c.user_id === userB.id)).toBe(true);
    expect(flashcards.some((c) => c.word === "alpha")).toBe(false);
  });

  it("rejects an illegitimate write (mismatched user_id) instead of accepting it silently", async () => {
    // Forcing function: zod (word/translation min(1)) + the handler's fixed
    // `user_id: user.id` close every handler-reachable constraint, so a 500 is
    // not cleanly trippable through the real route without mocking the client
    // (which §6.4 forbids). The handler's error→500 TRANSLATION is therefore
    // covered by code inspection + the success round-trip above; the REJECTION
    // ITSELF — the write failing rather than landing — is proven here at the
    // real DB via the RLS `WITH CHECK (auth.uid() = user_id)` policy.
    const { data, error } = await clientB
      .from("flashcards")
      .insert({ user_id: userA.id, word: "smuggled", translation: "should-not-land" })
      .select();

    // The bad write must NOT succeed silently: an error is surfaced and no row
    // is returned. (A silent 2xx-on-failure is exactly what Risk #4 forbids.)
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
