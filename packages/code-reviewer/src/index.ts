/**
 * Public API barrel for the AI-powered code reviewer.
 *
 * Side-effect-free: importing this module loads no `.env`, runs no demo, and
 * throws on no missing config. The CLI demo lives in `cli.ts`.
 */

export { reviewCode, createReviewAgent } from "./agent/reviewer.ts";
export type { ReviewCodeOptions } from "./agent/reviewer.ts";
export { ReviewFindingSchema, ReviewSchema } from "./schemas/review.ts";
export type { Review, ReviewFinding } from "./schemas/review.ts";
