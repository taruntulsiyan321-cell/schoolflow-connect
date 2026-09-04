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
 * ── THE FOUR RULINGS, AND WHERE EACH LANDED ───────────────────────────────
 *
 * 1. `mastery_score` — DELETED, not converged. It has no ladder in this file
 *    and will not get one. A count of "mastered concepts" shown to a student is
 *    §10.8 whatever the number beside it is, so converging the ladder would
 *    have made the violation tidier and permanent. The screens that showed it
 *    now show the OPEN-MISTAKES COUNT, which is the same data read from the
 *    side the product is allowed to look at. See `urgencyBand` below.
 *
 * 2. `accuracy` — one ladder, four boundaries, five rungs. The top two ARE the
 *    recovery readiness thresholds, so they import them rather than restate
 *    them.
 *
 * 3. `examsAvgPct` — SPLIT. The watchlist flag was never presentational; its
 *    number moved to thresholds.ts as `SUBJECT_AVERAGE_LOW`. The principal's
 *    distribution colour stayed here and imports it.
 *
 * 4. `score` — SPLIT into two ladders with two names, `riskBand` and
 *    `urgencyBand`, because one name was answering two questions.
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

import { ATTENDANCE_LOW, HOMEWORK_LOW, SUBJECT_AVERAGE_LOW } from "./thresholds";
import {
  RECOVERY_CONCEPTUAL_THRESHOLD,
  RECOVERY_PROCEDURAL_THRESHOLD,
} from "../recovery/constants";

/**
 * How a figure is drawn. Deliberately not a judgement of the student — `low`
 * describes the number, not the child.
 */
export type Band = "unknown" | "low" | "middle" | "high";

/**
 * The one null contract, for every ladder in this file regardless of how many
 * rungs it has.
 *
 * Returns the index of the band `value` falls in: 0 is below the first
 * boundary, `boundaries.length` is at or above the last. **`null` is -1**, and
 * -1 is not a rung — every caller maps it to `unknown`.
 *
 * This is the null contract in one place: `null < 60` is TRUE in JavaScript, so
 * every ad-hoc ladder in the app renders an unmeasured figure as its worst rung.
 * Four defects so far have had exactly that shape. Writing it once means a new
 * ladder cannot reintroduce it by forgetting.
 *
 * `boundaries` must be ascending. It is not sorted here on purpose: silently
 * repairing a mis-ordered ladder would hide the mistake, and a ladder whose
 * author got the order wrong has a bug that should be visible in its test.
 */
export function rungOf(
  value: number | null | undefined,
  boundaries: readonly number[],
): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return -1;
  let i = 0;
  while (i < boundaries.length && value >= boundaries[i]) i += 1;
  return i;
}

