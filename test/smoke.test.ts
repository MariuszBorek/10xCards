import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteUser, isSupabaseReachable, seedUser, signedInClient, type SeededUser } from "./helpers/supabase";

// Top-level await is supported in Vitest ESM test files; resolve the gate once
// so the whole suite skips cleanly when local Supabase is down.
const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)("smoke: seeding harness round-trips a flashcard", () => {
  let userA: SeededUser;

  beforeAll(async () => {
    userA = await seedUser();
  });

  afterAll(async () => {
    if (userA) await deleteUser(userA.id);
  });

  it("seeds a user, signs in, and round-trips one flashcard row", async () => {
    const client = await signedInClient(userA.email, userA.password);

    const { data: inserted, error: insertError } = await client
      .from("flashcards")
      .insert({ user_id: userA.id, word: "smoke", translation: "test" })
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(inserted).toMatchObject({ user_id: userA.id, word: "smoke", translation: "test" });

    const { data: fetched, error: selectError } = await client.from("flashcards").select("*").eq("id", inserted!.id);

    expect(selectError).toBeNull();
    expect(fetched).toHaveLength(1);
    expect(fetched![0]).toMatchObject({ id: inserted!.id, user_id: userA.id });
  });
});
