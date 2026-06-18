import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ReviewSchema,
  ReviewWireSchema,
  clampScores,
  MIN_SCORE,
  MAX_SCORE,
  type ReviewScores,
} from "@10xcards/code-reviewer";

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

// Contract (b): the provider-safe wire schema actually sent to the LLM. It must
// carry NO numeric `minimum`/`maximum` (some OpenRouter providers — e.g. Azure
// OpenAI strict structured outputs — reject those keywords and fail the call),
// while the range is restored by `clampScores` + a strict `ReviewSchema` parse.

describe("ReviewWireSchema: provider-safe structured-output contract", () => {
  it("emits no minimum/maximum on the score integers, but the strict schema does", () => {
    const wire = JSON.stringify(z.toJSONSchema(ReviewWireSchema));
    const strict = JSON.stringify(z.toJSONSchema(ReviewSchema));

    expect(wire).not.toContain("minimum");
    expect(wire).not.toContain("maximum");
    // Sanity: the strict validator keeps its bounds (it's the regression's mirror).
    expect(strict).toContain("minimum");
    expect(strict).toContain("maximum");
  });

  it("still requires all seven integer scores", () => {
    expect(ReviewWireSchema.safeParse({ scores: validScores, summary: "ok", verdict: "passed" }).success).toBe(true);
    const { consistency: _consistency, ...missingOne } = validScores;
    expect(ReviewWireSchema.safeParse({ scores: missingOne, summary: "missing", verdict: "passed" }).success).toBe(
      false,
    );
  });

  it("accepts out-of-range scores the strict schema would reject", () => {
    // This is the whole point: the wire schema must not bounce 0/11 (so the
    // provider call succeeds); range enforcement moves to clampScores.
    const result = ReviewWireSchema.safeParse({
      scores: { ...validScores, correctness: 11, security: 0 },
      summary: "out of range, accepted on the wire",
      verdict: "passed",
    });
    expect(result.success).toBe(true);
  });
});

describe("clampScores", () => {
  it("clamps below-range and above-range scores into [MIN_SCORE, MAX_SCORE]", () => {
    const clamped = clampScores({ ...validScores, correctness: 11, security: 0 });
    expect(clamped.correctness).toBe(MAX_SCORE);
    expect(clamped.security).toBe(MIN_SCORE);
  });

  it("rounds fractional scores and leaves in-range integers untouched", () => {
    const clamped = clampScores({ ...validScores, readability: 7.4, performance: 8 });
    expect(clamped.readability).toBe(7);
    expect(clamped.performance).toBe(8);
  });

  it("produces output that always satisfies the strict ReviewSchema", () => {
    const result = ReviewSchema.safeParse({
      scores: clampScores({ ...validScores, correctness: 99, security: -5 }),
      summary: "clamped back into contract range",
      verdict: "passed",
    });
    expect(result.success).toBe(true);
  });
});
