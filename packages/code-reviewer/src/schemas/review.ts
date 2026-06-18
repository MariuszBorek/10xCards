import { z } from "zod";

/**
 * A 1–10 integer score for a single review criterion. 1 is the worst outcome,
 * 10 is the best. The `.describe()` anchors travel with the schema so the
 * structured-output call sees each criterion's scale.
 */
const score = (anchors: string) => z.number().int().min(1).max(10).describe(anchors);

/**
 * The seven scored criteria from `requirements.md:16-42`. Each is an integer
 * 1–10 with its 1/10-vs-10/10 anchors inlined for the model.
 */
export const ReviewScoresSchema = z.object({
  correctness: score(
    "Does the diff do what its title/description claim, without logic errors or regressions? " +
      "1 = obvious bugs, broken logic, or behavior contradicting stated intent; " +
      "10 = logically sound, fully delivers its purpose, no detectable regressions.",
  ),
  security: score(
    "Does the change avoid vulnerabilities (injection, missing authz/RLS, leaked secrets, unsafe input)? " +
      "1 = introduces an exploitable flaw or exposes sensitive data; " +
      "10 = no new attack surface, inputs validated, secrets and access controls handled correctly.",
  ),
  errorHandling: score(
    "Are failure paths, empty/boundary inputs, and unexpected states handled gracefully? " +
      "1 = happy-path only, swallows or ignores errors, crashes on edge cases; " +
      "10 = failure modes caught and surfaced meaningfully, edge cases covered.",
  ),
  readability: score(
    "Is the code clear, well-named, and easy for the next developer to change? " +
      "1 = cryptic naming, tangled control flow, duplicated or dead code; " +
      "10 = self-explanatory, well-structured, easy to extend or modify safely.",
  ),
  testCoverage: score(
    "Is the change accompanied by tests proportionate to its risk and complexity? " +
      "1 = risky logic shipped with no tests; " +
      "10 = meaningful tests covering the new behavior and its important edge cases.",
  ),
  performance: score(
    "Does the change avoid needless work, inefficient algorithms, or resource leaks for its context? " +
      "1 = clear performance regressions, N+1 patterns, or unbounded resource use; " +
      "10 = efficient for the expected workload with no wasteful operations.",
  ),
  consistency: score(
    "Does the diff follow the project's established patterns, style, and idioms? " +
      "1 = ignores existing conventions, mixes styles, reinvents existing helpers; " +
      "10 = blends in seamlessly with the codebase's established patterns.",
  ),
});
export type ReviewScores = z.infer<typeof ReviewScoresSchema>;

/** The full structured result of a code review. */
export const ReviewSchema = z.object({
  scores: ReviewScoresSchema.describe("Integer 1–10 score for each of the seven criteria."),
  summary: z.string().describe("A 1-3 sentence overall assessment referencing the most important scores."),
  verdict: z
    .enum(["passed", "failed"])
    .describe('Set to "failed" if any of the seven criterion scores is below 5, otherwise "passed".'),
});
export type Review = z.infer<typeof ReviewSchema>;
