import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { makeCookieStub } from "../helpers/handler";

// Risk #6 — middleware page gating. The middleware redirects unauthenticated
// requests to protected PAGE prefixes (/dashboard, /generate, /review,
// /collection) to /auth/signin, and lets authenticated ones through. It does
// NOT cover /api/* — that gap is intentional and recorded here so a future
// change that assumes "protected pages imply protected APIs" is caught.
//
// Oracle: the PRD auth guardrail + the middleware's documented PROTECTED_ROUTES
// contract. This is a hermetic UNIT test: the Supabase client factory is mocked,
// so the redirect/pass-through logic is exercised without a network round-trip.

// Mock the client factory the middleware calls. getUser is rebound per test to
// stand in for "no session" (returns null) vs "valid session" (returns a user).
const getUser = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser } }),
}));

// Imported after vi.mock so the middleware picks up the mocked createClient.
const { onRequest } = await import("@/middleware");

const SIGNIN = "/auth/signin";

type MiddlewareContext = Parameters<typeof onRequest>[0];

/**
 * Build the minimal context the middleware reads: url, request, cookies, locals,
 * and a redirect() that returns a sentinel Response. Returns the spies so each
 * test can assert redirect-vs-next behaviour.
 */
function makeMiddlewareContext(pathname: string) {
  const url = new URL(`http://localhost${pathname}`);
  const redirect = vi.fn((location: string) => new Response(null, { status: 302, headers: { Location: location } }));
  const next = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
  const locals: Pick<App.Locals, "user"> = { user: null };
  const context = {
    url,
    request: new Request(url, { headers: new Headers() }),
    cookies: makeCookieStub(),
    locals,
    redirect,
  } as unknown as MiddlewareContext;
  return { context, redirect, next, locals };
}

function asSignedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "user-x" } as User }, error: null });
}

function asUnauthenticated() {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
}

afterEach(() => {
  getUser.mockReset();
});

describe("middleware: page auth gating (Risk #6)", () => {
  it("redirects an unauthenticated request to a protected page to /auth/signin", async () => {
    asUnauthenticated();
    const { context, redirect, next } = makeMiddlewareContext("/dashboard");

    const res = (await onRequest(context, next)) as Response;

    expect(redirect).toHaveBeenCalledWith(SIGNIN);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(SIGNIN);
  });

  it("lets an authenticated request to a protected page through to next()", async () => {
    asSignedIn();
    const { context, redirect, next, locals } = makeMiddlewareContext("/dashboard");

    const res = (await onRequest(context, next)) as Response;

    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    // Middleware attaches the resolved user to locals for downstream handlers.
    expect(locals.user?.id).toBe("user-x");
  });

  it("does NOT redirect an unauthenticated request to a public page", async () => {
    asUnauthenticated();
    const { context, redirect, next } = makeMiddlewareContext("/auth/signin");

    await onRequest(context, next);

    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  // The documented gap: /api/* is outside PROTECTED_ROUTES, so the middleware
  // does NOT gate API requests even when unauthenticated. Reliance on each
  // endpoint's own in-handler 401 (see api-gating.test.ts) is therefore
  // intentional. If a future change adds /api to PROTECTED_ROUTES, this test
  // goes red and forces a conscious decision.
  it("does NOT redirect an unauthenticated /api/* request (gap is intentional, in-handler 401 owns it)", async () => {
    asUnauthenticated();
    const { context, redirect, next } = makeMiddlewareContext("/api/flashcards");

    await onRequest(context, next);

    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
