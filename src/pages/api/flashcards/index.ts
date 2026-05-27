import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Flashcard } from "@/types";

export const prerender = false;

const bodySchema = z.object({
  word: z.string().min(1, "word is required"),
  translation: z.string().min(1, "translation is required"),
  context: z.string().nullable().optional(),
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
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Validation error";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  const { word, translation, context: ctx } = parsed.data;

  const { data, error } = await supabase
    .from("flashcards")
    .insert({ user_id: user.id, word, translation, context: ctx ?? null })
    .select()
    .single<Flashcard>();

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to save flashcard" }), { status: 500 });
  }

  return new Response(JSON.stringify({ flashcard: data }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};
