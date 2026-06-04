import { describe, expect, it } from "vitest";
import { serializeAnkiField, buildAnkiTsv } from "@/lib/services/anki-export";

// Risk #7 — untrusted model/candidate output at the CSV/TSV sink.
//
// Pure-function coverage: no DB, no env, no Astro context → runs unconditionally
// (not gated on isSupabaseReachable()). Asserts the OUTCOME (an inert cell), never
// the implementation shape (lessons.md: assert behavior, not code path).

describe("serializeAnkiField — formula-injection neutralization (#7)", () => {
  it.each(["=", "+", "-", "@", "\t"])("prefixes a single apostrophe when the field begins with %j", (leader) => {
    const out = serializeAnkiField(`${leader}danger`);
    expect(out.startsWith("'")).toBe(true);
  });

  it("renders the classic spreadsheet exploit inert", () => {
    // A field that, unescaped, executes on import in Excel/LibreOffice.
    const out = serializeAnkiField("=cmd|'/c calc'!A1");
    expect(out.startsWith("'")).toBe(true);
    // Internal tab/CR/LF collapse still applies, but the leading `=` is neutralized.
    expect(out).toBe("'=cmd|'/c calc'!A1");
  });

  it("leaves benign fields unchanged", () => {
    expect(serializeAnkiField("hund")).toBe("hund");
  });

  it("does not treat an internal `-` as a formula leader", () => {
    // Only the FIRST character matters; a hyphen mid-word is benign.
    expect(serializeAnkiField("self-study")).toBe("self-study");
  });

  it("collapses internal tab/CR/LF to spaces to preserve TSV structure", () => {
    expect(serializeAnkiField("a\tb\nc\rd")).toBe("a b c d");
  });

  it("collapses an empty field to empty (no false neutralization)", () => {
    expect(serializeAnkiField("")).toBe("");
  });
});

describe("buildAnkiTsv — document structure (#7)", () => {
  it("emits the #separator:tab header first", () => {
    const doc = buildAnkiTsv([{ word: "hund", translation: "dog", context: null }]);
    expect(doc.split("\n")[0]).toBe("#separator:tab");
  });

  it("emits one tab-delimited line per row with three fields", () => {
    const doc = buildAnkiTsv([
      { word: "hund", translation: "dog", context: "der Hund" },
      { word: "katze", translation: "cat", context: null },
    ]);
    const lines = doc.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1].split("\t")).toEqual(["hund", "dog", "der Hund"]);
    expect(lines[2].split("\t")).toEqual(["katze", "cat", ""]);
  });

  it("neutralizes a dangerous field while building the document", () => {
    const doc = buildAnkiTsv([{ word: "=evil()", translation: "dog", context: null }]);
    const dataLine = doc.split("\n")[1];
    expect(dataLine.split("\t")[0]).toBe("'=evil()");
  });
});
