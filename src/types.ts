export interface Flashcard {
  id: string;
  user_id: string;
  word: string;
  translation: string;
  context: string | null;
  deleted_at: string | null;
  created_at: string;
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
