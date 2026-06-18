import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMockReview,
  MOCK_FAIL_MARKER,
  reviewPullRequest,
  ReviewSchema,
  deriveVerdict,
} from "@10xcards/code-reviewer";

// Contract (d): the deterministic offline mock path. The reviewer reads
// OPENROUTER_MOCK / OPENROUTER_API_KEY straight off process.env at call time
// (config.ts), so we toggle process.env directly here — there is no
// `astro:env/server` indirection to mock for this package.

describe("buildMockReview: pure, deterministic fixture", () => {
  it("returns a schema-valid passing review for a clean diff", () => {
    const review = buildMockReview("+ const x = 1;");
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    expect(review.verdict).toBe("passed");
    // Self-consistent: the canned scores agree with the min-threshold rule.
    expect(deriveVerdict(review.scores)).toBe("passed");
  });

  it("returns a schema-valid failing review when the diff carries the fail marker", () => {
    const review = buildMockReview(`+ // ${MOCK_FAIL_MARKER}\n+ broken();`);
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    expect(review.verdict).toBe("failed");
    expect(deriveVerdict(review.scores)).toBe("failed");
  });

  it("is deterministic: identical input yields identical output", () => {
    const diff = "+ const y = 2;";
    expect(buildMockReview(diff)).toStrictEqual(buildMockReview(diff));
  });
});

describe("reviewPullRequest: mock path needs no API key", () => {
  let savedMock: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedMock = process.env.OPENROUTER_MOCK;
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_MOCK = "true";
    // Prove the mock short-circuits before any key resolution.
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (savedMock === undefined) delete process.env.OPENROUTER_MOCK;
    else process.env.OPENROUTER_MOCK = savedMock;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("returns a valid passing Review for a clean diff with no key set", async () => {
    const review = await reviewPullRequest({ title: "Tidy up", body: "", diff: "+ const z = 3;" });
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    expect(review.verdict).toBe("passed");
  });

  it("returns a failing Review when the diff carries the fail marker", async () => {
    const review = await reviewPullRequest({
      title: "Risky change",
      body: "",
      diff: `+ ${MOCK_FAIL_MARKER}`,
    });
    expect(review.verdict).toBe("failed");
  });
});
