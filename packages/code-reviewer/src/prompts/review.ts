import type { ReviewScores } from "../schemas/review.ts";

/**
 * Prompts for the code reviewer, extracted as a named instruction constant and
 * a pure user-prompt builder so they can be reused by the agent and a future
 * eval without duplicating wording.
 */

/**
 * Maximum number of characters in the assembled user prompt (title + body +
 * diff + scaffolding). Bounds per-review token cost; when exceeded, the diff —
 * never the title/body — is truncated with a visible marker.
 */
export const MAX_PROMPT_CHARS = 100_000;

/** Visible marker appended to a diff that was cut to fit {@link MAX_PROMPT_CHARS}. */
export const TRUNCATION_MARKER = "\n…[truncated]";

/**
 * System instructions for the reviewer (the agent's `instructions`). Carries the
 * full 7-criteria 1–10 rubric (anchors from `requirements.md:16-42`), the
 * min-threshold verdict rule, and the project's security heuristic.
 */
export const REVIEW_INSTRUCTIONS = [
  "You are a meticulous senior software engineer reviewing a pull request.",
  "You are given the PR title, description, and unified diff. Review the diff against the",
  "seven criteria below and return an integer score from 1 (worst) to 10 (best) for each.",
  "Be specific and grounded in the diff; do not invent issues when the code is sound.",
  "",
  "Criteria (score each 1–10):",
  "1. Correctness — does the diff do what its title/description claim, without logic errors or",
  "   regressions? 1 = obvious bugs or behavior contradicting intent; 10 = logically sound, no regressions.",
  "2. Security — does it avoid vulnerabilities (injection, missing authz/RLS, leaked secrets, unsafe",
  "   input)? 1 = introduces an exploitable flaw or exposes sensitive data; 10 = no new attack surface,",
  "   inputs validated, secrets and access controls handled correctly.",
  "3. Error handling & edge cases — are failure paths, empty/boundary inputs, and unexpected states",
  "   handled gracefully? 1 = happy-path only, swallows errors, crashes on edge cases; 10 = failure modes",
  "   caught and surfaced meaningfully, edge cases covered.",
  "4. Readability & maintainability — is the code clear, well-named, easy to change? 1 = cryptic naming,",
  "   tangled control flow, duplicated/dead code; 10 = self-explanatory, well-structured, easy to extend.",
  "5. Test coverage — is the change accompanied by tests proportionate to its risk? 1 = risky logic with",
  "   no tests; 10 = meaningful tests covering the new behavior and its important edge cases.",
  "6. Performance & efficiency — does it avoid needless work, inefficient algorithms, or resource leaks?",
  "   1 = clear regressions, N+1 patterns, unbounded resource use; 10 = efficient for the expected workload.",
  "7. Consistency with conventions — does the diff follow the project's established patterns and idioms?",
  "   1 = ignores conventions, mixes styles, reinvents existing helpers; 10 = blends in seamlessly.",
  "",
  "Project security heuristic (apply under the Security criterion): if the diff touches",
  "src/pages/api/flashcards/index.ts, src/pages/api/flashcards/[id].ts, src/pages/api/flashcards/export.ts,",
  'or the `flashcards` RLS policies, check for a defense-in-depth app-layer `.eq("user_id", …)` filter on',
  "the query. These endpoints lean on RLS alone; a query that reads/writes `flashcards` by id without an",
  "explicit user_id filter is a cross-account IDOR risk and should lower the Security score.",
  "",
  'Verdict rule: set `verdict` to "failed" if ANY of the seven criterion scores is below 5;',
  'otherwise set it to "passed".',
].join("\n");

/** Inputs for assembling a pull-request review prompt. */
export interface ReviewPromptInput {
  /** The PR title. */
  title: string;
  /** The PR description/body (may be empty). */
  body?: string;
  /** The unified diff to review (truncated here if the prompt would exceed the cap). */
  diff: string;
}

/**
 * Build the user prompt for a single PR review from its title, body, and diff.
 *
 * Applies the {@link MAX_PROMPT_CHARS} guard: if the assembled prompt would
 * exceed the cap, the diff (never the title/body) is truncated and a visible
 * {@link TRUNCATION_MARKER} is appended, so a huge PR can't blow up token cost.
 */
export function buildReviewPrompt({ title, body, diff }: ReviewPromptInput): string {
  const bodySection = body && body.trim().length > 0 ? body.trim() : "(no description provided)";
  const assemble = (d: string) =>
    [
      `PR title: ${title}`,
      "",
      "PR description:",
      bodySection,
      "",
      "Unified diff under review:",
      "```diff",
      d,
      "```",
    ].join("\n");

  const full = assemble(diff);
  if (full.length <= MAX_PROMPT_CHARS) {
    return full;
  }

  // Overhead = everything except the diff body; size the diff to what remains.
  const overhead = assemble("").length + TRUNCATION_MARKER.length;
  const budget = Math.max(0, MAX_PROMPT_CHARS - overhead);
  return assemble(diff.slice(0, budget) + TRUNCATION_MARKER);
}

/**
 * Derive the min-threshold verdict from a set of scores: `"failed"` if ANY
 * criterion scores below 5, otherwise `"passed"`.
 *
 * Pure mirror of the rubric rule stated in {@link REVIEW_INSTRUCTIONS}. The CLI
 * uses it as a consistency guard against the model's own `verdict`; it never
 * overrides the emitted verdict.
 */
export function deriveVerdict(scores: ReviewScores): "passed" | "failed" {
  return Object.values(scores).some((s) => s < 5) ? "failed" : "passed";
}
