/**
 * Centralized environment + configuration concerns for the code reviewer.
 *
 * Kept free of import-time side effects so the reusable agent never couples to
 * `process`/`.env`: `loadEnv()` is an explicit call (only the CLI entrypoint
 * invokes it), and `resolveApiKey()` reads the key at call time.
 */

/** Default OpenRouter model id (overridable via `OPENROUTER_MODEL`). */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Resolve the OpenRouter model id from an explicit argument, the
 * `OPENROUTER_MODEL` env var, or `DEFAULT_MODEL`.
 *
 * Read at call time (like {@link resolveApiKey}) so a `.env` override loaded by
 * an entrypoint after import still takes effect.
 */
export function resolveModel(explicit?: string): string {
  return explicit ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

/**
 * Whether the reviewer should use its deterministic offline mock instead of a
 * live OpenRouter call. Reviewer-owned toggle (the Astro app reads the same
 * `OPENROUTER_MOCK` env var independently). Read at call time like the other
 * resolvers so an `.env` value loaded by an entrypoint after import is honored.
 */
export function isMockEnabled(): boolean {
  return process.env.OPENROUTER_MOCK === "true";
}

/**
 * Load `.env` into `process.env` (Node 22 native — no `dotenv` dependency).
 *
 * Must be called explicitly by an entrypoint; never runs at import time.
 */
export function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present; rely on the ambient environment instead.
  }
}

/**
 * Resolve the OpenRouter API key from an explicit argument or the
 * `OPENROUTER_API_KEY` env var, throwing when neither is present.
 */
export function resolveApiKey(explicit?: string): string {
  const apiKey = explicit ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in your environment or .env file.");
  }
  return apiKey;
}
