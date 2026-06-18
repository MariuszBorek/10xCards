import { readFileSync } from "node:fs";
import { loadEnv, resolveModel } from "./config.ts";
import type { Review } from "./schemas/review.ts";
import { deriveVerdict } from "./prompts/review.ts";
import { reviewCode, reviewPullRequest } from "./agent/reviewer.ts";

/**
 * CLI entrypoint for the code reviewer — the only place `.env` is loaded.
 *
 * CI path: `--title … --body … --diff-file …` reviews a real PR diff and writes
 * a single machine-readable JSON object `{ verdict, summary, scores }` to
 * stdout. All human/debug logging goes to stderr so stdout stays parseable. An
 * LLM/infra error emits a neutral `{ verdict: null, error }` (never a `failed`
 * verdict) so outages don't masquerade as review failures.
 *
 * With no args it falls back to the hardcoded demo (non-CI dev path). The
 * library surface (`index.ts`) stays side-effect-free; all execution lives here.
 */

interface CliArgs {
  title?: string;
  body?: string;
  diffFile?: string;
}

/** Parse the supported `--title` / `--body` / `--diff-file` flags. */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--title":
        args.title = value;
        i++;
        break;
      case "--body":
        args.body = value;
        i++;
        break;
      case "--diff-file":
        args.diffFile = value;
        i++;
        break;
      default:
        break;
    }
  }
  return args;
}

/** Pretty-print a review to stdout (demo path only). */
function printReview(review: Review): void {
  console.log(`\nVerdict: ${review.verdict.toUpperCase()}`);
  console.log(`Summary: ${review.summary}\n`);
  for (const [criterion, value] of Object.entries(review.scores)) {
    console.log(`  ${criterion}: ${value}/10`);
  }
}

/** Hardcoded demo run when executed with no flags via `npm run dev`. */
async function runDemo(): Promise<void> {
  const sample = `function divide(a, b) {
  return a / b;
}`;

  // Resolve after loadEnv() so an `.env` OPENROUTER_MODEL override is reflected.
  console.error(`Reviewing sample code with model: ${resolveModel()}`);
  const review = await reviewCode({ code: sample, language: "javascript" });
  printReview(review);
}

/**
 * CI review run: review the PR diff and emit a single JSON object to stdout.
 * Returns the process exit code.
 */
async function runReview(diffFile: string, args: CliArgs): Promise<number> {
  const diff = readFileSync(diffFile, "utf8");
  const title = args.title ?? "";
  const body = args.body ?? "";

  try {
    const review = await reviewPullRequest({ title, body, diff });

    // Consistency guard: warn (stderr) when the model's verdict contradicts the
    // min-threshold rule applied to its own scores. Never override the verdict.
    const derived = deriveVerdict(review.scores);
    if (derived !== review.verdict) {
      console.error(
        `[warn] model verdict "${review.verdict}" disagrees with min-threshold rule (derived "${derived}" from scores).`,
      );
    }

    process.stdout.write(
      JSON.stringify({ verdict: review.verdict, summary: review.summary, scores: review.scores }) + "\n",
    );
    return 0;
  } catch (error: unknown) {
    // Infra/LLM error → neutral outcome, not a `failed` verdict. The workflow
    // reads `verdict: null` and skips labeling rather than red-flagging the PR.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] review unavailable: ${message}`);
    process.stdout.write(JSON.stringify({ verdict: null, error: message }) + "\n");
    return 0;
  }
}

async function main(): Promise<void> {
  // Node 22 loads `.env` natively — no `dotenv` dependency needed.
  loadEnv();

  const args = parseArgs(process.argv.slice(2));

  if (!args.diffFile) {
    // No diff supplied → non-CI demo fallback.
    await runDemo();
    return;
  }

  process.exitCode = await runReview(args.diffFile, args);
}

// Run main() only when this file is the entry point, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