/** The generic three-rung ladder. `null` is `unknown`, never `low`. */
export function bandOf(
  value: number | null | undefined,
  lowBelow: number,
  middleBelow: number,
): Band {
  const RUNGS = ["low", "middle", "high"] as const;
  return RUNGS[rungOf(value, [lowBelow, middleBelow])] ?? "unknown";
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

// ── Accuracy — RULING 2 ────────────────────────────────────────────────────

/**
 * Homework HABIT — the sentence a teacher reads on a student card
 * ("Submits homework regularly" / "Inconsistent" / "a concern").
 *
 * A DIFFERENT QUESTION from "is completion low", which is HOMEWORK_LOW and
 * fires a flag. Habit describes a pattern over the term; the flag describes one
 * figure against a line. They are allowed different numbers precisely because
 * they answer different questions — and they live here, separately named, so
 * nobody later "reconciles" them into one and silently moves a flag.
 */
export const HOMEWORK_HABIT_REGULAR = 85;
export const HOMEWORK_HABIT_INCONSISTENT = 50;

/**
 * Accuracy over a practice or test session. One ladder, replacing seven
 * boundaries (40, 50, 55, 60, 70, 75, 80) spread across ten files.
 *
 * §10.8 permits the NUMBER — "session totals are stored (attempted, correct
 * count) so accuracy can be shown". It does not permit a list of topics headed
 * "Strong". So this bands the figure and carries no strength wording.
 *
 * THE TOP TWO BOUNDARIES ARE THE RECOVERY READINESS THRESHOLDS, imported rather
 * than written as 70 and 80. They are declared in `recovery/constants.ts` as
 * FRACTIONS (0.7, 0.8) and mirrored into the `recovery_constants` table, with
 * `npm run check:recovery-constants` proving the two homes agree. Multiplying by
 * 100 here is the unit conversion and nothing else — this file must not become
 * a third home for the values themselves.
 */
export const ACCURACY_LOW = 40;
export const ACCURACY_BUILDING = 60;
/** 70. The conceptual readiness bar, in percent. */
export const ACCURACY_CONCEPTUAL = RECOVERY_CONCEPTUAL_THRESHOLD * 100;
/** 80. The procedural readiness bar, in percent. */
export const ACCURACY_PROCEDURAL = RECOVERY_PROCEDURAL_THRESHOLD * 100;

export const ACCURACY_BOUNDARIES = [
  ACCURACY_LOW,
  ACCURACY_BUILDING,
  ACCURACY_CONCEPTUAL,
  ACCURACY_PROCEDURAL,
] as const;

/**
 * Five rungs, because four boundaries make five regions.
 *
 * The two top rungs are NOT named "conceptually ready" and "procedurally
 * ready", and that restraint is deliberate. Readiness is two separate rates
 * measured over different tiers — "procedural passing while conceptual fails is
 * the most common real result" — and a single blended accuracy figure cannot
 * tell you which. Naming the rungs after the bars would let one number claim
 * something only two numbers can say. The bars set where the colour changes;
 * they do not license the label.
 */
export type AccuracyBand = "unknown" | "low" | "weak" | "building" | "near" | "high";

const ACCURACY_RUNGS = ["low", "weak", "building", "near", "high"] as const;

export const accuracyBand = (v: number | null | undefined): AccuracyBand =>
  ACCURACY_RUNGS[rungOf(v, ACCURACY_BOUNDARIES)] ?? "unknown";

/** Words for an accuracy rung. The top is "On track" — the §10.8 line. */
export const ACCURACY_LABEL: Record<AccuracyBand, string> = {
  unknown: "—",
  low: "Needs focus",
  weak: "Needs work",
  building: "Building",
  near: "Almost on track",
  high: "On track",
};

export const ACCURACY_TONE: Record<
  AccuracyBand,
  "muted" | "alert" | "warning" | "positive"
> = {
  unknown: "muted",
  low: "alert",
  weak: "alert",
  building: "warning",
  near: "warning",
  high: "positive",
};

// ── Subject average — RULING 3, the colour half ────────────────────────────

/**
 * A student's exam or subject AVERAGE, drawn as a distribution.
 *
 * The flag half of this ruling is `SUBJECT_AVERAGE_LOW` in thresholds.ts. This
 * is the other half: the principal's five-bucket distribution, whose lowest
 * boundary is that same 40 and therefore imports it.
 *
 * The upper three (60 / 75 / 90) are the buckets `marks.BANDS` already uses for
 * the mark distribution, so a class read by average and a class read by
 * individual marks fall into the same five groups instead of two charts
 * disagreeing on the same page.
 */
export const SUBJECT_AVERAGE_BOUNDARIES = [SUBJECT_AVERAGE_LOW, 60, 75, 90] as const;

export type SubjectAverageBand = AccuracyBand;

export const subjectAverageBand = (v: number | null | undefined): SubjectAverageBand =>
  ACCURACY_RUNGS[rungOf(v, SUBJECT_AVERAGE_BOUNDARIES)] ?? "unknown";

// ── Score — RULING 4, two ladders and two names ────────────────────────────

/**
 * How at risk a percentage figure is. The readiness rings and the concept list
 * all asked this and all answered it separately.
 *
 * Boundaries 50 and 75 are the ones three of the four sites already used
 * (`ReadinessRing`, `SoftReadinessRing`, and the `ConceptMastery` component,
 * which ruling 1 deleted). The fourth, `ProgressRing` in
 * gurukul/components/shared.tsx, used 60 and 80 — it is converged onto these,
 * and it is worth recording that this changed nothing on screen, because
 * `ProgressRing` has no callers. Two of the seven `score` boundaries in the
 * survey existed only in a component nobody renders.
 */
export const RISK_LOW = 50;
export const RISK_COMFORTABLE = 75;
export const riskBand = (v: number | null | undefined): Band =>
  bandOf(v, RISK_LOW, RISK_COMFORTABLE);

/**
 * How urgently a queue item needs work. **A COUNT, NOT A PERCENTAGE** — this is
 * the ladder that used to read `mastery_score < 40 ? "high" : < 55 ? "medium"`.
 *
 * Ruling 1 deleted its input. What replaced it is the open-mistakes count, and
 * the boundaries come with it: `severityFromWrong` in lib/analyticsInsights.ts
 * already graded the same students by the same mistake counts at 2 and 4
 * (mild / moderate / critical). This is that ladder, named once.
 *
 * The direction is INVERTED against every other ladder in this file: more is
 * worse. That is why it is a separate function with a separate name rather than
 * another `bandOf` call — a reader who assumes "high is good" here would get it
 * exactly backwards, which is the confusion that made one `score` ladder answer
 * two questions in the first place.
 */
/**
 * Study streak, in days. EFFORT, not ability — §10.8 permits it, which is why
 * this is the one family in the survey that keeps its numbers instead of being
 * converged away. What it did not have was one home: `streak >= 3` was written
 * in three files and `streak < 15` in a fourth.
 *
 * STREAK_ESTABLISHED gates whether a consistency card is emitted at all.
 * STREAK_MILESTONE is the next target shown to a student still short of it.
 */
export const STREAK_ESTABLISHED = 3;
export const STREAK_MILESTONE = 15;

export const URGENCY_SOME = 2;
export const URGENCY_MANY = 4;

export type Urgency = "unknown" | "low" | "medium" | "high";

const URGENCY_RUNGS = ["low", "medium", "high"] as const;

export const urgencyBand = (openMistakes: number | null | undefined): Urgency =>
  URGENCY_RUNGS[rungOf(openMistakes, [URGENCY_SOME, URGENCY_MANY])] ?? "unknown";

// ── Labels and tones ───────────────────────────────────────────────────────

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
