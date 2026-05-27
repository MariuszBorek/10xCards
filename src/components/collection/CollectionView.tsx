import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { FlashcardItem } from "./FlashcardItem";
import type { Flashcard } from "@/types";

export function CollectionView() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState("");
  const [context, setContext] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    async function fetchFlashcards() {
      try {
        const res = await fetch("/api/flashcards");
        if (!res.ok) throw new Error("Failed to load");
        const json = (await res.json()) as { flashcards: Flashcard[] };
        setFlashcards(json.flashcards);
      } catch {
        setFetchError("Failed to load flashcards. Please refresh.");
      } finally {
        setLoading(false);
      }
    }
    void fetchFlashcards();
  }, []);

  async function handleAdd() {
    if (!word.trim()) {
      setAddError("Word is required.");
      return;
    }
    if (!translation.trim()) {
      setAddError("Translation is required.");
      return;
    }
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: word.trim(),
          translation: translation.trim(),
          context: context.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const json = (await res.json()) as { flashcard: Flashcard };
      setFlashcards((prev) => [json.flashcard, ...prev]);
      setWord("");
      setTranslation("");
      setContext("");
    } catch {
      setAddError("Failed to add flashcard. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdate(id: string, patch: { word: string; translation: string; context: string | null }) {
    const res = await fetch(`/api/flashcards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("Update failed");
    const json = (await res.json()) as { flashcard: Flashcard };
    setFlashcards((prev) => prev.map((f) => (f.id === id ? json.flashcard : f)));
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/flashcards/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    setFlashcards((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">My Collection</h1>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Add flashcard</h2>
        <Input
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            if (addError) setAddError(null);
          }}
          placeholder="Word"
          disabled={adding}
        />
        <Input
          value={translation}
          onChange={(e) => {
            setTranslation(e.target.value);
            if (addError) setAddError(null);
          }}
          placeholder="Translation"
          disabled={adding}
        />
        <Textarea
          value={context}
          onChange={(e) => {
            setContext(e.target.value);
          }}
          placeholder="Context (optional)"
          rows={2}
          disabled={adding}
        />
        {addError && <p className="text-sm text-red-600">{addError}</p>}
        <Button onClick={() => void handleAdd()} disabled={adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && fetchError && <p className="text-sm text-red-600">{fetchError}</p>}

      {!loading && !fetchError && flashcards.length === 0 && (
        <div className="space-y-3 rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Your collection is empty.</p>
          <Button variant="outline" asChild>
            <a href="/generate">Generate flashcards with AI</a>
          </Button>
        </div>
      )}

      {!loading && flashcards.length > 0 && (
        <div className="space-y-3">
          {flashcards.map((f) => (
            <FlashcardItem key={f.id} flashcard={f} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
