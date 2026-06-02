// Global Vitest setup. Runs in every test worker before the suite.
//
// Integration tests gate themselves on `isSupabaseReachable()`
// (see test/helpers/supabase.ts), so no hard env requirement is enforced here —
// a missing or unreachable local Supabase skips the integration suites with a
// clear message instead of failing the run.
export {};
