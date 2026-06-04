import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { buildAnkiTsv } from "@/lib/services/anki-export";

export const prerender = false;

// Render-XSS deferral (#7): the collection/candidate render sink is intentionally
// untested for this phase — it has no raw-HTML path (every field is escaped JSX
// text), so it is non-reachable, and a DOM test waits until DOM infra exists for
// another reason. Rationale recorded in context/foundation/test-plan.md §6.5.

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

  const csv = buildAnkiTsv(data);

  const filename = `anki-export-${new Date().toISOString().slice(0, 10)}.txt`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
