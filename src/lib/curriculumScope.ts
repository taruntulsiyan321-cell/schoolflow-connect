/**
 * Student curriculum scope helpers — class level + stream subject allowlists.
 * Applies for EVERY class level: bank queries always filter by the student's
 * class_level (10 → 10, 11 → 11, 12 → 12). Senior stream allowlists (commerce /
 * science) apply only for Class 11–12 so lower classes keep age-appropriate subjects.
 */

/**
 * EVERY class level the platform teaches. ONE home for the domain.
 *
 * §10.9 names the smallest one explicitly: "a Class 5 student is only ever
 * served Class 5 content for their own board." The seeded curriculum agrees —
 * `curriculum_classes` holds Class 5 with 4 subjects and 55 chapters, and 2,189
 * Class 5 questions sit in `question_bank`.
 *
 * IT USED TO BE 6–12, IN SIX PLACES: `parseClassLevel` below, the
 * `class_level` branches of `taxonomy/canonicalize` and `taxonomy/humanize`,
 * the `CLASS_LEVELS` array in `taxonomy/registry`,
 * `ncertSyllabus.parseClassGrade`, and the `ClassLevel` union in
 * `taxonomy/types` — each carrying its own literal `(6|7|8|9|10|11|12)`. A
 * Class 5 label therefore parsed to `null` in all six, so the tag filter §10.9
 * depends on had nothing to filter by, and `20260821120000` archived all 2,189
 * Class 5 questions on the stated grounds that they were "outside the app's
 * ClassLevel domain". The domain was the thing that was wrong.
 *
 * Ordered DESCENDING because it is joined into a regex alternation: with `\b`
 * anchors either order matches, but longest-first is the habit that survives
 * someone later removing the anchors.
 */
export const CLASS_LEVELS = [12, 11, 10, 9, 8, 7, 6, 5] as const;

/** A class level the platform teaches. Derived — never re-listed. */
export type ClassLevel = (typeof CLASS_LEVELS)[number];

/** Ascending, for anything that renders the list to a person. */
export const CLASS_LEVELS_ASCENDING: readonly ClassLevel[] =
  [...CLASS_LEVELS].sort((a, b) => a - b);

/** Built from CLASS_LEVELS so the pattern and the list cannot drift apart. */
export const CLASS_LEVEL_PATTERN = new RegExp(`\\b(${CLASS_LEVELS.join("|")})\\b`);

/** True when a number is a class level the platform teaches. */
export function isClassLevel(n: unknown): n is ClassLevel {
  return typeof n === "number" && (CLASS_LEVELS as readonly number[]).includes(n);
}

export const COMMERCE_SUBJECT_ALLOWLIST = [
  "Accountancy",
  "Business Studies",
  "Economics",
  "Mathematics",
  "English",
  "Hindi",
] as const;

/** Senior science stream (Class 11–12) — symmetric with commerce. */
export const SCIENCE_SUBJECT_ALLOWLIST = [
  "Physics",
  "Chemistry",
  "Biology",
  "Mathematics",
  "English",
  "Hindi",
] as const;

/** Subjects that must never appear for commerce stream (11–12). */
export const COMMERCE_BLOCKED_SUBJECTS = [
  "biology",
  "chemistry",
  "physics",
  "science",
  "computer science",
  "informatics practices",
  "ip",
  "social studies",
  "sst",
  "general knowledge",
] as const;

const SUBJECT_ALIASES: Record<string, string> = {
  accountancy: "Accountancy",
  accounts: "Accountancy",
  accounting: "Accountancy",
  "business studies": "Business Studies",
  bst: "Business Studies",
  "business studies (bst)": "Business Studies",
  economics: "Economics",
  eco: "Economics",
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
  english: "English",
  "english core": "English",
  hindi: "Hindi",
  "hindi core": "Hindi",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  science: "Science",
  "computer science": "Computer Science",
  "informatics practices": "Informatics Practices",
};

export type AcademicStream = "commerce" | "science" | "arts" | "agriculture" | "other";

export type CurriculumScope = {
  classLevel: number | null;
  board: string;
  stream: AcademicStream | null;
  classLabel: string | null;
};

/** Parse class level from digits or Roman numerals (e.g. "Class-10", "Std 9", "XI-A", "V-B"). */
export function parseClassLevel(label?: string | null): number | null {
  if (!label) return null;
  const text = String(label);
  const m = text.match(CLASS_LEVEL_PATTERN);
  if (m) return Number(m[1]);
  // Longest-first, and it matters: with "X" ahead of "XII" the alternation
  // matches the X in XII and a Class 12 label reads as Class 10.
  const roman = text.toUpperCase().match(/\b(XII|XI|IX|VIII|VII|VI|X|V)\b/);
  if (!roman) return null;
  const romanLevels: Record<string, number> = {
    V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
  };
  return romanLevels[roman[1]] ?? null;
}

