import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { FlashcardCandidate } from "@/types";

interface CandidateCardProps {
  candidate: FlashcardCandidate;
  status: "pending" | "accepted" | "rejected";
  saving: boolean;
  onAccept: () => void;
  onReject: () => void;
  onSave: (updated: FlashcardCandidate) => void;
}

export function CandidateCard({ candidate, status, saving, onAccept, onReject, onSave }: CandidateCardProps) {
  const [editing, setEditing] = useState(false);
  const [word, setWord] = useState(candidate.word);
  const [translation, setTranslation] = useState(candidate.translation);
  const [context, setContext] = useState(candidate.context ?? "");

  if (status === "accepted") {
    return (
      <Card className="border-emerald-400/30 bg-emerald-400/10 text-white backdrop-blur-xl">
        <CardContent className="pt-4">
          <p className="font-medium text-white">{candidate.word}</p>
          <p className="text-sm text-white/70">{candidate.translation}</p>
          {candidate.context && <p className="mt-1 text-xs text-emerald-200/70 italic">{candidate.context}</p>}
          <p className="mt-2 text-xs font-medium text-emerald-300">✓ Saved</p>
        </CardContent>
      </Card>
    );
  }

  const editInputClass =
    "w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-sm text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:outline-none";

  if (editing) {
    return (
      <Card className="border-white/10 bg-white/10 text-white backdrop-blur-xl">
        <CardContent className="space-y-2 pt-4">
          <input
            className={editInputClass}
            value={word}
            onChange={(e) => {
              setWord(e.target.value);
            }}
            placeholder="Word"
          />
          <input
            className={editInputClass}
            value={translation}
            onChange={(e) => {
              setTranslation(e.target.value);
            }}
            placeholder="Translation"
          />
          <input
            className={editInputClass}
            value={context}
            onChange={(e) => {
              setContext(e.target.value);
            }}
            placeholder="Context (optional)"
          />
          <div className="flex gap-2">
            <Button
              variant="cosmic"
              size="sm"
              disabled={saving || !word.trim() || !translation.trim()}
              onClick={() => {
                onSave({ word: word.trim(), translation: translation.trim(), context: context.trim() || null });
              }}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="cosmic-ghost"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-white/10 bg-white/10 text-white backdrop-blur-xl">
      <CardContent className="pt-4">
        <p className="font-medium text-white">{candidate.word}</p>
        <p className="text-sm text-white/70">{candidate.translation}</p>
        {candidate.context && <p className="mt-1 text-xs text-white/60 italic">{candidate.context}</p>}
        <div className="mt-3 flex gap-2">
          <Button variant="cosmic" size="sm" disabled={saving} onClick={onAccept}>
            {saving ? "Saving…" : "Accept"}
          </Button>
          <Button
            size="sm"
            variant="cosmic-outline"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button size="sm" variant="cosmic-ghost" onClick={onReject}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
