import { describe, expect, it } from "vitest";
import {
  buildReviewPrompt,
  deriveVerdict,
  MAX_PROMPT_CHARS,
  TRUNCATION_MARKER,
  type ReviewScores,
} from "@10xcards/code-reviewer";

// Contracts (b) prompt assembly + size guard and (c) deriveVerdict. Both are
// pure functions — assert directly, no env or network.

/** Baseline all-passing scores; individual cases override one criterion. */
const passingScores: ReviewScores = {
  correctness: 7,
  security: 8,
  errorHandling: 6,
  readability: 9,
  testCoverage: 5,
  performance: 8,
  consistency: 7,
};

describe("buildReviewPrompt: assembly", () => {
  it("includes the title, body, and diff verbatim", () => {
    const prompt = buildReviewPrompt({
      title: "Add user_id filter to export endpoint",
      body: "Defense-in-depth against cross-account reads.",
      diff: "+ .eq('user_id', user.id)",
    });

    expect(prompt).toContain("Add user_id filter to export endpoint");
    expect(prompt).toContain("Defense-in-depth against cross-account reads.");
    expect(prompt).toContain("+ .eq('user_id', user.id)");
  });

  it("uses a placeholder when the body is empty", () => {
    const prompt = buildReviewPrompt({ title: "T", body: "", diff: "+ x" });
    expect(prompt).toContain("(no description provided)");
  });
});

describe("buildReviewPrompt: MAX_PROMPT_CHARS size guard", () => {
  it("leaves an under-budget prompt untruncated", () => {
    const prompt = buildReviewPrompt({ title: "T", body: "B", diff: "+ small diff" });
    expect(prompt).not.toContain(TRUNCATION_MARKER);
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });

  it("truncates an over-budget diff (not the title/body) with the marker", () => {
    const title = "Huge refactor";
    const body = "This PR touches everything.";
    // A diff comfortably larger than the whole prompt budget.
    const diff = "+ line\n".repeat(MAX_PROMPT_CHARS);

    const prompt = buildReviewPrompt({ title, body, diff });

    // Bounded, marked, and the title/body survive intact.
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(prompt).toContain(TRUNCATION_MARKER);
    expect(prompt).toContain(title);
    expect(prompt).toContain(body);
    // The tail of the original diff must not survive truncation.
    expect(prompt.endsWith("+ line\n```")).toBe(false);
  });
});

describe("deriveVerdict: min-threshold rule", () => {
  it("returns 'passed' when every score is 5 or above", () => {
    expect(deriveVerdict(passingScores)).toBe("passed");
  });

  it("treats a score of exactly 5 as passing (rule is 'below 5')", () => {
    expect(deriveVerdict({ ...passingScores, testCoverage: 5 })).toBe("passed");
  });

  it("returns 'failed' when any single score is below 5", () => {
    expect(deriveVerdict({ ...passingScores, correctness: 4 })).toBe("failed");
  });

  it("returns 'failed' for the minimum possible score", () => {
    expect(deriveVerdict({ ...passingScores, security: 1 })).toBe("failed");
  });
});
