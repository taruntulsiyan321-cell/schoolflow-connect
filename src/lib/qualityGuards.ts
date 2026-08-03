/**
 * Engineering guardrails for student-panel integrity.
 * Aggregation helpers + generic-label filters (Analysis / Home charts).
 * Used by unit tests and quality:scan / quality:student-context.
 */

import { normalizeSubjectName } from "@/lib/curriculumScope";
import { displaySubject, isPlaceholderAcademicLabel } from "@/lib/academicDisplay";

/** @deprecated Prefer isPlaceholderAcademicLabel — kept as alias for older call sites. */
export const GENERIC_ACADEMIC_LABELS = new Set([
  "subject",
  "topic",
  "daily",
  "general",
  "concept",
  "chapter",
  "mixed",
  "weak",
  "incorrect",
  "skipped",
  "timed",
]);

export function isGenericAcademicLabel(raw: string | null | undefined): boolean {
  return isPlaceholderAcademicLabel(raw);
}

/** Prefer a real label; never invent Subject/Topic/Daily/General. */
export function preferRealAcademicLabel(
  ...candidates: Array<string | null | undefined>
): string {
  for (const c of candidates) {
    if (!isGenericAcademicLabel(c)) return String(c).trim();
  }
  return "";
}

export type SubjectAggPoint = { name: string; accuracy: number; attempts: number };

/**
 * Collapse Maths/Math/Mathematics (etc.) into one chart row via curriculum aliases,
 * then present through taxonomy displaySubject. Drops generic placeholder subjects.
 */
export function dedupeSubjectChartPoints(subjects: SubjectAggPoint[]): SubjectAggPoint[] {
  const merged = new Map<
    string,
    { name: string; weightedAcc: number; attempts: number; unweightedAcc: number; unweightedN: number }
  >();

  for (const s of subjects) {
    if (isGenericAcademicLabel(s.name)) continue;
    const canon = normalizeSubjectName(s.name) || s.name.trim();
    if (!canon || isGenericAcademicLabel(canon)) continue;
    const presented = displaySubject(canon) || canon;
    if (!presented || isGenericAcademicLabel(presented)) continue;
    const key = presented.toLowerCase();
    const cur = merged.get(key) ?? {
      name: presented,
      weightedAcc: 0,
      attempts: 0,
      unweightedAcc: 0,
      unweightedN: 0,
    };
    const weight = Math.max(0, Number(s.attempts) || 0);
    if (weight > 0) {
      cur.weightedAcc += s.accuracy * weight;
      cur.attempts += weight;
    } else {
      cur.unweightedAcc += s.accuracy;
      cur.unweightedN += 1;
    }
    merged.set(key, cur);
  }

  return [...merged.values()]
    .map((row) => {
      if (row.attempts > 0) {
        return {
          name: row.name,
          attempts: row.attempts,
          accuracy: Math.round(row.weightedAcc / row.attempts),
        };
      }
      return {
        name: row.name,
        attempts: 0,
        accuracy: row.unweightedN > 0 ? Math.round(row.unweightedAcc / row.unweightedN) : 0,
      };
    })
    .sort((a, b) => b.accuracy - a.accuracy);
}

/**
 * Radar axis labels: unique short names from already-deduped subject rows.
 * Never truncates multiple subjects onto the same tick (e.g. repeated "Math").
 */
export function buildSubjectRadarPoints(
  rows: Array<{ name: string; score: number }>,
): Array<{ subject: string; score: number; fullName: string }> {
  const used = new Set<string>();
  const out: Array<{ subject: string; score: number; fullName: string }> = [];

  for (const row of rows) {
    if (isGenericAcademicLabel(row.name)) continue;
    const fullName = displaySubject(row.name) || row.name.trim();
    if (!fullName || isGenericAcademicLabel(fullName)) continue;

    let short =
      fullName.length <= 5
        ? fullName
        : fullName.includes(" ")
          ? fullName
              .split(/\s+/)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("")
              .slice(0, 4) || fullName.slice(0, 4)
          : fullName.slice(0, 4);

    if (used.has(short.toLowerCase())) {
      short = fullName.slice(0, 6);
      let n = 2;
      while (used.has(short.toLowerCase())) {
        short = `${fullName.slice(0, 3)}${n++}`;
      }
    }
    used.add(short.toLowerCase());
    out.push({ subject: short, score: row.score, fullName });
  }
  return out;
}

/** Demo XP / level fingerprints that must stay off product paths. */
export const XP_INVENT_PATTERNS: RegExp[] = [
  /\bxp:\s*1382\b/i,
  /\bxp:\s*8420\b/i,
  /\blevel:\s*14\b/i,
  /Arjun\s+Sharma/,
  /Priya\s+Nair/,
];

export function hasXpInventFingerprint(source: string): boolean {
  const codeish = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return XP_INVENT_PATTERNS.some((re) => re.test(codeish));
}
