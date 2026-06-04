import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { generateFlashcardCandidates } from "@/lib/services/generate";

export const prerender = false;

// Generation input cap — sized for a paste worth a handful of flashcards, not a
// whole document. Bounds the prompt before it reaches OpenRouter. Reused by the
// route test's oversized-input case.
export const MAX_INPUT_LENGTH = 5000;

const bodySchema = z.object({
  input: z
    .string()
    .trim()
    .min(1, "Input is required")
    .max(MAX_INPUT_LENGTH, `Input must be at most ${MAX_INPUT_LENGTH} characters`),
});

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Input is required" }), { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Input is required";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  const input = parsed.data.input;

  try {
    const candidates = await generateFlashcardCandidates(input);
    return new Response(JSON.stringify({ candidates }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 500 });
  }
};
