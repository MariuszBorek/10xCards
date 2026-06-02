/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import { loadEnv } from "vite";

// Vitest only autoloads VITE_-prefixed vars. Our Supabase vars are unprefixed,
// so load every var from .env (empty prefix) and expose them on process.env
// during tests via `test.env`. `.env` is always loaded regardless of mode.
const env = loadEnv("test", process.cwd(), "");

// getViteConfig (not bare defineConfig) so the `@/*` alias and astro: virtual
// modules (astro:env/server, astro:middleware) resolve under test exactly as in
// the app. environment: "node" is the Astro v6 guidance for SSR/endpoint tests.
const inner = getViteConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    env,
  },
});

// The Cloudflare adapter injects @cloudflare/vite-plugin, which aborts Vitest
// startup by validating Worker-only constraints against the "node" test
// environment. Tests run in Node per the plan (no workerd — handlers are plain
// functions), so strip that single plugin; every other Astro plugin, including
// the virtual-module resolvers, stays intact.
export default async (configEnv: { mode: string; command: "build" | "serve" }) => {
  const resolved = typeof inner === "function" ? await inner(configEnv) : inner;
  if (Array.isArray(resolved.plugins)) {
    resolved.plugins = resolved.plugins.filter((p) => {
      const name = p && typeof p === "object" && "name" in p ? String((p as { name?: string }).name) : "";
      return !name.includes("cloudflare");
    });
  }
  return resolved;
};
