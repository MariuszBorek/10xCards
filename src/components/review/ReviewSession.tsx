import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DueCard, ReviewRating } from "@/types";

type Phase = "loading" | "reviewing" | "empty" | "done";

const RATINGS: { rating: ReviewRating; label: string }[] = [
  { rating: "again", label: "Znowu" },
  { rating: "hard", label: "Trudne" },
  { rating: "good", label: "Dobrze" },
  { rating: "easy", label: "Łatwe" },
];

export function ReviewSession() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [cards, setCards] = useState<DueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/flashcards/due");
        if (!res.ok) throw new Error("Failed to load");
        const json = (await res.json()) as { cards: DueCard[] };
        if (json.cards.length === 0) {
          setPhase("empty");
        } else {
          setCards(json.cards);
          setPhase("reviewing");
        }
      } catch {
        setError("Nie udało się wczytać sesji nauki. Odśwież stronę.");
      }
    }
    void load();
  }, []);

  const current = cards[index];

  async function handleRate(rating: ReviewRating) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/flashcards/${current.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error("Review failed");
      setReviewed((n) => n + 1);
      const next = index + 1;
      if (next >= cards.length) {
        setPhase("done");
      } else {
        setIndex(next);
        setRevealed(false);
      }
    } catch {
      setError("Nie udało się zapisać oceny. Spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
        Nauka
      </h1>

      {phase === "loading" && !error && <Skeleton className="h-64 w-full rounded-2xl bg-white/10" />}

      {phase === "loading" && error && <p className="text-sm text-red-300">{error}</p>}

      {phase === "reviewing" && (
        <div className="space-y-4">
          <p className="text-sm text-white/50">
            Fiszka {index + 1} z {cards.length}
          </p>

          <div className="space-y-5 rounded-2xl border border-white/10 bg-white/10 p-8 text-center text-white backdrop-blur-xl">
            <p className="text-3xl font-semibold">{current.word}</p>

            {revealed ? (
              <div className="space-y-3 border-t border-white/10 pt-5">
                <p className="text-2xl text-blue-100">{current.translation}</p>
                {current.context && <p className="text-sm text-white/60 italic">{current.context}</p>}
              </div>
            ) : (
              <Button
                variant="cosmic"
                onClick={() => {
                  setRevealed(true);
                }}
              >
                Pokaż odpowiedź
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {revealed && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {RATINGS.map(({ rating, label }) => (
                <Button
                  key={rating}
                  variant="cosmic-outline"
                  disabled={submitting}
                  onClick={() => void handleRate(rating)}
                  className="h-auto flex-col gap-0.5 py-3"
                >
                  <span className="font-medium">{label}</span>
                  <span className="text-xs text-white/60">{current.preview[rating]}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {(phase === "empty" || phase === "done") && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-8 text-center text-white backdrop-blur-xl">
          <p className="text-xl font-semibold">Wszystko powtórzone! 🎉</p>
          <p className="text-white/70">
            {phase === "done"
              ? `Powtórzono ${reviewed} ${reviewed === 1 ? "fiszkę" : "fiszek"}. Brak kolejnych na teraz.`
              : "Nie masz teraz żadnych fiszek do powtórki."}
          </p>
          <div className="flex justify-center gap-3">
            <Button variant="cosmic" asChild>
              <a href="/generate">Generuj fiszki</a>
            </Button>
            <Button variant="cosmic-outline" asChild>
              <a href="/collection">Moja kolekcja</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
