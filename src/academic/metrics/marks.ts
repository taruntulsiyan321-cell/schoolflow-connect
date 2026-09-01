/**
 * CHUNK 10 — marks metrics. One function per metric. Pure.
 *
 * THE RULE THAT SHAPES ALL OF THIS: a percentage of a 25-mark test and a
 * percentage of a 100-mark exam are not the same measurement, and averaging them
 * as if they were is the marks version of averaging attendance ratios. Every
 * average here is computed from summed marks over summed maximums, never from a
 * mean of per-exam percentages.
 *
 * BELOW PASS uses `exams.passing_marks`, per exam, and it is NULL on 5 of 18
 * exams. Where NULL the answer is `no_data` and no flag fires — the ruling, and
 * the reason the previous hardcoded 40 was not a threshold but a mask over
 * missing data on 28% of exams.
 */

import { type Metric, ok, noData, notMarked, pct, count } from "./types";
import { CLASS_FLAGGED_ON_MARKS, MARKS_OVERDUE, belowPass } from "./thresholds";

/** One mark, with the exam it belongs to. */
export interface MarkRow {
  studentId: string;
  examId: string;
  subject?: string | null;
  /** Null means the mark has not been entered — not a zero. */
  scored: number | null;
  maxMarks: number | null;
  passingMarks: number | null;
}

/** An exam, for the activity metrics that ask what is outstanding. */
export interface ExamRow {
  examId: string;
  examDate: string | null;
  subject?: string | null;
  /** Students expected to have a mark for this exam. */
  expected: number;
  entered: number;
}

const scorable = (m: MarkRow): boolean =>
  m.scored !== null && m.maxMarks !== null && m.maxMarks > 0;

// ── Averages ───────────────────────────────────────────────────────────────

/**
 * Average across marks: summed scored over summed maximum.
 *
 * NOT the mean of per-exam percentages. A student who scored 5/10 and 90/100
 * averaged as percentages reads 70%; as marks it is 95/110 = 86.4%, which is
 * what they actually got.
 */
export function markAverage(marks: MarkRow[]): Metric<number> {
  if (marks.length === 0) return noData("no marks");

  const usable = marks.filter(scorable);
  if (usable.length === 0) {
    return notMarked(`${marks.length} mark row(s), none with a score and a maximum`);
  }
  const scored = usable.reduce((a, m) => a + (m.scored as number), 0);
  const max = usable.reduce((a, m) => a + (m.maxMarks as number), 0);
  return pct(scored, max, `${scored} of ${max} mark(s) across ${usable.length} entry(ies)`);
}

/** One student's average. */
export function studentAverage(marks: MarkRow[], studentId: string): Metric<number> {
  return markAverage(marks.filter((m) => m.studentId === studentId));
}

/** Average per subject, worst first. */
export function averageBySubject(
  marks: MarkRow[],
): Metric<{ subject: string; pct: number; entries: number }[]> {
  if (marks.length === 0) return noData("no marks");

  const bySubject = new Map<string, MarkRow[]>();
  for (const m of marks) {
    const s = (m.subject ?? "").trim();
    if (!s) continue;
    bySubject.set(s, [...(bySubject.get(s) ?? []), m]);
  }
  if (bySubject.size === 0) return noData("no mark carries a subject");

  const out: { subject: string; pct: number; entries: number }[] = [];
  for (const [subject, rows] of bySubject) {
    const m = markAverage(rows);
    if (m.state !== "ok") continue;
    out.push({ subject, pct: m.value, entries: rows.filter(scorable).length });
  }
  if (out.length === 0) return notMarked(`${bySubject.size} subject(s), none with entered marks`);
  out.sort((a, b) => a.pct - b.pct);
  return ok(out, `${out.length} subject(s) with entered marks`);
}

// ── Distribution and below-pass ────────────────────────────────────────────

/** Fixed bands, so two screens cannot disagree about what "good" is. */
export const BANDS = [
  { label: "below 40", min: 0, max: 40 },
  { label: "40–59", min: 40, max: 60 },
  { label: "60–74", min: 60, max: 75 },
  { label: "75–89", min: 75, max: 90 },
  { label: "90+", min: 90, max: 101 },
] as const;

export function distribution(marks: MarkRow[]): Metric<{ label: string; count: number }[]> {
  const usable = marks.filter(scorable);
  if (marks.length === 0) return noData("no marks");
  if (usable.length === 0) return notMarked(`${marks.length} mark row(s), none entered`);

  const counts = BANDS.map((b) => ({ label: b.label, count: 0 }));
  for (const m of usable) {
    const p = ((m.scored as number) / (m.maxMarks as number)) * 100;
    const i = BANDS.findIndex((b) => p >= b.min && p < b.max);
    if (i >= 0) counts[i].count += 1;
  }
  return ok(counts, `${usable.length} entered mark(s)`);
}

/**
 * How many students are below pass, and out of how many the question could be
 * answered for.
 *
 * The denominator is marks where `passing_marks` IS set. An exam with no pass
 * mark is not "everyone passed"; it is a question nobody can answer, and it is
 * reported as excluded rather than silently counted as fine.
 */
