/**
 * CHUNK 10 — presentational bands. One module, one ladder each.
 *
 * A BAND IS NOT A THRESHOLD. Nothing fires on these: no flag is raised, no
 * student appears on a list, no principal is asked to act. They decide how red a
 * number is drawn and what word sits beside it. That is why they live here and
 * not in thresholds.ts, which holds only numbers that trigger something.
 *
 * They still need one home. The survey found the same ladder written at
 * different boundaries across the app —
 *
 *     accuracy        40, 50, 55, 60, 70, 75, 80    across 15 files
 *     mastery_score   40, 45, 55, 60, 62, 75, 78    across 6
 *     score           50, 55, 60, 65, 70, 75, 80    across 8
 *
 * — which means "weak" begins at 40 on one screen and 55 on the next, for the
 * same child looking at the same subject.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 *
 * There is no "strong", "mastered", "proficient" or "excellent" rung anywhere in
 * this file, and there will not be one.
 *
 * §10.8: **"Strong areas are never shown anywhere in the app. The product
 * surfaces weaknesses only."**
 *
 * Chunk 7B closed that rule in the database — `_snapshot_battle_report` computed
 * topics.strong and three policies served it. The client half was never swept,
 * and 43 sites still surface strengths on reachable screens. Converging those
 * ladders onto a module with a "Strong" rung would have made the violation
 * tidier and more permanent. So the ladders here stop at the top of the range
 * they are allowed to describe, and the strength surfaces are reported
 * separately rather than absorbed.
 *
 * ── BOUNDARIES THAT COINCIDE WITH A THRESHOLD MUST IMPORT IT ──────────────
 *
 * Where a band boundary is the same number as a real threshold, it imports the
 * constant. Otherwise changing ATTENDANCE_LOW moves the flag and leaves the
 * colour behind, and the screen says "fine" in amber.
 */

import { ATTENDANCE_LOW, HOMEWORK_LOW } from "./thresholds";

/**
 * How a figure is drawn. Deliberately not a judgement of the student — `low`
 * describes the number, not the child.
 */
export type Band = "unknown" | "low" | "middle" | "high";

/**
 * The generic ladder. `null` is `unknown`, never `low`.
 *
 * This is the null contract in one place: `null < 60` is TRUE in JavaScript, so
 * every ad-hoc ladder in the app renders an unmeasured figure as its worst rung.
 * Four defects so far have had exactly that shape.
 */
export function bandOf(
  value: number | null | undefined,
  lowBelow: number,
  middleBelow: number,
): Band {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  if (value < lowBelow) return "low";
  if (value < middleBelow) return "middle";
  return "high";
}

/**
 * Attendance. The `low` boundary IS the threshold — a figure drawn as
 * comfortable while the student is flagged would be two answers to one question.
 */
export const ATTENDANCE_COMFORTABLE = 85;
export const attendanceBand = (v: number | null | undefined): Band =>
  bandOf(v, ATTENDANCE_LOW, ATTENDANCE_COMFORTABLE);

/** Homework completion. Same rule: the low boundary is the threshold. */
export const HOMEWORK_COMFORTABLE = 75;
export const homeworkBand = (v: number | null | undefined): Band =>
  bandOf(v, HOMEWORK_LOW, HOMEWORK_COMFORTABLE);

/**
 * Accuracy over a practice or test session.
 *
 * §10.8 permits the NUMBER — "session totals are stored (attempted, correct
 * count) so accuracy can be shown". It does not permit a list of topics headed
 * "Strong". So this bands the figure and carries no strength wording.
 */
export const ACCURACY_LOW = 40;
export const ACCURACY_MIDDLE = 75;
export const accuracyBand = (v: number | null | undefined): Band =>
  bandOf(v, ACCURACY_LOW, ACCURACY_MIDDLE);

/**
 * A subject or concept average.
 *
 * AWAITING A RULING, and named so it cannot be mistaken for settled. 40 is the
 * value the principal screens have always used for a subject AVERAGE. It is not
 * `exams.passing_marks`, which is per-exam and answers a different question, and
 * the build document's threshold list does not name it.
 */
export const SUBJECT_AVERAGE_LOW_AWAITING_RULING = 40;
export const SUBJECT_AVERAGE_MIDDLE = 60;
export const subjectAverageBand = (v: number | null | undefined): Band =>
  bandOf(v, SUBJECT_AVERAGE_LOW_AWAITING_RULING, SUBJECT_AVERAGE_MIDDLE);

/**
 * Words for a band, for screens that need one.
 *
 * The top rung is "on track", not "strong" or "mastered". That is the §10.8 line
 * held at the one place a label is produced: a screen importing this cannot
 * accidentally tell a student what they are good at.
 */
export const BAND_LABEL: Record<Band, string> = {
  unknown: "—",
  low: "Needs focus",
  middle: "Building",
  high: "On track",
};

/** Semantic colour role, for design systems that map their own palette. */
export const BAND_TONE: Record<Band, "muted" | "alert" | "warning" | "positive"> = {
  unknown: "muted",
  low: "alert",
  middle: "warning",
  high: "positive",
};
