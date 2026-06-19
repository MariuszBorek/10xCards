import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOCK_FAIL_MARKER, ReviewSchema } from "@10xcards/code-reviewer";
import ReviewProvider from "../../packages/code-reviewer/eval/review-provider.ts";

// Locks the promptfoo provider glue WITHOUT network or key: with
// OPENROUTER_MOCK=true the wrapped reviewPullRequest short-circuits to the
// deterministic mock, so we can assert the vars are forwarded, the model is
// threaded, and a schema-valid Review JSON string comes back out. The real
// flaw-detection assertions are a live run (Phase 4, Manual Verification).

describe("ReviewProvider: promptfoo wiring (offline mock)", () => {
  let savedMock: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedMock = process.env.OPENROUTER_MOCK;
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_MOCK = "true";
    // The mock short-circuits before any key resolution.
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (savedMock === undefined) delete process.env.OPENROUTER_MOCK;
    else process.env.OPENROUTER_MOCK = savedMock;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("exposes the configured provider id", () => {
    const provider = new ReviewProvider({ id: "glm-5.1", config: { model: "z-ai/glm-5.1" } });
    expect(provider.id()).toBe("glm-5.1");
  });

  it("returns output that parses to a schema-valid Review", async () => {
    const provider = new ReviewProvider({ id: "sonnet-4.6", config: { model: "anthropic/claude-sonnet-4.6" } });

    const result = await provider.callApi("{{diff}}", {
      prompt: { raw: "{{diff}}", label: "diff" },
      vars: { title: "Tidy up", body: "", diff: "+ const z = 3;" },
    });

    expect(result.error).toBeUndefined();
    expect(typeof result.output).toBe("string");
    const review = ReviewSchema.parse(JSON.parse(result.output as string));
    expect(review.verdict).toBe("passed");
  });

  it("threads a diff with the fail marker through to a failed verdict", async () => {
    const provider = new ReviewProvider({ id: "deepseek-v4-flash", config: { model: "deepseek/deepseek-v4-flash" } });

    const result = await provider.callApi("{{diff}}", {
      prompt: { raw: "{{diff}}", label: "diff" },
      vars: { title: "Risky change", body: "", diff: `+ ${MOCK_FAIL_MARKER}` },
    });

    const review = ReviewSchema.parse(JSON.parse(result.output as string));
    expect(review.verdict).toBe("failed");
  });
});
