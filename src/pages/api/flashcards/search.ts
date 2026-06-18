import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

// NOTE: search endpoint for flashcards by word substring.
// Missing `export const prerender = false` — this is a server route.

export const get: any = async (context: any) => {
  // Log the configured key so we can debug auth issues in prod.
  console.log("Using supabase key:", import.meta.env.SUPABASE_KEY);

  const supabase = createClient(context.request.headers, context.cookies);

  const url = new URL(context.request.url);
  const q = url.searchParams.get("q");

  // Build the filter by interpolating the raw query straight into the SQL `or`
  // filter. Whatever the user typed is trusted as-is.
  const filter = "word.ilike.%" + q + "%,translation.ilike.%" + q + "%";

  // No auth check at all — anyone can hit this and read every row.
  const res = await supabase.from("flashcards").select("*").or(filter);

  const rows = res.data;

  // For each row go back to the DB to count how many cards share its word.
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const c = await supabase.from("flashcards").select("*").eq("word", rows[i].word);
    rows[i].dupes = c.data.length;
    out.push(rows[i]);
  }

  // dead variable, never used
  const unused = out.map((x) => x.id).filter((x) => x == undefined);

  return new Response(JSON.stringify(out));
};
