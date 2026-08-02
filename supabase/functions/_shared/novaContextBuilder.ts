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

/** Curriculum subject aliases — collapse Math/Maths → Mathematics etc. */
const SUBJECT_ALIASES: Record<string, string> = {
  math: "Mathematics",
  maths: "Mathematics",
  mathematics: "Mathematics",
  accounts: "Accountancy",
  accounting: "Accountancy",
  accountancy: "Accountancy",
  bst: "Business Studies",
  "business studies": "Business Studies",
  eco: "Economics",
  economics: "Economics",
  "english core": "English",
  english: "English",
  "hindi core": "Hindi",
  hindi: "Hindi",
};

export function canonicalizeSubjectLabel(raw: string): string {
  const key = normalizeLabelKey(raw);
  return SUBJECT_ALIASES[key] ?? String(raw).trim();
}

export function dedupeSubjects(subjects: Array<string | null | undefined>, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of subjects) {
    if (raw == null) continue;
    const label = canonicalizeSubjectLabel(String(raw));
    if (isPlaceholderLabel(label)) continue;
    const key = normalizeLabelKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}