export function belowPassCount(marks: MarkRow[]): Metric<{
  below: number;
  answerable: number;
  excludedNoPassMark: number;
}> {
  if (marks.length === 0) return noData("no marks");

  let below = 0;
  let answerable = 0;
  let excluded = 0;
  for (const m of marks) {
    const v = belowPass(m.scored, m.passingMarks, m.maxMarks);
    if (v.state !== "ok") {
      if (m.scored !== null && m.passingMarks === null) excluded += 1;
      continue;
    }
    answerable += 1;
    if (v.value) below += 1;
  }
  if (answerable === 0) {
    return notMarked(
      `${marks.length} mark row(s), none answerable` +
        (excluded ? `; ${excluded} have a score but no passing_marks` : ""),
    );
  }
  return ok(
    { below, answerable, excludedNoPassMark: excluded },
    `${below} below pass of ${answerable} answerable mark(s)` +
      (excluded ? `; ${excluded} excluded — exams.passing_marks not set` : ""),
  );
}

/** Is a section flagged? §10: 25% or more of students below pass. */
export function sectionFlaggedOnMarks(marks: MarkRow[]): Metric<boolean> {
  const c = belowPassCount(marks);
  if (c.state !== "ok") return { state: c.state, value: null, basis: c.basis };
  const share = (c.value.below / c.value.answerable) * 100;
  return ok(
    share >= CLASS_FLAGGED_ON_MARKS,
    `${Math.round(share * 10) / 10}% below pass against a ${CLASS_FLAGGED_ON_MARKS}% threshold, ` +
      `over ${c.value.answerable} answerable mark(s)`,
  );
}

// ── Movement and rank ──────────────────────────────────────────────────────

/**
 * Movement between two exams, in percentage points.
 *
 * Both sides must be answerable. A student who sat one exam and not the other
 * has not moved; comparing against a missing mark as if it were zero would
 * manufacture a collapse.
 */
export function movement(
  earlier: MarkRow[],
  later: MarkRow[],
  studentId: string,
): Metric<number> {
  const a = studentAverage(earlier, studentId);
  const b = studentAverage(later, studentId);
  if (a.state !== "ok" || b.state !== "ok") {
    return noData(
      `movement needs both exams answerable (earlier: ${a.state}, later: ${b.state})`,
    );
  }
  return ok(
    Math.round((b.value - a.value) * 10) / 10,
    `${b.value}% against ${a.value}%`,
  );
}

/**
 * Rank within a section, by average.
 *
 * Ties share a rank (1, 2, 2, 4) — competition ranking. Students whose average
 * is not answerable are UNRANKED rather than ranked last: an unentered mark is
 * not a low one, and putting them at the bottom of a list a parent might see is
 * the same defect as counting an unmarked register as absent.
 */
export function rankWithinSection(marks: MarkRow[]): Metric<{
  ranked: { studentId: string; pct: number; rank: number }[];
  unranked: string[];
}> {
  if (marks.length === 0) return noData("no marks");

  const byStudent = new Map<string, MarkRow[]>();
  for (const m of marks) byStudent.set(m.studentId, [...(byStudent.get(m.studentId) ?? []), m]);

  const scored: { studentId: string; pct: number }[] = [];
  const unranked: string[] = [];
  for (const [studentId, rows] of byStudent) {
    const avg = markAverage(rows);
    if (avg.state === "ok") scored.push({ studentId, pct: avg.value });
    else unranked.push(studentId);
  }
  if (scored.length === 0) {
    return notMarked(`${byStudent.size} student(s), none with an answerable average`);
  }

  scored.sort((a, b) => b.pct - a.pct);
  const ranked: { studentId: string; pct: number; rank: number }[] = [];
  let lastPct: number | null = null;
  let lastRank = 0;
  scored.forEach((s, i) => {
    const rank = lastPct !== null && s.pct === lastPct ? lastRank : i + 1;
    lastPct = s.pct;
    lastRank = rank;
    ranked.push({ ...s, rank });
  });

  return ok(
    { ranked, unranked },
    `${ranked.length} ranked` + (unranked.length ? `, ${unranked.length} unranked (no answerable average)` : ""),
  );
}

// ── Activity ───────────────────────────────────────────────────────────────

/** Exams whose marks are not fully entered, and how long they have been late. */
export function marksPending(
  exams: ExamRow[],
  today: string,
): Metric<{ examId: string; missing: number; daysSince: number | null }[]> {
  if (exams.length === 0) return noData("no exams");

  const now = new Date(`${today}T00:00:00Z`).getTime();
  const pending = exams
    .filter((e) => e.entered < e.expected)
    .map((e) => {
      const t = e.examDate ? new Date(`${e.examDate}T00:00:00Z`).getTime() : NaN;
      return {
        examId: e.examId,
        missing: e.expected - e.entered,
        daysSince: Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null,
      };
    });
  return ok(pending, `${pending.length} of ${exams.length} exam(s) incomplete`);
}

/** Pending beyond the overdue threshold — the ones a principal should chase. */
export function marksOverdue(
  exams: ExamRow[],
  today: string,
): Metric<{ examId: string; missing: number; daysSince: number }[]> {
  const p = marksPending(exams, today);
  if (p.state !== "ok") return { state: p.state, value: null, basis: p.basis };

  const overdue = p.value
    .filter((e): e is { examId: string; missing: number; daysSince: number } =>
      e.daysSince !== null && e.daysSince > MARKS_OVERDUE)
    .sort((a, b) => b.daysSince - a.daysSince);
  const undated = p.value.filter((e) => e.daysSince === null).length;

  return ok(
    overdue,
    `${overdue.length} exam(s) more than ${MARKS_OVERDUE} day(s) past the exam date` +
      (undated ? `; ${undated} pending exam(s) have no exam_date and cannot be aged` : ""),
  );
}

/** Exams conducted in the window — a count, where zero is a real answer. */
export function examsConducted(exams: ExamRow[]): Metric<number> {
  return count(exams.length, `${exams.length} exam(s)`);
}
