/**
 * Centralized environment + configuration concerns for the code reviewer.
 *
 * Kept free of import-time side effects so the reusable agent never couples to
 * `process`/`.env`: `loadEnv()` is an explicit call (only the CLI entrypoint
 * invokes it), and `resolveApiKey()` reads the key at call time.
 */

/** Default OpenRouter model id (overridable via `OPENROUTER_MODEL`). */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6";

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
