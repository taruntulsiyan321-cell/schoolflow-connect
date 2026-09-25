/**
 * An MCQ's options as text, without the labels the page printed before them.
 * Pure: no Deno. Both readers of a student's own questions use it (upload
 * classifier, screen capture) so an option is stored as its text alone.
 *
 * Measured 2026-09-25: a captured Physics Wallah question was stored with
 * options "(A) Unity of Direction", "(B) Unity of Command", … and practised
 * as "A (A) Unity of Direction" — the app adds its own letters.
 *
 * Labels are removed only when EVERY option carries one, in order — (A) (B)
 * (C) (D), a. b. c., 1) 2) 3) — so an option that merely begins with a letter
 * and a full stop ("A. B. Smith") is left alone.
 */
const LABEL = /^\s*[([]?\s*([A-Za-z]|\d{1,2})\s*[)\].:]\s*/;

function ordinal(label: string): number {
  return /^\d+$/.test(label) ? Number(label) - 1 : label.toLowerCase().charCodeAt(0) - 97;
}

export function stripOptionLabels(options: ReadonlyArray<string>): string[] {
  if (options.length < 2) return [...options];
  const labels = options.map((o) => LABEL.exec(o)?.[1] ?? null);
  const inOrder = labels.every((l, i) => l !== null && ordinal(l) === i);
  if (!inOrder) return [...options];
  return options.map((o) => o.replace(LABEL, "").trim());
}
