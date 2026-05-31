export interface Flashcard {
  id: string;
  user_id: string;
  word: string;
  translation: string;
  context: string | null;
  deleted_at: string | null;
  created_at: string;
  // FSRS spaced-repetition state (ts-fsrs Card, mapped 1:1; timestamps as ISO strings).
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

/** The four user-facing review grades (maps to ts-fsrs Rating: Again/Hard/Good/Easy). */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** A due flashcard enriched with the predicted next-interval label per rating. */
export interface DueCard extends Flashcard {
  preview: Record<ReviewRating, string>;
}

export interface FlashcardInsert {
  user_id: string;
  word: string;
  translation: string;
  context?: string | null;
}

export interface FlashcardCandidate {
  word: string;
  translation: string;
  context: string | null;
}
