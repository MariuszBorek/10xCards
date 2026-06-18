import type { Review, ReviewScores } from "../schemas/review.ts";

/**
 * Deterministic offline review fixture used when `OPENROUTER_MOCK=true`.
 *
 * Lets the CLI run end-to-end with no API key (CI smoke tests, local dev). The
 * outcome is a pure function of the diff so both the passed and failed branches
 * are reproducible: a diff containing {@link MOCK_FAIL_MARKER} yields a failing
 * review, anything else yields a passing one.
 */

/** Sentinel string in a diff that makes {@link buildMockReview} return a failing review. */
export const MOCK_FAIL_MARKER = "FAIL_MARKER";

/** All-passing canned scores (every criterion ≥ 5). */
const PASS_SCORES: ReviewScores = {
  correctness: 9,
  security: 9,
  errorHandling: 8,
  readability: 9,
  testCoverage: 8,
  performance: 9,
  consistency: 9,
};

/** Failing canned scores — correctness drops below the min-threshold. */
const FAIL_SCORES: ReviewScores = {
  ...PASS_SCORES,
  correctness: 2,
  errorHandling: 3,
};

/**
 * Build a deterministic, schema-valid {@link Review} from a diff without any
 * network/API call. Used by the mock review path.
 */
export function buildMockReview(diff: string): Review {
  const failing = diff.includes(MOCK_FAIL_MARKER);
  return failing
    ? {
        scores: FAIL_SCORES,
        summary: `Mock review: detected ${MOCK_FAIL_MARKER} in the diff — correctness and error handling fall below the threshold.`,
        verdict: "failed",
      }
    : {
        scores: PASS_SCORES,
        summary: "Mock review: no blocking issues detected; all criteria meet the threshold.",
        verdict: "passed",
      };
}
