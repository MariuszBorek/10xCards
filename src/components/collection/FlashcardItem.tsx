import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Flashcard } from "@/types";

interface Props {
  flashcard: Flashcard;
  onUpdate: (id: string, patch: { word: string; translation: string; context: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function FlashcardItem({ flashcard, onUpdate, onDelete }: Props) {
  const [mode, setMode] = useState<"view" | "editing">("view");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [word, setWord] = useState(flashcard.word);
  const [translation, setTranslation] = useState(flashcard.translation);
  const [context, setContext] = useState(flashcard.context ?? "");

  function handleEdit() {
    setWord(flashcard.word);
    setTranslation(flashcard.translation);
    setContext(flashcard.context ?? "");
    setError(null);
    setMode("editing");
  }

  function handleCancel() {
    setMode("view");
    setError(null);
  }

  async function handleSave() {
    if (!word.trim() || !translation.trim()) {
      setError("Word and translation are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdate(flashcard.id, {
        word: word.trim(),
        translation: translation.trim(),
        context: context.trim() || null,
      });
      setMode("view");
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    setSaving(true);
    try {
      await onDelete(flashcard.id);
    } catch {
      setError("Failed to delete. Please try again.");
      setDeleteOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        {mode === "view" ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">{flashcard.word}</p>
              <p className="text-muted-foreground">{flashcard.translation}</p>
              {flashcard.context && <p className="text-muted-foreground text-sm">{flashcard.context}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={handleEdit}>
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={word}
              onChange={(e) => {
                setWord(e.target.value);
              }}
              placeholder="Word"
              disabled={saving}
            />
            <Input
              value={translation}
              onChange={(e) => {
                setTranslation(e.target.value);
              }}
              placeholder="Translation"
              disabled={saving}
            />
            <Textarea
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
              }}
              placeholder="Context (optional)"
              rows={2}
              disabled={saving}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && mode === "view" && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </CardContent>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete flashcard?</DialogTitle>
            <DialogDescription>
              This will permanently remove &ldquo;{flashcard.word}&rdquo;. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDelete()} disabled={saving}>
              {saving ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
