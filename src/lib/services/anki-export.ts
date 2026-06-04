import type { Flashcard } from "@/types";

/** Leading characters a spreadsheet/Anki import treats as the start of a formula. */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t"]);

/**
 * Serialize one field for the `#separator:tab` Anki export.
 *
 * Two jobs, in order:
 *  1. Neutralize formula injection — if the first character is `=`, `+`, `-`, `@`,
 *     or a tab, prepend a single `'` so the cell opens as literal text instead of
 *     being evaluated as a formula on spreadsheet/Anki import (#7, CSV/TSV sink).
 *  2. Preserve TSV structure — collapse internal tab/CR/LF to spaces so a field
 *     cannot break the row/column layout. This is the pre-existing escapeField
 *     behavior; the bug we fix is only the missing leading-character neutralization.
 *
 * Benign fields pass through unchanged.
 */
export function serializeAnkiField(value: string): string {
  const collapsed = value.replace(/[\t\n\r]/g, " ");
  if (value.length > 0 && FORMULA_LEADERS.has(value[0])) {
    return `'${collapsed}`;
  }
  return collapsed;
}

/**
 * Build the full `#separator:tab` Anki document from flashcard rows, neutralizing
 * every field via {@link serializeAnkiField}. Pure: no DB, no env, no I/O.
 */
export function buildAnkiTsv(rows: Pick<Flashcard, "word" | "translation" | "context">[]): string {
  const lines = rows.map(
    (f) =>
      `${serializeAnkiField(f.word)}\t${serializeAnkiField(f.translation)}\t${serializeAnkiField(f.context ?? "")}`,
  );
  return ["#separator:tab", ...lines].join("\n");
}
