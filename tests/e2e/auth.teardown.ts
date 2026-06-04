/**
 * Cleanup project — runs LAST (it is the `setup` project's teardown).
 *
 * Deletes every user the auth setup seeded so auth.users does not accumulate across
 * runs (deleting a user CASCADE-drops their flashcards too). Mirrors the afterAll
 * teardown the integration suite uses. One record file per seeded user.
 */
import { test as teardown } from "@playwright/test";
import fs from "node:fs";
import { deleteUser } from "../../test/helpers/supabase";

const seedRecordFiles = ["tests/e2e/.auth/seed-user.json", "tests/e2e/.auth/seed-user-critical-flow.json"];

teardown("delete seeded users", async () => {
  for (const seedRecordFile of seedRecordFiles) {
    if (!fs.existsSync(seedRecordFile)) continue;
    const { id } = JSON.parse(fs.readFileSync(seedRecordFile, "utf8")) as { id: string };
    await deleteUser(id);
    fs.rmSync(seedRecordFile, { force: true });
  }
});
