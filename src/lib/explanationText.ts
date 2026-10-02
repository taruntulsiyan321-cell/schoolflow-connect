/**
 * An explanation, read for display.
 *
 * The bank's explanations are moving to the ruled shape (owner, 2026-10-02;
 * supabase/functions/_shared/explanationFormat.ts writes it, the database's
 * explanation_is_proper checks it):
 *
 *     Answer: (B) <the right option>
 *
 *     <the working>
 *
 *     Why the other options are wrong:
 *     (A) <why>
 *
 * Until question-explanations has rewritten every question, older ones are
 * plain text; AI answers (Explain my mistake) are paragraphs. Both are read
 * here — one home, so every screen shows an explanation the same way.
 */
const HEADING = "Why the other options are wrong:";

export type ReadExplanation =
  | {
      kind: "structured";
      answer: { letter: string; text: string };
      /** Paragraphs, each a list of lines (steps). */
      working: string[][];
      wrong: Array<{ letter: string; reason: string }>;
    }
  | { kind: "plain"; paragraphs: string[][] };

function paragraphs(text: string): string[][] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length > 0);
}

export function readExplanation(raw: unknown): ReadExplanation | null {
  const text = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return null;
  const head = text.match(/^Answer: \(([A-H])\) ([^\n]+)\n\n/);
  const at = text.indexOf(`\n\n${HEADING}\n`);
  if (head && at > head[0].length - 2) {
    const working = paragraphs(text.slice(head[0].length, at));
    const wrong = text
      .slice(at + HEADING.length + 3)
      .split("\n")
      .map((l) => l.trim().match(/^\(([A-H])\) (.+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ letter: m[1], reason: m[2] }));
    if (working.length > 0 && wrong.length > 0) {
      return { kind: "structured", answer: { letter: head[1], text: head[2] }, working, wrong };
    }
  }
  return { kind: "plain", paragraphs: paragraphs(text) };
}
