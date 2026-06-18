import { describe, expect, it } from "vitest";
import { ReviewSchema, type ReviewScores } from "@10xcards/code-reviewer";

// Contract (a): the structured-output schema the workflow depends on. The
// reviewer reads no Astro/Supabase env, so these are pure, offline assertions —
// no `astro:env/server` mock or Supabase gate needed.

/** A complete, in-range set of the seven criterion scores. */
const validScores: ReviewScores = {
  correctness: 8,
  security: 7,
  errorHandling: 6,
  readability: 9,
  testCoverage: 5,
  performance: 8,
  consistency: 9,
};

describe("ReviewSchema: structured-output contract", () => {
  it("accepts a valid 7-score + summary + verdict object", () => {
    const result = ReviewSchema.safeParse({
      scores: validScores,
      summary: "Solid change with adequate coverage.",
      verdict: "passed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a score above the 1–10 range", () => {
    const result = ReviewSchema.safeParse({
      scores: { ...validScores, correctness: 11 },
      summary: "out of range",
      verdict: "passed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a score below the 1–10 range", () => {
    const result = ReviewSchema.safeParse({
      scores: { ...validScores, security: 0 },
      summary: "out of range",
      verdict: "failed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer score", () => {
    const result = ReviewSchema.safeParse({
      scores: { ...validScores, readability: 7.5 },
      summary: "fractional",
      verdict: "passed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an object missing one of the seven scores", () => {
    const { consistency: _consistency, ...missingOne } = validScores;
    const result = ReviewSchema.safeParse({
      scores: missingOne,
      summary: "missing a criterion",
      verdict: "passed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a verdict outside the passed/failed enum", () => {
    const result = ReviewSchema.safeParse({
      scores: validScores,
      summary: "bad verdict",
      verdict: "maybe",
    });
    expect(result.success).toBe(false);
  });
});
