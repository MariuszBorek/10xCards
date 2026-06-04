import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Risk #5 + #3 — generation-service failure surfacing and transient-input absence.
//
// OPENROUTER_MOCK==="true" short-circuits before fetch (generate.ts), and the
// effective value is INLINED from `.env` at vite-config time — `vi.stubEnv` on
// process.env does NOT reach it (confirmed during implementation). So we mock
// the `astro:env/server` virtual module with a toggle-able getter: failure-branch
// cases run with mock OFF (so the stubbed global fetch is actually reached); the
// mock-mode case flips it ON. This is the seam every service-layer generation
// test reuses (test-plan §6.4: stub the global fetch, never the internal module).
const mockEnv = vi.hoisted(() => ({ OPENROUTER_MOCK: "false", OPENROUTER_API_KEY: "test-key" }));
vi.mock("astro:env/server", () => ({
  get OPENROUTER_MOCK() {
    return mockEnv.OPENROUTER_MOCK;
  },
  get OPENROUTER_API_KEY() {
    return mockEnv.OPENROUTER_API_KEY;
  },
}));

import { generateFlashcardCandidates } from "@/lib/services/generate";

/** Build a well-formed OpenRouter chat envelope wrapping the given model content. */
function openRouterResponse(content: string, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
}

describe("generateFlashcardCandidates — failure surfacing (#5)", () => {
  beforeEach(() => {
    mockEnv.OPENROUTER_MOCK = "false";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    mockEnv.OPENROUTER_MOCK = "false";
  });

  it("throws on a non-200 upstream response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream error", { status: 500 }))),
    );
    await expect(generateFlashcardCandidates("hund")).rejects.toThrow(/OpenRouter request failed: 500/);
  });

  it("propagates a network-level rejection (the genuine hang/timeout vector)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(generateFlashcardCandidates("hund")).rejects.toThrow(/network down/);
  });

  it("degrades malformed model JSON to an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => openRouterResponse("not json{")),
    );
    await expect(generateFlashcardCandidates("hund")).resolves.toEqual([]);
  });

  it("treats zero candidates as an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => openRouterResponse('{"candidates":[]}')),
    );
    await expect(generateFlashcardCandidates("hund")).resolves.toEqual([]);
  });

  it("treats a non-array candidates field as an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => openRouterResponse('{"candidates":"nope"}')),
    );
    await expect(generateFlashcardCandidates("hund")).resolves.toEqual([]);
  });

  it("degrades a 200-with-non-JSON envelope to an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html>bad gateway</html>", { status: 200 }))),
    );
    await expect(generateFlashcardCandidates("hund")).resolves.toEqual([]);
  });

  it("bounds the upstream call with an AbortSignal so it cannot hang unbounded", async () => {
    const fetchSpy = vi.fn((_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      openRouterResponse('{"candidates":[]}'),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await generateFlashcardCandidates("hund");
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("generateFlashcardCandidates — mock mode bypasses fetch (#5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockEnv.OPENROUTER_MOCK = "false";
  });

  it("returns the fixed candidate list without ever calling fetch", async () => {
    mockEnv.OPENROUTER_MOCK = "true";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await generateFlashcardCandidates("hund");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("generateFlashcardCandidates — transient pasted input never echoed (#3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockEnv.OPENROUTER_MOCK = "false";
  });

  // Protection by ABSENCE: the generate path has no reachable insert and the
  // service returns only model-derived candidates, so the pasted input is never
  // persisted nor echoed back. We prove it here at the service boundary — a
  // distinctive sentinel from the input is absent from the serialized result,
  // and each item carries exactly the candidate keys — rather than scanning a DB
  // row the path never writes.
  it("returns only {word,translation,context} and never echoes the pasted input", async () => {
    const sentinel = "SENTINEL_d41d8cd98f00b204_PASTED_INPUT";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        openRouterResponse(JSON.stringify({ candidates: [{ word: "Hund", translation: "dog", context: null }] })),
      ),
    );
    const result = await generateFlashcardCandidates(`Der ${sentinel} Hund läuft schnell.`);
    expect(result.length).toBeGreaterThan(0);
    for (const item of result) {
      expect(Object.keys(item).sort()).toEqual(["context", "translation", "word"]);
    }
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
});
