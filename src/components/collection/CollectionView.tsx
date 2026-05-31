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

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/flashcards/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `anki-export-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/flashcards/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    setFlashcards((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          My Collection
        </h1>
        <Button
          variant="cosmic-outline"
          onClick={() => void handleExport()}
          disabled={loading || flashcards.length === 0 || exporting}
          title={flashcards.length === 0 ? "No flashcards to export" : undefined}
        >
          {exporting ? "Exporting…" : "Export to Anki"}
        </Button>
      </div>
      {exportError && <p className="text-sm text-red-300">{exportError}</p>}

      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-4 text-white backdrop-blur-xl">
        <h2 className="font-medium text-white">Add flashcard</h2>
        <Input
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            if (addError) setAddError(null);
          }}
          placeholder="Word"
          disabled={adding}
          className="border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/40"
        />
        <Input
          value={translation}
          onChange={(e) => {
            setTranslation(e.target.value);
            if (addError) setAddError(null);
          }}
          placeholder="Translation"
          disabled={adding}
          className="border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/40"
        />
        <Textarea
          value={context}
          onChange={(e) => {
            setContext(e.target.value);
          }}
          placeholder="Context (optional)"
          rows={2}
          disabled={adding}
          className="border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/40"
        />
        {addError && <p className="text-sm text-red-300">{addError}</p>}
        <Button variant="cosmic" onClick={() => void handleAdd()} disabled={adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl bg-white/10" />
          ))}
        </div>
      )}

      {!loading && fetchError && <p className="text-sm text-red-300">{fetchError}</p>}

      {!loading && !fetchError && flashcards.length === 0 && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-6 text-center text-white backdrop-blur-xl">
          <p className="text-white/70">Your collection is empty.</p>
          <Button variant="cosmic-outline" asChild>
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
