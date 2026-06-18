/**
 * Public API barrel for the AI-powered code reviewer.
 *
 * Side-effect-free: importing this module loads no `.env`, runs no demo, and
 * throws on no missing config. The CLI demo lives in `cli.ts`.
 */

export { reviewCode, reviewPullRequest, createReviewAgent } from "./agent/reviewer.ts";
export type { ReviewCodeOptions, ReviewPullRequestOptions } from "./agent/reviewer.ts";
export { buildMockReview, MOCK_FAIL_MARKER } from "./agent/mock-review.ts";
export { ReviewSchema, ReviewScoresSchema } from "./schemas/review.ts";
export type { Review, ReviewScores } from "./schemas/review.ts";
export {
  REVIEW_INSTRUCTIONS,
  buildReviewPrompt,
  deriveVerdict,
  MAX_PROMPT_CHARS,
  TRUNCATION_MARKER,
} from "./prompts/review.ts";
export type { ReviewPromptInput } from "./prompts/review.ts";
export { isMockEnabled } from "./config.ts";
