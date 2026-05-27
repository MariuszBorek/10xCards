import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { generateFlashcardCandidates } from "@/lib/services/generate";

export const prerender = false;

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

  let body: { input?: string };
  try {
    body = (await context.request.json()) as { input?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Input is required" }), { status: 400 });
  }

  const input = (body.input ?? "").trim();
  if (!input) {
    return new Response(JSON.stringify({ error: "Input is required" }), { status: 400 });
  }

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
