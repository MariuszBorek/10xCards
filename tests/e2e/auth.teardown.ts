/**
 * Cleanup project — runs LAST (it is the `setup` project's teardown).
 *
 * Deletes the user the auth setup seeded so auth.users does not accumulate across
 * runs (deleting the user CASCADE-drops their flashcards too). Mirrors the
 * afterAll teardown the integration suite uses.
 */
import { test as teardown } from "@playwright/test";
import fs from "node:fs";
import { deleteUser } from "../../test/helpers/supabase";

const seedRecordFile = "tests/e2e/.auth/seed-user.json";

teardown("delete seeded user", async () => {
  if (!fs.existsSync(seedRecordFile)) return;
  const { id } = JSON.parse(fs.readFileSync(seedRecordFile, "utf8")) as { id: string };
  await deleteUser(id);
  fs.rmSync(seedRecordFile, { force: true });
});
