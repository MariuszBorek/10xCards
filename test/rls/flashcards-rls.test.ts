import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteUser,
  isSupabaseReachable,
  seedUser,
  signedInClient,
  type SeededUser,
  type TestSupabaseClient,
} from "../helpers/supabase";

// Risk #2 — RLS backstop. The four `flashcards` policies (select_own,
// insert_own, update_own, delete_own; all `auth.uid() = user_id`) are the SOLE
// isolation layer for the list/update/delete/export endpoints, which carry no
// app-layer user_id filter. These tests exercise the policies through the real
// JWT → PostgREST → auth.uid() path with B's signed-in client, asserting the
// observable OUTCOME (no rows / no mutation) derived from the policy + the PRD
// isolation guardrail — never the handler query shape.
//
// The defining hazard: an *unauthenticated* anon client also sees zero rows
// (no auth.uid()), so "B sees nothing" is a false pass unless B is proven
// signed in. Every denial assertion is therefore paired with a check that B's
// session is authenticated as B.

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)("RLS: flashcards cross-account isolation (Risk #2)", () => {
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

    // Seed A's row through A's own signed-in client — this also proves the
    // insert_own positive path (A may insert a row owned by A).
    const { data, error } = await clientA
      .from("flashcards")
      .insert({ user_id: userA.id, word: "secret", translation: "tajne" })
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

  it("select_own: B cannot SELECT A's row", async () => {
    const { data, error } = await clientB.from("flashcards").select("*").eq("id", aCardId);
    // SELECT under RLS is filtered, not errored: B simply sees zero rows.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("update_own: B cannot UPDATE A's row (A's data is unchanged)", async () => {
    const { data, error } = await clientB.from("flashcards").update({ word: "hacked" }).eq("id", aCardId).select();
    // UPDATE matches zero rows under RLS — no error, empty returned set.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // A re-reads its own row: the word must still be the original value.
    const { data: aRow } = await clientA.from("flashcards").select("word").eq("id", aCardId).single();
    expect(aRow?.word).toBe("secret");
  });

  it("delete_own: B cannot DELETE A's row (A's row still present)", async () => {
    const { data, error } = await clientB.from("flashcards").delete().eq("id", aCardId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // A re-reads: the row must still exist.
    const { data: aRow } = await clientA.from("flashcards").select("id").eq("id", aCardId).single();
    expect(aRow?.id).toBe(aCardId);
  });

  it("insert_own: B cannot INSERT a row owned by A (WITH CHECK rejects)", async () => {
    const { data, error } = await clientB
      .from("flashcards")
      .insert({ user_id: userA.id, word: "forged", translation: "podrobione" })
      .select();
    // WITH CHECK violation is a hard error (RLS code 42501), not a silent skip.
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // And nothing was written under A's account.
    const { data: aRows } = await clientA.from("flashcards").select("id").eq("word", "forged");
    expect(aRows).toEqual([]);
  });
});