export function normalizeStream(raw?: string | null): AcademicStream | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("commerce") || s === "com" || s === "bcom") return "commerce";
  if (s.includes("science") || s === "pcm" || s === "pcb" || s === "pcmb") return "science";
  if (s.includes("art") || s.includes("humanit")) return "arts";
  if (s.includes("agri")) return "agriculture";
  if (s === "other") return "other";
  return null;
}

/** Infer stream from free-text class labels / categories. */
export function inferStreamFromText(...parts: Array<string | null | undefined>): AcademicStream | null {
  for (const p of parts) {
    const n = normalizeStream(p);
    if (n) return n;
  }
  return null;
}

export function normalizeSubjectName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  return SUBJECT_ALIASES[key] ?? trimmed;
}

export function isCommerceBlockedSubject(subject: string): boolean {
  const key = normalizeSubjectName(subject).toLowerCase();
  return (COMMERCE_BLOCKED_SUBJECTS as readonly string[]).includes(key);
}

export function isCommerceAllowedSubject(subject: string): boolean {
  if (!subject?.trim()) return false;
  if (isCommerceBlockedSubject(subject)) return false;
  const canonical = normalizeSubjectName(subject);
  return COMMERCE_SUBJECT_ALLOWLIST.some((s) => s.toLowerCase() === canonical.toLowerCase());
}

export function isScienceAllowedSubject(subject: string): boolean {
  if (!subject?.trim()) return false;
  const canonical = normalizeSubjectName(subject);
  return SCIENCE_SUBJECT_ALLOWLIST.some((s) => s.toLowerCase() === canonical.toLowerCase());
}

/**
 * Commerce allowlist applies for commerce stream at Class 11–12.
 * Lower classes keep general secondary subjects even if the school is commerce-tagged.
 * When class is unresolved, apply allowlist conservatively (never dump science).
 */
export function appliesCommerceSubjectAllowlist(
  stream: AcademicStream | null | undefined,
  classLevel: number | null | undefined,
): boolean {
  if (stream !== "commerce") return false;
  if (classLevel == null) return true;
  return classLevel >= 11;
}

/**
 * Science allowlist applies for science stream at Class 11–12 only.
 * Class ≤10 keeps general subjects (e.g. Science) even if school is science-tagged.
 */
export function appliesScienceSubjectAllowlist(
  stream: AcademicStream | null | undefined,
  classLevel: number | null | undefined,
): boolean {
  if (stream !== "science") return false;
  if (classLevel == null) return true;
  return classLevel >= 11;
}

function orderAllowlist(
  seen: Map<string, string>,
  allowlist: readonly string[],
): string[] {
  return allowlist.filter((s) => seen.has(s.toLowerCase())).map((s) => seen.get(s.toLowerCase())!);
}

/** Filter subject names for the student's stream (preserve display casing from bank). */
export function filterSubjectsForStream(
  subjects: string[],
  stream: AcademicStream | null | undefined,
  classLevel?: number | null,
): string[] {
  const level = classLevel ?? null;
  if (appliesCommerceSubjectAllowlist(stream, level)) {
    const seen = new Map<string, string>();
    for (const raw of subjects) {
      if (!isCommerceAllowedSubject(raw)) continue;
      const canonical = normalizeSubjectName(raw);
      const key = canonical.toLowerCase();
      if (!seen.has(key)) seen.set(key, canonical);
    }
    return orderAllowlist(seen, COMMERCE_SUBJECT_ALLOWLIST);
  }
  if (appliesScienceSubjectAllowlist(stream, level)) {
    const seen = new Map<string, string>();
    for (const raw of subjects) {
      if (!isScienceAllowedSubject(raw)) continue;
      const canonical = normalizeSubjectName(raw);
      const key = canonical.toLowerCase();
      if (!seen.has(key)) seen.set(key, canonical);
    }
    return orderAllowlist(seen, SCIENCE_SUBJECT_ALLOWLIST);
  }
  return subjects.filter((s) => s.trim().length > 0);
}

/** Subject chips for create-battle / challenge / doubt pickers. */
export function subjectsForStreamPicker(
  stream: AcademicStream | null | undefined,
  classLevel: number | null | undefined,
  fallback: string[] = ["Mathematics", "English"],
): string[] {
  if (appliesCommerceSubjectAllowlist(stream, classLevel)) {
    return [...COMMERCE_SUBJECT_ALLOWLIST];
  }
  if (appliesScienceSubjectAllowlist(stream, classLevel)) {
    return [...SCIENCE_SUBJECT_ALLOWLIST];
  }
  return fallback.length ? fallback : ["Mathematics"];
}

export function isSubjectAllowedForScope(
  subject: string,
  stream: AcademicStream | null | undefined,
  classLevel?: number | null,
): boolean {
  if (!subject || subject === "Mixed" || subject === "General") return true;
  const level = classLevel ?? null;
  if (appliesCommerceSubjectAllowlist(stream, level)) {
    return isCommerceAllowedSubject(subject);
  }
  if (appliesScienceSubjectAllowlist(stream, level)) {
    return isScienceAllowedSubject(subject);
  }
  return true;
}
