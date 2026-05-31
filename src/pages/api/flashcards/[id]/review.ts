import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { reviewCard } from "@/lib/services/srs";

export const prerender = false;

const bodySchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]),
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

  const id = context.params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
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

  try {
    const card = await reviewCard(supabase, user.id, id, parsed.data.rating);
    return new Response(JSON.stringify({ card }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Flashcard not found") {
      return new Response(JSON.stringify({ error: "Flashcard not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ error: "Failed to review flashcard" }), { status: 500 });
  }
};
