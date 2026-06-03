import type { APIContext } from "astro";

/**
 * Minimal `AstroCookies` stand-in for endpoint tests. The flashcard handlers
 * only ever READ the session from the request's `Cookie` header (via the SSR
 * client's `getAll`); `cookies.set`/`delete` are touched only if Supabase writes
 * a refreshed token mid-request. These no-op stubs keep that path from throwing
 * without pretending to be a real cookie store.
 */
export function makeCookieStub(): APIContext["cookies"] {
  return {
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
    merge: () => undefined,
    headers: () => [][Symbol.iterator](),
  } as unknown as APIContext["cookies"];
}

/**
 * Build the minimal `APIContext` a flashcard route handler actually reads:
 * `request` (whose `Cookie` header carries the session) and `cookies`.
 * Pass `cookieHeader` from `signedInCookieHeader` for an authenticated caller,
 * or omit it for an unauthenticated request (Phase 4's 401 path).
 *
 * For POST handlers (generate route, create round-trip), pass `method` and a
 * `body`: the body is JSON-serialized and a `Content-Type: application/json`
 * header is set so the handler's `await request.json()` reads it. GET call
 * sites that omit `method`/`body` build a bodyless GET exactly as before.
 */
export function makeApiContext(
  opts: { cookieHeader?: string; url?: string; method?: string; body?: unknown } = {},
): APIContext {
  const url = opts.url ?? "http://localhost/api/flashcards";
  const headers = new Headers();
  if (opts.cookieHeader) {
    headers.set("Cookie", opts.cookieHeader);
  }

  const init: RequestInit = { headers };
  if (opts.method) {
    init.method = opts.method;
  }
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(opts.body);
  }

  return {
    request: new Request(url, init),
    cookies: makeCookieStub(),
    params: {},
    url: new URL(url),
  } as unknown as APIContext;
}
