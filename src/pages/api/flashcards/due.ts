import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getDueCards } from "@/lib/services/srs";

export const prerender = false;

export const GET: APIRoute = async (context) => {
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

  try {
    const cards = await getDueCards(supabase, user.id);
    return new Response(JSON.stringify({ cards }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to fetch due cards" }), { status: 500 });
  }
};
