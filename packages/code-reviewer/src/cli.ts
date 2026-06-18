import { loadEnv, resolveModel } from "./config.ts";
import type { Review } from "./schemas/review.ts";
import { reviewCode } from "./agent/reviewer.ts";

/**
 * CLI entrypoint for the code reviewer — the only place `.env` is loaded.
 *
 * Runs a hardcoded demo review and prints the structured findings. The library
 * surface (`index.ts`) stays side-effect-free; all execution lives here.
 */

/** Pretty-print a review to the console. */
function printReview(review: Review): void {
  console.log(`\nVerdict: ${review.verdict.toUpperCase()}`);
  console.log(`Summary: ${review.summary}\n`);
  for (const [criterion, value] of Object.entries(review.scores)) {
    console.log(`  ${criterion}: ${value}/10`);
  }
}

/** Demo run when executed directly via `npm run dev`. */
async function main(): Promise<void> {
  // Node 22 loads `.env` natively — no `dotenv` dependency needed.
  loadEnv();

  const sample = `function divide(a, b) {
  return a / b;
}`;

  // Resolve after loadEnv() so an `.env` OPENROUTER_MODEL override is reflected.
  console.log(`Reviewing sample code with model: ${resolveModel()}`);
  const review = await reviewCode({ code: sample, language: "javascript" });
  printReview(review);
}

// Run main() only when this file is the entry point, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
