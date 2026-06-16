import { z } from "zod";

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
