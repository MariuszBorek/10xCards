import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import type { Flashcard } from "@/types";

export const prerender = false;

function escapeField(value: string): string {
  return value.replace(/[\t\n\r]/g, " ");
}

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

  const { data, error } = await supabase
    .from("flashcards")
    .select("word, translation, context")
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to fetch flashcards" }), { status: 500 });
  }

  const rows = (data as Pick<Flashcard, "word" | "translation" | "context">[]).map(
    (f) => `${escapeField(f.word)}\t${escapeField(f.translation)}\t${escapeField(f.context ?? "")}`,
  );
  const csv = ["#separator:tab", ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="anki-export.txt"',
    },
  });
};
