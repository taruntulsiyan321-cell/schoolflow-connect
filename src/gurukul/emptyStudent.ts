/**
 * Honest empty student shape for Gurukul chrome.
 * Never use mock Arjun / invented XP as a fallback.
 *
 * XP / level / study streak: ProgressionService (rpc_get_student_progression).
 *
 * TWO RULES THIS SHAPE EXISTS TO ENFORCE
 * --------------------------------------
 *
 * 1. A METRIC FIELD SAYS WHICH METRIC IT IS.
 *
 *    This type used to carry a field called `accuracy`, and nothing about the
 *    name said which of the two accuracies it held. The docstring here claimed
 *    `exam_readiness.accuracy_pct` — the blend of test and practice. The code
 *    that fills it (StudentDashboard) has always set
 *    `practiceAccuracyFromSnapshot(snapshot)` — practice alone.
 *
 *    So the comment and the code disagreed, and three screens each guessed:
 *    Home labelled it "Practice accuracy" (right, by luck), LearningHub
 *    labelled the same value "Overall Accuracy" (wrong), and Battleground read
 *    `shellReady ? profile.accuracy : data.stats.accuracy` — PRACTICE while the
 *    shell was ready and the BLEND while it was not, so one tile showed two
 *    different metrics depending on a loading flag.
 *
 *    The field is now `practiceAccuracy`. A screen that wants the blend must
 *    say `overallAccuracyFromSnapshot` and mean it.
 *
 * 2. ABSENCE IS `null`, NEVER `0`.
 *
 *    Every metric here was a plain `number` defaulting to 0, so "this student
 *    has never attempted anything" and "this student got everything wrong"
 *    were the same value by the time any screen saw them. That is ruling 8,
 *    broken at the source rather than on each screen — which is why each
 *    screen kept needing its own `has…()` guard bolted on beside it.
 *
 *    Absence-capable metrics are `number | null` and default to null. A real
 *    zero still travels as 0, because that one is a mark.
 *
 * Six fields were written here and read by nothing, and are gone: `rollNo`,
 * `section`, `reputation`, `totalQuestions`, `correctAnswers`, `avgSpeed`.
 * `attendance` went with them — its only apparent callers were the AI
 * capability id `student.attendance.query`, which is a string, not this field.
 */
export type GurukulStudentProfile = {
  name: string;
  firstName: string;
  class: string;
  avatar: string;
  xp: number;
  level: number;
  /** XP remaining to next level (engine). */
  xpToNext: number;
  /** XP earned within current level (engine). */
  xpIntoLevel: number;
  /** 0–100 progress within level (engine). */
  levelProgressPct: number;
  league: string;
  /** Consecutive study days (engine). 0 is a real answer: no streak. */
  streak: number;
  /**
   * Class rank. 0 is the established "not ranked" sentinel here and every read
   * site already tests `rank > 0`, so this stays a number.
   */
  rank: number;
  /** Class size behind `rank`. 0 means unknown. */
  totalStudents: number;
  /**
   * PRACTICE accuracy only — `exam_readiness.practice_accuracy_pct` via
   * `practiceAccuracyFromSnapshot`. NOT the test+practice blend; that is
   * `overallAccuracyFromSnapshot`, and it does not live on this profile.
   * null when the student has attempted nothing.
   */
  practiceAccuracy: number | null;
  /** Distinct active days in the last 7. 0 is a real answer: none. */
  sessionsThisWeek: number;
  goal: string;
};

export const EMPTY_STUDENT: GurukulStudentProfile = {
  name: "Student",
  firstName: "Student",
  class: "",
  avatar: "ST",
  xp: 0,
  level: 1,
  xpToNext: 100,
  xpIntoLevel: 0,
  levelProgressPct: 0,
  league: "",
  streak: 0,
  rank: 0,
  totalStudents: 0,
  practiceAccuracy: null,
  sessionsThisWeek: 0,
  goal: "",
};
