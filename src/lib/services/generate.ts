import { OPENROUTER_API_KEY, OPENROUTER_MOCK } from "astro:env/server";
import type { FlashcardCandidate } from "@/types";

const SYSTEM_PROMPT = `You are a vocabulary extraction engine for language flashcard generation.

Given a text in a foreign language, extract vocabulary worth memorizing and return it as flashcard candidates.

Rules:
1. Detect the source language. Always use Polish as the translation language, regardless of the source language.
2. Extract 3–15 vocabulary items: non-trivial words, useful phrases, or idioms. Skip function words (articles, prepositions, conjunctions) and vocabulary so common it would already be known.
3. For each item: provide the word or phrase in its base form ("word"), its translation ("translation"), and optionally a short usage example of ≤10 words ("context", may be null).
4. Return ONLY a valid JSON object — no markdown, no explanation:
   {"candidates":[{"word":"...","translation":"...","context":"..."}]}
5. If nothing is worth extracting, return: {"candidates":[]}

Text:
`;

const MOCK_CANDIDATES: FlashcardCandidate[] = [
  { word: "ephemeral", translation: "krótkotrwały", context: "An ephemeral moment of beauty." },
  { word: "serendipity", translation: "szczęśliwy przypadek", context: "Pure serendipity led to the discovery." },
  { word: "ubiquitous", translation: "wszechobecny", context: null },
];

export async function generateFlashcardCandidates(input: string): Promise<FlashcardCandidate[]> {
  if (OPENROUTER_MOCK === "true") {
    return MOCK_CANDIDATES;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: SYSTEM_PROMPT + input }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    // Application-level deadline so a hung upstream fails cleanly (the route's
    // catch → 500) instead of leaving the UI stuck in `loading` forever. Sized
    // for an LLM call, not the 2s health-probe value.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status}`);
  }

  interface OpenRouterResponse {
    choices?: { message?: { content?: string } }[];
  }
  // A 200 with a non-JSON envelope degrades to zero candidates rather than an
  // unhandled throw — same clean outcome as the inner content-parse fallback.
  let data: OpenRouterResponse;
  try {
    data = (await response.json()) as OpenRouterResponse;
  } catch {
    return [];
  }
  const content: string = data.choices?.[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(content) as { candidates?: FlashcardCandidate[] };
    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch {
    return [];
  }
}
