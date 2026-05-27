import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CandidateCard } from "./CandidateCard";
import type { FlashcardCandidate } from "@/types";

type ViewPhase = "idle" | "loading" | "review";

interface CandidateItem extends FlashcardCandidate {
  clientId: string;
  status: "pending" | "accepted" | "rejected";
  saving: boolean;
}

export function GenerateView() {
  const [phase, setPhase] = useState<ViewPhase>("idle");
  const [inputText, setInputText] = useState("");
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const wordCount = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;

  async function handleGenerate() {
    if (!inputText.trim()) {
      setInputError("Please enter some text to generate flashcards.");
      return;
    }
    setInputError(null);
    setError(null);
    setPhase("loading");

    try {
      const res = await fetch("/api/flashcards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: inputText }),
      });

      if (!res.ok) {
        throw new Error("Generation failed");
      }

      const json = (await res.json()) as { candidates: FlashcardCandidate[] };
      setCandidates(
        json.candidates.map((c) => ({
          ...c,
          clientId: crypto.randomUUID(),
          status: "pending",
          saving: false,
        })),
      );
      setPhase("review");
    } catch {
      setError("Something went wrong. Please try again.");
      setPhase("idle");
    }
  }

  async function handleAccept(clientId: string, candidate: FlashcardCandidate) {
    setCandidates((prev) => prev.map((c) => (c.clientId === clientId ? { ...c, saving: true } : c)));

    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: candidate.word, translation: candidate.translation, context: candidate.context }),
      });

      if (!res.ok) throw new Error("Save failed");

      setCandidates((prev) =>
        prev.map((c) => (c.clientId === clientId ? { ...c, status: "accepted", saving: false } : c)),
      );
    } catch {
      setCandidates((prev) => prev.map((c) => (c.clientId === clientId ? { ...c, saving: false } : c)));
    }
  }

  function handleReject(clientId: string) {
    setCandidates((prev) => prev.map((c) => (c.clientId === clientId ? { ...c, status: "rejected" } : c)));
  }

  const visibleCandidates = candidates.filter((c) => c.status !== "rejected");

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Generate Flashcards</h1>

      <div className="space-y-2">
        <Textarea
          placeholder="Paste foreign language text here…"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            if (inputError) setInputError(null);
          }}
          rows={6}
          disabled={phase === "loading"}
        />
        {inputError && <p className="text-sm text-red-600">{inputError}</p>}
        {wordCount > 300 && (
          <p className="text-sm text-amber-600">
            Long text ({wordCount} words) — generation may be slower or produce fewer results.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={() => void handleGenerate()} disabled={phase === "loading"}>
          {phase === "loading" ? "Generating…" : "Generate"}
        </Button>
      </div>

      {phase === "loading" && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {phase === "review" && visibleCandidates.length === 0 && (
        <div className="space-y-3 rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">No flashcard candidates found for this text.</p>
          <div className="flex justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setPhase("idle");
                setCandidates([]);
              }}
            >
              Try again
            </Button>
            <Button variant="ghost" disabled>
              Add manually
            </Button>
          </div>
        </div>
      )}

      {phase === "review" && visibleCandidates.length > 0 && (
        <div className="space-y-3">
          {visibleCandidates.map((item) => (
            <CandidateCard
              key={item.clientId}
              candidate={{ word: item.word, translation: item.translation, context: item.context }}
              status={item.status}
              saving={item.saving}
              onAccept={() => void handleAccept(item.clientId, item)}
              onReject={() => {
                handleReject(item.clientId);
              }}
              onSave={(updated) => void handleAccept(item.clientId, updated)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
