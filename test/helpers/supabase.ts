import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, serializeCookieHeader } from "@supabase/ssr";

// The app's own clients are untyped (no generated DB schema) — query rows are
// `any`, and the app types results manually against `@/types` (see srs.ts).
// Tests mirror that exactly: the bare `SupabaseClient` (its default schema is
// `any`), so `.from()` does not collapse to `never` rows the way the inferred
// `createClient` return does.
export type TestSupabaseClient = SupabaseClient;

// Plain @supabase/supabase-js clients built directly from process.env — NOT
// src/lib/supabase.ts, which needs Astro cookies + astro:env. This is the
// two-user seeding spine reused by every integration phase (RLS, authz, gating).

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True only when all three env vars tests need are present. */
export function hasTestEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Guard for `describe.skipIf(!(await isSupabaseReachable()))`. Returns false
 * (with a clear console message) when env is missing or local Supabase is
 * unreachable, so integration suites skip rather than fail spuriously.
 */
export async function isSupabaseReachable(): Promise<boolean> {
  if (!hasTestEnv()) {
    console.warn(
      "[test] Skipping integration tests: SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY not all set. " +
        "Run `npx supabase start` and copy the keys into .env (see .env.example).",
    );
    return false;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`health endpoint returned ${res.status}`);
    return true;
  } catch {
    console.warn(
      `[test] Skipping integration tests: local Supabase not reachable at ${SUPABASE_URL}. Run \`npx supabase start\`.`,
    );
    return false;
  }
}

/** service_role admin client — used for seeding and teardown only. */
export function adminClient(): TestSupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Bare anon client (no session). Use `signedInClient` for asserted operations. */
export function anonClient(): TestSupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

// Per-run nonce so re-runs don't collide on email (auth.users persists across
// runs until a db reset). process.pid + hrtime is deterministic-enough and
// avoids any wall-clock dependency.
const runNonce = `${process.pid}-${process.hrtime.bigint()}`;
let userSeq = 0;

/**
 * Create a confirmed user via the admin API. Default email carries a per-run
 * nonce so concurrent/repeat runs never collide. Returns credentials for
 * `signedInClient`.
 */
export async function seedUser(email?: string, password = "test-password-123!"): Promise<SeededUser> {
  const admin = adminClient();
  const finalEmail = email ?? `test-${runNonce}-${userSeq++}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email: finalEmail,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`seedUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { id: data.user.id, email: finalEmail, password };
}

/**
 * Anon client that has completed signInWithPassword — the client whose JWT
 * carries auth.uid() to PostgREST, so RLS is exercised exactly as in production.
 * This is the client every "B cannot reach A" assertion must run through.
 */
export async function signedInClient(email: string, password: string): Promise<TestSupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signInWithPassword failed for ${email}: ${error.message}`);
  }
  return client;
}

/**
 * Sign a user in through a `@supabase/ssr` server client backed by an in-memory
 * cookie jar, then serialize the persisted session into a `Cookie` header string.
 *
 * This is the non-obvious contract the handler/middleware tests reuse: the real
 * route handlers build their client via `createServerClient(headers, cookies)`
 * and read the session ONLY from the request's `Cookie` header. There is no
 * other way to hand a handler an authenticated session. Values are run through
 * `serializeCookieHeader` (URL-encodes) so they round-trip cleanly through the
 * handler's `parseCookieHeader` read, even for chunked/base64 session cookies.
 */
export async function signedInCookieHeader(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => jar.set(name, value));
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signedInCookieHeader sign-in failed for ${email}: ${error.message}`);
  }
  if (jar.size === 0) {
    throw new Error(`signedInCookieHeader: no session cookies were persisted for ${email}`);
  }

  return [...jar.entries()].map(([name, value]) => serializeCookieHeader(name, value, {})).join("; ");
}

/** Delete a seeded user (CASCADE drops their flashcards). Call in afterAll. */
export async function deleteUser(id: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    throw new Error(`deleteUser failed for ${id}: ${error.message}`);
  }
}
