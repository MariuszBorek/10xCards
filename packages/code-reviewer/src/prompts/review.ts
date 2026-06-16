/**
 * Prompts for the code reviewer, extracted as a named instruction constant and
 * a pure user-prompt builder so they can be reused by the agent and a future
 * eval without duplicating wording.
 */

/** System instructions for the reviewer (the agent's `instructions`). */
export const REVIEW_INSTRUCTIONS =
  "You are a meticulous senior software engineer performing a code review. " +
  "Focus on correctness, security, performance, and maintainability. " +
  "Be specific and actionable; do not invent issues when the code is sound.";

/** Build the user prompt for a single review, with an optional language hint. */
export function buildReviewPrompt(code: string, language?: string): string {
  const languageLine = language ? `Language: ${language}\n` : "";
  return `${languageLine}Review the following code:\n\n\`\`\`\n${code}\n\`\`\``;
}
