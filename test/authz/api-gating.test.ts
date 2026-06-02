import { describe, expect, it } from "vitest";
import { GET } from "@/pages/api/flashcards/index";
import { makeApiContext } from "../helpers/handler";
import { isSupabaseReachable } from "../helpers/supabase";

// Risk #6 — API auth gating. Middleware's PROTECTED_ROUTES covers only page
// prefixes (/dashboard, /generate, /review, /collection); it does NOT match
// /api/*. So every flashcard endpoint must self-guard with its own getUser() →
// 401. This test proves that in-handler gate holds for an unauthenticated
// request: no session cookie → 401 → no flashcard data leaks.
//
// Oracle: the PRD auth guardrail ("an unauthenticated request to a protected
// endpoint returns 401 and never returns data"), not the handler's branch shape.
//
// This needs reachable Supabase: the @supabase/ssr server client's getUser()
// hits /auth/v1/user, and with no token the server returns no user → the
// handler's 401 branch. Skips cleanly when local Supabase is down.

const reachable = await isSupabaseReachable();

describe.skipIf(!reachable)("authz: unauthenticated API request is rejected (Risk #6)", () => {
  it("GET /api/flashcards returns 401 with no flashcard data when no session cookie is present", async () => {
    // makeApiContext with no cookieHeader → request carries no auth cookie.
    const res = await GET(makeApiContext());

    expect(res.status).toBe(401);

    const body = (await res.json()) as Record<string, unknown>;
    // An error is returned...
    expect(body).toHaveProperty("error");
    // ...and crucially, NO flashcard data — the unauthenticated caller sees nothing.
    expect(body).not.toHaveProperty("flashcards");
  });
});
