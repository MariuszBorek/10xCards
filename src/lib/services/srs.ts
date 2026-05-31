import { fsrs, Rating, show_diff_message, type Card, type Grade } from "ts-fsrs";
import type { createClient } from "@/lib/supabase";
import type { DueCard, Flashcard, ReviewRating } from "@/types";

/**
 * SRS (spaced-repetition) service. The single home for `ts-fsrs` usage and the
 * `Date ⇄ ISO-string` seam: the scheduler speaks JS `Date`s, the DB stores ISO
 * strings in `timestamptz`. Routes and the client never import `ts-fsrs`.
 */

// The route always passes a non-null client (it 500s earlier if Supabase is unconfigured).
type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

// Shared scheduler with default FSRS weights (MVP — no optimizer, no user settings).
const scheduler = fsrs();

// User grade ⇄ ts-fsrs Rating. The four grades are all `Grade` (Rating minus Manual).
const RATING_MAP: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

// Compact, language-neutral interval units. Length must be 6 for `show_diff_message`
// ([second, min, hour, day, month, year]); otherwise it falls back to English words.
const TIME_UNITS = ["s", "min", "h", "d", "mo", "y"];

/** Hydrate a DB row's FSRS columns into a ts-fsrs `Card` (ISO strings → `Date`s). */
function rowToCard(row: Flashcard): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/** Serialize a ts-fsrs `Card` back to the DB column shape (`Date`s → ISO strings). */
function cardToColumns(card: Card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- column exists until ts-fsrs v6; persist for round-trip fidelity
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** Human label for the interval between `now` and a previewed `due` (e.g. "10min", "3d"). */
function formatInterval(due: Date, now: Date): string {
  return show_diff_message(due, now, true, TIME_UNITS);
}

/**
 * Cards due for review (`due <= now`), oldest-first, each enriched with the four
 * next-interval preview labels via `scheduler.repeat`. Throws on DB error.
 */
export async function getDueCards(supabase: SupabaseClient, userId: string): Promise<DueCard[]> {
  const now = new Date();

  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .eq("user_id", userId)
    .lte("due", now.toISOString())
    .order("due", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch due cards");
  }

  const rows = data as Flashcard[];

  return rows.map((row) => {
    const preview = scheduler.repeat(rowToCard(row), now);
    return {
      ...row,
      preview: {
        again: formatInterval(preview[Rating.Again].card.due, now),
        hard: formatInterval(preview[Rating.Hard].card.due, now),
        good: formatInterval(preview[Rating.Good].card.due, now),
        easy: formatInterval(preview[Rating.Easy].card.due, now),
      },
    };
  });
}

/**
 * Apply one grade to a card, advance its FSRS schedule, and persist the new state.
 * RLS plus the explicit `user_id` filter scope the row to the user. Throws on
 * not-found / DB error. Returns the updated row.
 */
export async function reviewCard(
  supabase: SupabaseClient,
  userId: string,
  cardId: string,
  rating: ReviewRating,
): Promise<Flashcard> {
  const now = new Date();

  const { data: row, error: loadError } = await supabase
    .from("flashcards")
    .select("*")
    .eq("id", cardId)
    .eq("user_id", userId)
    .single<Flashcard>();

  if (loadError) {
    throw new Error("Flashcard not found");
  }

  const { card: updated } = scheduler.next(rowToCard(row), now, RATING_MAP[rating]);

  const { data, error } = await supabase
    .from("flashcards")
    .update(cardToColumns(updated))
    .eq("id", cardId)
    .eq("user_id", userId)
    .select()
    .single<Flashcard>();

  if (error) {
    throw new Error("Failed to update flashcard");
  }

  return data;
}
