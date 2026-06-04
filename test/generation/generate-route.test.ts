import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";

// Risk #5 — generate-route HTTP-status translation through the REAL POST handler.
//
// The handler calls supabase.auth.getUser(), so this is an integration suite
// gated on a reachable local Supabase (mirrors test/authz/flashcards-handler).
//
// We mock `astro:env/server` but spread the ORIGINAL module first, so
// SUPABASE_URL/SUPABASE_KEY (which src/lib/supabase.ts reads) stay intact and
// only OPENROUTER_MOCK becomes a toggle-able getter. Default is "true" (mock
// mode: valid input → 200 without an upstream call); the service-throw case
// flips it OFF and stubs the global fetch to fail → the route's catch → 500.
const mockEnv = vi.hoisted(() => ({ OPENROUTER_MOCK: "true" }));
vi.mock("astro:env/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get OPENROUTER_MOCK() {
      return mockEnv.OPENROUTER_MOCK;
    },
  };
});

import { POST, MAX_INPUT_LENGTH } from "@/pages/api/flashcards/generate";
import { makeApiContext } from "../helpers/handler";
import { deleteUser, isSupabaseReachable, seedUser, signedInCookieHeader, type SeededUser } from "../helpers/supabase";

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)("generate route: POST /api/flashcards/generate — status translation (Risk #5)", () => {
  let user: SeededUser;
  let cookieHeader: string;

  beforeAll(async () => {
    user = await seedUser();
    cookieHeader = await signedInCookieHeader(user.email, user.password);
  });

  afterAll(async () => {
    if (user) await deleteUser(user.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockEnv.OPENROUTER_MOCK = "true";
  });

  it("returns 401 when unauthenticated (no session cookie)", async () => {
    const res = await POST(makeApiContext({ method: "POST", body: { input: "hund" } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on empty input", async () => {
    const res = await POST(makeApiContext({ cookieHeader, method: "POST", body: { input: "   " } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on a non-JSON body", async () => {
    // Send a raw non-JSON body so the handler's `await request.json()` throws.
    const ctx = makeApiContext({ cookieHeader, method: "POST" });
    const badRequest = new Request(ctx.request.url, {
      method: "POST",
      headers: ctx.request.headers,
      body: "not json",
    });
    const res = await POST({ ...ctx, request: badRequest });
    expect(res.status).toBe(400);
  });

  it("returns 400 on oversized input (over the cap)", async () => {
    const oversized = "a".repeat(MAX_INPUT_LENGTH + 1);
    const res = await POST(makeApiContext({ cookieHeader, method: "POST", body: { input: oversized } }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when the generation service throws", async () => {
    mockEnv.OPENROUTER_MOCK = "false";
    // Discriminate by URL: fail only the OpenRouter call, let the handler's own
    // supabase.auth.getUser() fetch reach the real local Supabase (else auth
    // itself would fail and we'd see 401, not the service-throw 500 we test).
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        return href.includes("openrouter.ai")
          ? Promise.resolve(new Response("upstream down", { status: 500 }))
          : realFetch(url, init);
      }),
    );
    const res = await POST(makeApiContext({ cookieHeader, method: "POST", body: { input: "hund" } }));
    expect(res.status).toBe(500);
  });

  it("returns 200 with a candidate list on valid input (mock mode)", async () => {
    const res = await POST(makeApiContext({ cookieHeader, method: "POST", body: { input: "Der Hund läuft." } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(Array.isArray(body.candidates)).toBe(true);
  });
});
