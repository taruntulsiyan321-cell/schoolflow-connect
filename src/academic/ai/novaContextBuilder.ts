/**
 * Nova Context Builder — UI chips + label hygiene for student.nova.chat.
 * Deduplicates subjects/chips; never emits placeholder/demo labels.
 * Progression streak must be study_streak (not battle current_streak).
 */

/** Labels that must never appear as Nova context chips or subject previews. */
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

export type NovaChip = {
  id: string;
  label: string;
  color: string;
};

export type NovaUiContextInput = {
  classLabel?: string | null;
  section?: string | null;
  subjects?: string[] | null;
  homeworkPending?: number | null;
  attendancePct?: number | null;
  practiceSessions?: number | null;
  mistakeCount?: number | null;
  recoveryPending?: number | null;
  xp?: number | null;
  level?: number | null;
  /** Study streak only — never battle win/current streak. */
  studyStreak?: number | null;
  weakConcepts?: string[] | null;
  goal?: string | null;
};

const CHIP_COLORS = {
  class: "#3b5bdb",
  progression: "#6882e8",
  streak: "#c08a3a",
  weak: "#cc5069",
  homework: "#4b9fd4",
  attendance: "#4aa87a",
  practice: "#6882e8",
  mistakes: "#cc5069",
  recovery: "#c08a3a",
  subject: "#3b5bdb",
  goal: "#4aa87a",
} as const;

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
  // Bare numeric / punctuation noise
  if (/^[\d\W_]+$/.test(s)) return true;
  return false;
}

/** Case-insensitive subject/chip dedupe; drops placeholders; preserves first casing. */
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

/**
 * Build unique Nova UI chips from live academic signals.
 * Empty / zero / missing → omit chip (never invent demo values).
 */
export function buildNovaUiChips(input: NovaUiContextInput): NovaChip[] {
  const chips: NovaChip[] = [];
  const usedKeys = new Set<string>();

  const push = (id: string, label: string, color: string) => {
    if (isPlaceholderLabel(label)) return;
    const key = normalizeLabelKey(label);
    if (usedKeys.has(key)) return;
    usedKeys.add(key);
    chips.push({ id, label, color });
  };

  const classBits = [input.classLabel, input.section]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter((x) => x && !isPlaceholderLabel(x));
  // Avoid "Class Class 11" / duplicate section already in classLabel
  let classLabel = "";
  if (classBits.length) {
    const joined = classBits.join(" · ");
    const alreadyHasClass = /^class\b/i.test(classBits[0]!);
    classLabel = alreadyHasClass ? joined : `Class ${joined}`;
  }
  if (classLabel) push("class", classLabel, CHIP_COLORS.class);

  const xp = Number(input.xp ?? 0);
  const level = Number(input.level ?? 1);
  if (xp > 0 || level > 1) {
    push("progression", `Lv ${level} · ${xp.toLocaleString()} XP`, CHIP_COLORS.progression);
  }

  const streak = Number(input.studyStreak ?? 0);
  if (streak > 0) push("streak", `${streak}d study streak`, CHIP_COLORS.streak);

  const att = input.attendancePct;
  if (att != null && Number.isFinite(att) && Number(att) > 0) {
    push("attendance", `Attendance ${Math.round(Number(att))}%`, CHIP_COLORS.attendance);
  }

  const hw = Number(input.homeworkPending ?? 0);
  if (hw > 0) push("homework", `${hw} HW pending`, CHIP_COLORS.homework);

  const practice = Number(input.practiceSessions ?? 0);
  if (practice > 0) push("practice", `${practice} practice`, CHIP_COLORS.practice);

  const mistakes = Number(input.mistakeCount ?? 0);
  if (mistakes > 0) push("mistakes", `${mistakes} mistakes`, CHIP_COLORS.mistakes);

  const recovery = Number(input.recoveryPending ?? 0);
  if (recovery > 0) push("recovery", `${recovery} recovery`, CHIP_COLORS.recovery);

  const weak = dedupeLabels(input.weakConcepts ?? [], 2);
  for (let i = 0; i < weak.length; i++) {
    push(`weak-${i}`, `Weak: ${weak[i]}`, CHIP_COLORS.weak);
  }

  if (input.goal && !isPlaceholderLabel(input.goal)) {
    push("goal", String(input.goal).trim(), CHIP_COLORS.goal);
  }

  const subjects = dedupeSubjects(input.subjects ?? [], 3);
  for (let i = 0; i < subjects.length; i++) {
    // Skip subject if already shown as goal / class chip
    push(`subject-${i}`, subjects[i]!, CHIP_COLORS.subject);
  }

  return chips;
}

/** One-line context string for the Nova pill (deduped, no placeholders). */
export function buildNovaContextLine(input: NovaUiContextInput): string {
  return buildNovaUiChips(input)
    .map((c) => c.label)
    .join(" · ");
}
