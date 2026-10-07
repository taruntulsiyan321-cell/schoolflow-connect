/**
 * Engineering guardrails for student-panel integrity.
 * Aggregation helpers + generic-label filters (Analysis / Home charts).
 * Used by unit tests and quality:scan / quality:student-context.
 */

import { displaySubject, isPlaceholderAcademicLabel } from "@/lib/academicDisplay";

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
