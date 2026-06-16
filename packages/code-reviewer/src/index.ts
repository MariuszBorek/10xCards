import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

/**
 * Entry point for the AI-powered code reviewer.
 *
 * Wires together the AI SDK (`ai`), the OpenRouter provider, and zod-validated
 * structured output. This is intentionally small — a foundation that further
 * integration (CLI flags, diff parsing, GitHub comments, etc.) can build on.
 */

// Node 22 loads `.env` natively — no `dotenv` dependency needed.
try {
  process.loadEnvFile();
} catch {
  // No .env file present; rely on the ambient environment instead.
}

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6";

/** A single issue surfaced during review. */
export const ReviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]).describe("How serious the finding is."),
  title: z.string().describe("A short, specific summary of the issue."),
  detail: z.string().describe("Explanation of the problem and why it matters."),
  suggestion: z.string().describe("Concrete recommendation to resolve it."),
  line: z.number().nullable().describe("1-based line number if the issue maps to one, else null."),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/** The full structured result of a code review. */
export const ReviewSchema = z.object({
  summary: z.string().describe("A 1-3 sentence overall assessment."),
  findings: z.array(ReviewFindingSchema).describe("All issues found, most severe first."),
});
export type Review = z.infer<typeof ReviewSchema>;

export interface ReviewCodeOptions {
  /** The source code to review. */
  code: string;
  /** Optional language hint (e.g. "typescript") to focus the review. */
  language?: string;
  /** OpenRouter model id. Defaults to `OPENROUTER_MODEL` env or claude-sonnet-4.6. */
  model?: string;
  /** OpenRouter API key. Defaults to the `OPENROUTER_API_KEY` env var. */
  apiKey?: string;
}

/**
 * Review a snippet of code and return a zod-validated, structured report.
 */
export async function reviewCode(options: ReviewCodeOptions): Promise<Review> {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in your environment or .env file.");
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  const languageLine = options.language ? `Language: ${options.language}\n` : "";

  const { output } = await generateText({
    model: openrouter(model),
    system:
      "You are a meticulous senior software engineer performing a code review. " +
      "Focus on correctness, security, performance, and maintainability. " +
      "Be specific and actionable; do not invent issues when the code is sound.",
    prompt: `${languageLine}Review the following code:\n\n\`\`\`\n${options.code}\n\`\`\``,
    output: Output.object({ schema: ReviewSchema }),
  });

  return output;
}

/** Pretty-print a review to the console. */
function printReview(review: Review): void {
  console.log(`\nSummary: ${review.summary}\n`);
  if (review.findings.length === 0) {
    console.log("No issues found. ✅");
    return;
  }
  for (const f of review.findings) {
    const where = f.line === null ? "" : ` (line ${f.line})`;
    console.log(`[${f.severity.toUpperCase()}] ${f.title}${where}`);
    console.log(`  ${f.detail}`);
    console.log(`  → ${f.suggestion}\n`);
  }
}

/** Demo run when executed directly via `npm run dev`. */
async function main(): Promise<void> {
  const sample = `function divide(a, b) {
  return a / b;
}`;

  console.log(`Reviewing sample code with model: ${DEFAULT_MODEL}`);
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
