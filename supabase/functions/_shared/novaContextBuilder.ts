/**
 * Edge Nova Context Builder — mirror of src/academic/ai/novaContextBuilder.ts
 * Deduplicate subjects/labels; never emit placeholder chips in packs.
 */

const PLACEHOLDER_LABELS = new Set(
  [
    "",
    "—",
    "-",
    "n/a",
    "na",
    "none",
    "null",
    "undefined",
    "general",
    "subject",
    "subjects",
    "topic",
    "topics",
    "concept",
    "concepts",
    "daily",
    "sample",
    "demo",
    "fake",
    "mock",
    "test",
    "lorem",
    "placeholder",
    "random",
    "unknown",
    "student",
    "class",
  ].map((s) => s.toLowerCase()),
);

export function normalizeLabelKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isPlaceholderLabel(raw: unknown): boolean {
  if (raw == null) return true;
  const s = String(raw).trim();
  if (!s) return true;
  if (PLACEHOLDER_LABELS.has(normalizeLabelKey(s))) return true;
  if (/^[\d\W_]+$/.test(s)) return true;
  return false;
}

export function dedupeLabels(labels: Array<string | null | undefined>, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    if (raw == null) continue;
    const label = String(raw).trim();
    if (isPlaceholderLabel(label)) continue;
    const key = normalizeLabelKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

export function dedupeSubjects(subjects: Array<string | null | undefined>, limit = 12): string[] {
  return dedupeLabels(subjects, limit);
}
