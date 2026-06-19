import { z } from "zod";

/** Lowest / highest valid criterion score (inclusive). */
export const MIN_SCORE = 1;
export const MAX_SCORE = 10;

/**
 * The seven scored criteria and their 1/10-vs-10/10 anchors (from
 * `requirements.md:16-42`), defined once so the strict validation schema and the
 * provider-safe wire schema can never drift apart.
 */
const CRITERION_ANCHORS = {
  correctness:
    "Does the diff do what its title/description claim, without logic errors or regressions? " +
    "1 = obvious bugs, broken logic, or behavior contradicting stated intent; " +
    "10 = logically sound, fully delivers its purpose, no detectable regressions.",
  security:
    "Does the change avoid vulnerabilities (injection, missing authz/RLS, leaked secrets, unsafe input)? " +
    "1 = introduces an exploitable flaw or exposes sensitive data; " +
    "10 = no new attack surface, inputs validated, secrets and access controls handled correctly.",
  errorHandling:
    "Are failure paths, empty/boundary inputs, and unexpected states handled gracefully? " +
    "1 = happy-path only, swallows or ignores errors, crashes on edge cases; " +
    "10 = failure modes caught and surfaced meaningfully, edge cases covered.",
  readability:
    "Is the code clear, well-named, and easy for the next developer to change? " +
    "1 = cryptic naming, tangled control flow, duplicated or dead code; " +
    "10 = self-explanatory, well-structured, easy to extend or modify safely.",
  testCoverage:
    "Is the change accompanied by tests proportionate to its risk and complexity? " +
    "1 = risky logic shipped with no tests; " +
    "10 = meaningful tests covering the new behavior and its important edge cases.",
  performance:
    "Does the change avoid needless work, inefficient algorithms, or resource leaks for its context? " +
    "1 = clear performance regressions, N+1 patterns, or unbounded resource use; " +
    "10 = efficient for the expected workload with no wasteful operations.",
  consistency:
    "Does the diff follow the project's established patterns, style, and idioms? " +
    "1 = ignores existing conventions, mixes styles, reinvents existing helpers; " +
    "10 = blends in seamlessly with the codebase's established patterns.",
} as const;

/** The seven criterion keys, in rubric order. */
export const CRITERIA = Object.keys(CRITERION_ANCHORS) as (keyof typeof CRITERION_ANCHORS)[];

/**
 * Assemble the seven-criterion scores object from a per-criterion score factory,
 * so the strict and wire schemas share one definition and stay in lockstep.
 */
function buildScores(score: (anchors: string) => z.ZodNumber) {
  return z.object({
    correctness: score(CRITERION_ANCHORS.correctness),
    security: score(CRITERION_ANCHORS.security),
    errorHandling: score(CRITERION_ANCHORS.errorHandling),
    readability: score(CRITERION_ANCHORS.readability),
    testCoverage: score(CRITERION_ANCHORS.testCoverage),
    performance: score(CRITERION_ANCHORS.performance),
    consistency: score(CRITERION_ANCHORS.consistency),
  });
}

/**
 * The seven scored criteria as a strict 1–10 integer contract. 1 is the worst
 * outcome, 10 is the best. This is the public validator: it rejects fractional
 * and out-of-range values (see `review-schema.test.ts`).
 */
export const ReviewScoresSchema = buildScores((anchors) =>
  z.number().int().min(MIN_SCORE).max(MAX_SCORE).describe(anchors),
);
export type ReviewScores = z.infer<typeof ReviewScoresSchema>;

/**
 * Provider-safe wire variant of {@link ReviewScoresSchema}: plain `number`
 * scores with NO JSON-Schema bounds at all. This must stay `z.number()` and not
 * `z.number().int()`: Zod 4 renders `.int()` as `{"type":"integer", "minimum":
 * -9007199254740991, "maximum": 9007199254740991}` — it auto-attaches the
 * safe-integer `minimum`/`maximum`. Anthropic's structured outputs reject ANY
 * `minimum`/`maximum` on a numeric type ("output_config.format.schema: For
 * 'integer' type, properties maximum, minimum are not supported") and fail the
 * whole call, which broke every review made with the default claude model.
 * A bare `number` emits `{"type":"number"}` with no bounds. The 1–10 integer
 * range is conveyed via each criterion's description and enforced afterwards:
 * {@link clampScores} rounds + clamps the model's output and {@link ReviewSchema}
 * strict-validates it, so a fractional or out-of-range score never escapes.
 */
const ReviewWireScoresSchema = buildScores((anchors) => z.number().describe(anchors));

const SCORES_DESCRIPTION = "Integer 1–10 score for each of the seven criteria.";
const SUMMARY_DESCRIPTION = "A 1-3 sentence overall assessment referencing the most important scores.";
const VERDICT_DESCRIPTION = 'Set to "failed" if any of the seven criterion scores is below 5, otherwise "passed".';

/** The full structured result of a code review — the strict validation contract. */
export const ReviewSchema = z.object({
  scores: ReviewScoresSchema.describe(SCORES_DESCRIPTION),
  summary: z.string().describe(SUMMARY_DESCRIPTION),
  verdict: z.enum(["passed", "failed"]).describe(VERDICT_DESCRIPTION),
});
export type Review = z.infer<typeof ReviewSchema>;

/**
 * Provider-safe variant of {@link ReviewSchema} sent to the structured-output
 * call: identical shape and descriptions, but with no numeric bounds on the
 * scores (see {@link ReviewWireScoresSchema}). Always pair with
 * {@link clampScores} + a strict {@link ReviewSchema} parse on the result.
 */
export const ReviewWireSchema = z.object({
  scores: ReviewWireScoresSchema.describe(SCORES_DESCRIPTION),
  summary: z.string().describe(SUMMARY_DESCRIPTION),
  verdict: z.enum(["passed", "failed"]).describe(VERDICT_DESCRIPTION),
});

/**
 * Clamp every criterion score into the valid integer `[MIN_SCORE, MAX_SCORE]`
 * range, rounding fractional values. Applied to wire-schema output (which omits
 * numeric bounds) so a model returning e.g. 0 or 11 still yields a contract-valid
 * {@link ReviewScores} instead of failing the whole review.
 */
export function clampScores(scores: ReviewScores): ReviewScores {
  const clamp = (n: number) => Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(n)));
  return {
    correctness: clamp(scores.correctness),
    security: clamp(scores.security),
    errorHandling: clamp(scores.errorHandling),
    readability: clamp(scores.readability),
    testCoverage: clamp(scores.testCoverage),
    performance: clamp(scores.performance),
    consistency: clamp(scores.consistency),
  };
}
