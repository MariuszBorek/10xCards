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
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-4">
          <p className="font-medium text-green-800">{candidate.word}</p>
          <p className="text-sm text-green-600">{candidate.translation}</p>
          {candidate.context && <p className="mt-1 text-xs text-green-500 italic">{candidate.context}</p>}
          <p className="mt-2 text-xs text-green-500">Saved</p>
        </CardContent>
      </Card>
    );
  }

  if (editing) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-4">
          <input
            className="w-full rounded border px-2 py-1 text-sm"
            value={word}
            onChange={(e) => {
              setWord(e.target.value);
            }}
            placeholder="Word"
          />
          <input
            className="w-full rounded border px-2 py-1 text-sm"
            value={translation}
            onChange={(e) => {
              setTranslation(e.target.value);
            }}
            placeholder="Translation"
          />
          <input
            className="w-full rounded border px-2 py-1 text-sm"
            value={context}
            onChange={(e) => {
              setContext(e.target.value);
            }}
            placeholder="Context (optional)"
          />
          <div className="flex gap-2">
            <Button
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
              variant="ghost"
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
    <Card>
      <CardContent className="pt-4">
        <p className="font-medium">{candidate.word}</p>
        <p className="text-muted-foreground text-sm">{candidate.translation}</p>
        {candidate.context && <p className="text-muted-foreground mt-1 text-xs italic">{candidate.context}</p>}
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={saving} onClick={onAccept}>
            {saving ? "Saving…" : "Accept"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
