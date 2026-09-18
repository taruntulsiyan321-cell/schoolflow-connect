/**
 * Student Analysis derivation — pure metrics from real attempts / sessions / activity.
 * Never invent peer ranks, mistake-type splits, or placeholder zeros that imply movement.
 */

import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ChapterStateRow, RecoveryQueueRow } from "@/academic";
import type {
  PracticeTrendPoint,
  WeeklyActivityPoint,
  SubjectChartPoint,
} from "@/hooks/useStudentPerformanceCharts";
import { normalizeSubjectName } from "@/lib/curriculumScope";
import { accuracyBand } from "@/academic/metrics/bands";
import {
  REVISION_STAGES_TO_SOLID,
  TREND_DELTA_POINTS,
  TREND_MIN_SESSIONS,
  type TrendState,
} from "@/academic/recovery/constants";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicDisplay";
import {
  buildSubjectRadarPoints,
  dedupeSubjectChartPoints,
  isGenericAcademicLabel,
  preferRealAcademicLabel,
} from "@/lib/qualityGuards";

export { buildSubjectRadarPoints, dedupeSubjectChartPoints };

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function subjectSessionKey(raw: string | null | undefined): string {
  if (!raw || isGenericAcademicLabel(raw)) return "";
  const canon = normalizeSubjectName(raw) || raw.trim();
  const presented = displaySubject(canon) || canon;
  return presented ? presented.toLowerCase() : "";
}

/**
 * A date-only string ("2026-09-14") as LOCAL midnight.
 *
 * `new Date("2026-09-14")` is UTC midnight, not local — the one-line rule the
 * ECMAScript spec applies to date-only forms. Every consumer here then
 * compares it against a local midnight from startOfDay, and west of Greenwich
 * that UTC instant falls on the PREVIOUS local day, so a day's activity lands
 * in the wrong bucket and the last day of a window drops out of it entirely.
 *
 * academic_daily_activity.activity_date is a calendar date the student lived
 * through, not an instant, so local midnight is what it means.
 */
function dateOnlyToLocal(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Mon..Sun, in DAY_LABELS' own vocabulary.
 *
 * This returned `toLocaleDateString(undefined, { weekday: "short" })` and every
 * caller then looked the result up in DAY_LABELS, which is English. On a
 * browser set to any other language the lookup never matches: buildWeekComparison
 * bucketed nothing and the "this week vs last week" chart drew seven zeros for
 * a student who had practised all week. Same for the Analysis study-time bars.
 *
 * The label is a KEY here, not display text. It is computed from the date, not
 * from the runtime's locale.
 */
export function weekdayLabel(dateStr: string): string {
  const d = dateOnlyToLocal(dateStr);
  // getDay() is 0 = Sunday; DAY_LABELS starts at Monday.
  return DAY_LABELS[(d.getDay() + 6) % 7];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysAgo(n: number, from = new Date()): Date {
  const d = startOfDay(from);
  d.setDate(d.getDate() - n);
  return d;
}

function accuracyOf(session: PracticeSessionSummary): number {
  return session.accuracy_pct;
}

/**
 * Seconds per question for one session — or null when nothing timed it.
 *
 * `measured_ms`, not a wall-clock duration. The wall-clock fallback this used
 * to receive was a seeded 18-minute constant on 240 of 284 sessions, which
 * made every figure derived here a function of the question count alone.
 */
function sessionSecPerQuestion(session: PracticeSessionSummary): number | null {
  if (session.question_count <= 0) return null;
  if (session.measured_ms == null) return null;
  const sec = session.measured_ms / 1000 / session.question_count;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.round(sec);
}

/**
 * Average accuracy of the first half vs second half of chronologically
 * ordered sessions, in accuracy points.
 *
 * §6.4 / TREND_MIN_SESSIONS: "Declaring a trend from two sessions is noise
 * dressed as insight." This used to compute a delta from as few as TWO
 * sessions and hand it straight to the screen, which drew a green up-arrow
 * and a percentage off one session against one other. Below the floor there
 * is no trend to report and this returns null — the NOT_ENOUGH_DATA state,
 * which `trendState` names and the screen renders distinctly from "steady".
 */
export function halfWindowTrend(accuracies: number[]): number | null {
  if (accuracies.length < TREND_MIN_SESSIONS) return null;
  const mid = Math.floor(accuracies.length / 2);
  const early = accuracies.slice(0, mid);
  const late = accuracies.slice(mid);
  if (early.length === 0 || late.length === 0) return null;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.round((avg(late) - avg(early)) * 10) / 10;
}

/**
 * The §6.4 trend state for a run of session accuracies.
 *
 * Three facts the screen has to tell apart, and a nullable number cannot:
 *
 *   not_enough_data  fewer than TREND_MIN_SESSIONS sessions — nothing to say
 *   stuck            enough sessions, movement under TREND_DELTA_POINTS
 *   improving /      enough sessions, movement at or over the threshold
 *   worsening
 *
 * "stuck" is the honest answer for a student who has practised eight times
 * and moved two points, and it is NOT the same answer as "you have not
 * practised enough for me to tell". Rendering both as a dash — which is what
 * a bare `number | null` forced — told the second student nothing and the
 * first student something false.
 *
 * `deltaPoints` is null only for not_enough_data; a stuck chapter still
 * carries its (small) real movement for anything that wants to show it.
 */
export function trendState(accuracies: number[]): {
  state: TrendState;
  deltaPoints: number | null;
} {
  const delta = halfWindowTrend(accuracies);
  if (delta == null) return { state: "not_enough_data", deltaPoints: null };
  if (Math.abs(delta) < TREND_DELTA_POINTS) return { state: "stuck", deltaPoints: delta };
  return { state: delta > 0 ? "improving" : "worsening", deltaPoints: delta };
}

/** This week vs previous week activity totals by weekday (Mon–Sun). */
export function buildWeekComparison(
  weekly: WeeklyActivityPoint[],
  now = new Date(),
): { day: string; thisWeek: number; lastWeek: number }[] {
  const thisStart = daysAgo(6, now);
  const lastStart = daysAgo(13, now);
  const lastEnd = daysAgo(7, now);

  const thisByDay = new Map<string, number>();
  const lastByDay = new Map<string, number>();

  for (const row of weekly) {
    const d = dateOnlyToLocal(row.date);
    const label = weekdayLabel(row.date);
    if (d >= thisStart) {
      thisByDay.set(label, (thisByDay.get(label) ?? 0) + (row.total ?? 0));
    } else if (d >= lastStart && d <= lastEnd) {
      lastByDay.set(label, (lastByDay.get(label) ?? 0) + (row.total ?? 0));
    }
  }

  return DAY_LABELS.map((day) => ({
    day,
    thisWeek: thisByDay.get(day) ?? 0,
    lastWeek: lastByDay.get(day) ?? 0,
  }));
}

export type DerivedSubjectRow = {
  name: string;
  accuracy: number;
  questions: number;
  /**
   * Measured study minutes across this subject's TIMED sessions, or null when
   * none of them was timed.
   *
   * Was `timeHrs`, a number of hours pre-rounded to one decimal in this
   * module. Two problems, one root: rounding a measurement here means the
   * renderer cannot choose an honest unit (6 minutes arrived as 0.1h and
   * printed as "0.1h study time"), and a `number` cannot say "nobody timed
   * this", so an untimed subject rendered as zero hours of work.
   */
  measuredMinutes: number | null;
  /** Movement in accuracy points. Null unless the §6.4 floor is met. */
  trend: number | null;
  /** §6.4. Distinguishes "steady" from "not enough data"; trend alone cannot. */
  trendState: TrendState;
  /**
   * §10.8 — the "best" rung is GONE, not renamed. It drove a "Best subject"
   * badge on the Analysis screen: a list filtered to the highest and a figure
   * presented as an achievement, which is both halves of the forbidden column.
   * A rung nothing can reach is still a rung the next screen can render, so it
   * is removed from the union rather than left unused.
   */
  status: "needs-attention" | "steady";
};

export function deriveSubjectRows(
  subjects: SubjectChartPoint[],
  sessions: PracticeSessionSummary[],
): DerivedSubjectRow[] {
  const deduped = dedupeSubjectChartPoints(subjects);
  const bySubject = new Map<string, PracticeSessionSummary[]>();
  for (const s of [...sessions].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  )) {
    const key = subjectSessionKey(s.subject);
    if (!key) continue;
    const list = bySubject.get(key) ?? [];
    list.push(s);
    bySubject.set(key, list);
  }

  return deduped.map((s) => {
    const accuracy = Math.round(s.accuracy);
    const sess = bySubject.get(s.name.toLowerCase()) ?? [];
    // Only the sessions that were actually timed. Summing an unmeasured
    // session as zero would under-report; summing a wall clock over it would
    // invent time the student never spent. Null when none of them was timed,
    // so the row can say nothing rather than say "0h".
    const timedSess = sess.filter((x) => x.measured_ms != null);
    const measuredMinutes =
      timedSess.length > 0
        ? Math.round(timedSess.reduce((sum, x) => sum + (x.measured_ms ?? 0), 0) / 60000)
        : null;
    const { state: subjectTrendState, deltaPoints } = trendState(sess.map(accuracyOf));
    return {
      name: s.name,
      accuracy,
      questions: s.attempts,
      measuredMinutes,
      trend: deltaPoints,
      trendState: subjectTrendState,
      // Converged onto the one accuracy ladder: this asked "< 65", which was a
      // boundary no other screen used and the ruling does not carry.
      status: ["low", "weak"].includes(accuracyBand(accuracy)) ? "needs-attention" : "steady",
    };
  });
}

export type DerivedChapterRow = {
  chapter: string;
  subject: string;
  // `practiceDepth` WENT FROM HERE. It was min(100, attempts / 5 * 100) —
  // progress toward MIN_ATTEMPTS_FOR_ACCURACY — and Analysis renamed it
  // `completion`, printed it as "20% Practice" and drew it as a full-width
  // progress bar under the chapter's name. A student reads that as "I have
  // covered a fifth of this chapter". It was never syllabus coverage, the
  // type comment said so, and the screen said the opposite.
  //
  // `questions` below is the same fact without the arithmetic: the number of
  // attempts, which is what the card shows now.
  accuracy: number;
  questions: number;
  /** Movement in accuracy points. Null unless the §6.4 floor is met. */
  trend: number | null;
  /** §6.4. Distinguishes "steady" from "not enough data"; trend alone cannot. */
  trendState: TrendState;
  status: "ready" | "practice-more" | "needs-work";
};

export function deriveChapterRows(
  mastery: ConceptMasteryItem[],
  sessions: PracticeSessionSummary[],
  snapshot?: AcademicSnapshot | null,
): DerivedChapterRow[] {
  const byChapter = new Map<string, PracticeSessionSummary[]>();
  for (const sess of [...sessions].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  )) {
    const subjKey = subjectSessionKey(sess.subject);
    const chapterLabel = preferRealAcademicLabel(sess.chapter);
    if (!subjKey || !chapterLabel) continue;
    const key = `${subjKey}::${chapterLabel.toLowerCase()}`;
    const list = byChapter.get(key) ?? [];
    list.push(sess);
    byChapter.set(key, list);
  }

  // ── ONE CARD PER CHAPTER. ────────────────────────────────────────────────
  //
  // This mapped concept_mastery rows ONE TO ONE onto cards, under the heading
  // "Chapter by chapter", taking `chapter ?? concept` as the card's title and
  // then slicing the first twelve. concept_mastery holds a row per CONCEPT,
  // so measured for one student on 2026-09-17:
  //
  //     20 concept rows across 6 chapters  ->  12 cards:
  //       Polynomials             x6  (0%, 40%, 40%, 20%, 36%, 33%)
  //       Arithmetic Progressions x4
  //       Probability             x1
  //       ...and Introduction to Trigonometry (94%), Quadratic Equations
  //       (88%) and Pair of Linear Equations (42%) shown NOWHERE, cut off by
  //       the slice.
  //
  // So the student saw one chapter six times with six different accuracies,
  // and three of their six chapters not at all. Grouping is not a display
  // nicety here: the ungrouped figures are per-concept numbers wearing a
  // chapter's name, which is the same level confusion as `c.chapter AS topic`
  // in _weak_topics_for_user, in the other direction.
  //
  // Attempts and correct answers are SUMMED and the rate taken once over the
  // totals — pooled, never the mean of the concepts' rates.
  const byChapterKey = new Map<
    string,
    { chapter: string; subject: string; attempts: number; correct: number; masteryScores: number[] }
  >();
  for (const m of mastery) {
    const chapterRaw = preferRealAcademicLabel(m.chapter, m.concept);
    const subjectRaw = preferRealAcademicLabel(m.subject);
    if (!chapterRaw || !subjectRaw) continue;
    const chapter = displayChapter(chapterRaw) || chapterRaw;
    const subjectCanon = normalizeSubjectName(subjectRaw) || subjectRaw;
    const subject = displaySubject(subjectCanon) || subjectCanon;
    if (!chapter || !subject || isGenericAcademicLabel(chapter) || isGenericAcademicLabel(subject)) {
      continue;
    }
    const key = `${subject.toLowerCase()}::${chapter.toLowerCase()}`;
    const entry = byChapterKey.get(key) ?? {
      chapter,
      subject,
      attempts: 0,
      correct: 0,
      masteryScores: [] as number[],
    };
    entry.attempts += m.total_attempts ?? 0;
    entry.correct += m.correct_attempts ?? 0;
    entry.masteryScores.push(m.mastery_score);
    byChapterKey.set(key, entry);
  }

  const fromMastery = [...byChapterKey.values()]
    // A CHAPTER NOBODY HAS ATTEMPTED HAS NO ACCURACY.
    //
    // concept_mastery carries rows at total_attempts = 0 — measured for one
    // student, 9 of them, every one English. The old fallback gave those rows
    // `Math.round(mastery_score)`, which is 0 for an untouched concept, so the
    // grid drew five chapters reading "Needs attention · 0% Practice · 0%
    // Accuracy" for chapters the student has never opened. That is 0% invented
    // out of an absence — the same defect as scoring an unattempted session
    // zero — and it carries a JUDGEMENT ("needs attention") that G7 says is
    // not made on one attempt, let alone none.
    //
    // The slice used to hide them by accident. Ordering weakest-first, which
    // is what stops a cap dropping the chapters that matter, put all five at
    // the TOP of the tab instead. They are not weak; they are unmeasured, and
    // "Topics yet to begin" is the panel that says so.
    .filter((entry) => entry.attempts > 0)
    .map((entry) => {
      const accuracy = Math.round((100 * entry.correct) / entry.attempts);
      const key = `${entry.subject.toLowerCase()}::${entry.chapter.toLowerCase()}`;
      const sessList = byChapter.get(key) ?? [];
      const { state: chapterTrendState, deltaPoints } = trendState(sessList.map(accuracyOf));
      return {
        chapter: entry.chapter,
        subject: entry.subject,
        accuracy,
        questions: entry.attempts,
        trend: deltaPoints,
        trendState: chapterTrendState,
        // Converged: 75/55 were this file's own boundaries for the same figure
        // the subject rows above band at 40/60/70/80.
        status: (["high", "near"].includes(accuracyBand(accuracy))
          ? "ready"
          : accuracyBand(accuracy) === "building"
            ? "practice-more"
            : "needs-work") as DerivedChapterRow["status"],
      };
    })
    // Weakest first. The slice below is a cap on how much the grid shows, and
    // an arbitrary order made it cut whichever chapters happened to sort last
    // — which is how three chapters vanished. §10.8 forbids a list filtered to
    // the strongest; ordering so the weakest survive a cap is the opposite.
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 12);
  if (fromMastery.length > 0) return fromMastery;

  // This is the FALLBACK chapter list, used only when per-chapter mastery is
  // empty. It used to be [...strong, ...weak]; strong_topics no longer exists
  // on the snapshot, so it is the weak half alone.
  //
  // Not the mastery ruling applied backwards: that ruling keeps the FIGURE for
  // every subject including the weak ones, and the primary path above still
  // returns every chapter with its accuracy. What is gone is a list assembled
  // by selecting the best.
  const weak = snapshot?.weak_topics ?? [];
  return [...weak]
    .map((t) => {
      const chapterRaw = preferRealAcademicLabel(t.topic, t.chapter);
      const subjectRaw = preferRealAcademicLabel(t.subject);
      if (!chapterRaw || !subjectRaw) return null;
      const chapter = displayChapter(chapterRaw) || displayTopic(chapterRaw) || chapterRaw;
      const subjectCanon = normalizeSubjectName(subjectRaw) || subjectRaw;
      const subject = displaySubject(subjectCanon) || subjectCanon;
      if (!chapter || !subject || isGenericAcademicLabel(chapter) || isGenericAcademicLabel(subject)) {
        return null;
      }
      const acc = Math.round(t.accuracy);
      return {
        chapter,
        subject,
        accuracy: acc,
        questions: 0,
        // No session list reaches this fallback, so there is nothing to
        // derive a trend from — not_enough_data, never a silent "steady".
        trend: null as number | null,
        trendState: "not_enough_data" as TrendState,
        status: (acc >= 75 ? "ready" : acc >= 55 ? "practice-more" : "needs-work") as DerivedChapterRow["status"],
      };
    })
    .filter((r): r is DerivedChapterRow => r != null)
    .slice(0, 12);
}

export function deriveImprovingTopics(
  practiceTrend: PracticeTrendPoint[],
  sessions: PracticeSessionSummary[],
): { topic: string; subject: string; improvement: number }[] {
  const byKey = new Map<string, { subject: string; scores: number[] }>();

  const orderedTrend = [...practiceTrend].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  for (const p of orderedTrend) {
    const topic = preferRealAcademicLabel(p.chapter);
    if (!topic) continue;
    const key = topic.toLowerCase();
    const entry = byKey.get(key) ?? { subject: "", scores: [] };
    entry.scores.push(Math.round(p.score_pct));
    byKey.set(key, entry);
  }

  // Fill subject from sessions when trend rows lack it.
  for (const s of sessions) {
    const key = preferRealAcademicLabel(s.chapter).toLowerCase();
    if (!key) continue;
    const entry = byKey.get(key);
    if (entry && !entry.subject) {
      const subj = preferRealAcademicLabel(s.subject);
      if (subj) entry.subject = subj;
    }
  }

  // Session-only chapters not in trend.
  const byChapterSessions = new Map<string, { subject: string; scores: number[] }>();
  for (const s of [...sessions].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  )) {
    const topic = preferRealAcademicLabel(s.chapter);
    const subject = preferRealAcademicLabel(s.subject);
    if (!topic || !subject) continue;
    const key = topic.toLowerCase();
    if (byKey.has(key)) continue;
    const entry = byChapterSessions.get(key) ?? { subject, scores: [] };
    entry.scores.push(accuracyOf(s));
    entry.subject = subject;
    byChapterSessions.set(key, entry);
  }

  const merged = [...byKey.entries(), ...byChapterSessions.entries()];
  const out: { topic: string; subject: string; improvement: number }[] = [];
  for (const [key, { subject, scores }] of merged) {
    // Converged onto the one §6.4 ladder. This carried its own `< 5`, a
    // third threshold for the same judgement the subject rows and chapter
    // rows make at TREND_DELTA_POINTS — so a chapter could be "improving"
    // in this list and "steady" in the grid beside it, off the same numbers.
    const { state, deltaPoints } = trendState(scores);
    if (state !== "improving" || deltaPoints == null) continue;
    const trend = deltaPoints;
    const realSubject = preferRealAcademicLabel(subject);
    if (!realSubject) continue;
    const topic =
      preferRealAcademicLabel(
        practiceTrend.find((p) => preferRealAcademicLabel(p.chapter).toLowerCase() === key)?.chapter,
        sessions.find((s) => preferRealAcademicLabel(s.chapter).toLowerCase() === key)?.chapter,
        key,
      );
    if (!topic) continue;
    out.push({ topic, subject: realSubject, improvement: Math.round(trend) });
  }
  return out.sort((a, b) => b.improvement - a.improvement).slice(0, 8);
}

export type SpeedStats = {
  avgSec: number;
  fastestSubject: string;
  fastestSec: number;
  slowestSubject: string;
  slowestSec: number;
  improvementSec: number | null;
};

export function deriveSpeedStats(sessions: PracticeSessionSummary[]): {
  stats: SpeedStats;
  bySubject: { name: string; avgSec: number }[];
} {
  const withTiming = sessions.filter((s) => sessionSecPerQuestion(s) != null);
  if (withTiming.length === 0) {
    return {
      stats: {
        avgSec: 0,
        fastestSubject: "—",
        fastestSec: 0,
        slowestSubject: "—",
        slowestSec: 0,
        improvementSec: null,
      },
      bySubject: [],
    };
  }

  const totalSec = withTiming.reduce((sum, s) => sum + (sessionSecPerQuestion(s) ?? 0) * s.question_count, 0);
  const totalQ = withTiming.reduce((sum, s) => sum + s.question_count, 0);
  const avgSec = totalQ > 0 ? Math.round(totalSec / totalQ) : 0;

  const subjectMap = new Map<string, { secSum: number; q: number }>();
  for (const s of withTiming) {
    const key = subjectSessionKey(s.subject);
    if (!key) continue;
    const sec = sessionSecPerQuestion(s)!;
    const cur = subjectMap.get(key) ?? { secSum: 0, q: 0 };
    cur.secSum += sec * s.question_count;
    cur.q += s.question_count;
    subjectMap.set(key, cur);
  }
  const bySubject = [...subjectMap.entries()]
    .map(([key, v]) => ({
      name: displaySubject(key) || normalizeSubjectName(key) || key,
      avgSec: Math.round(v.secSum / v.q),
    }))
    .sort((a, b) => a.avgSec - b.avgSec);

  const ordered = [...withTiming].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  );
  const secs = ordered.map((s) => sessionSecPerQuestion(s)!);
  const mid = Math.floor(secs.length / 2);
  let improvementSec: number | null = null;
  if (secs.length >= 2 && mid > 0) {
    const early = secs.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const late = secs.slice(mid).reduce((a, b) => a + b, 0) / (secs.length - mid);
    improvementSec = Math.round(early - late); // positive = faster
  }

  const fastest = bySubject[0];
  const slowest = bySubject[bySubject.length - 1];

  return {
    stats: {
      avgSec,
      fastestSubject: fastest?.name ?? "—",
      fastestSec: fastest?.avgSec ?? 0,
      slowestSubject: slowest && slowest.name !== fastest?.name ? slowest.name : "—",
      slowestSec: slowest && slowest.name !== fastest?.name ? slowest.avgSec : 0,
      improvementSec,
    },
    bySubject,
  };
}

/**
 * This month against last month.
 *
 * ── THREE THINGS WERE WRONG HERE, AND EACH HAD A TWIN ELSEWHERE ────────────
 *
 * 1. "Questions". `weekly_activity.total` is
 *    `test_count + homework_count + battle_count + self_practice_count` — a
 *    count of ACTIVITIES, which the heat-map tooltip beside it was corrected
 *    to say in as many words ("the tooltip called them questions, a number
 *    this table has never held"). That correction was made in one place and
 *    not this one, so the same table kept being read as questions two panels
 *    down. It is labelled for what it counts now.
 *
 * 2. "Avg score" was the mean of per-day `score_pct` — the mean of rates,
 *    which 20261022000000 removed from refresh_student_academic_profile for
 *    disagreeing with the pooled figure every other surface shows. It came
 *    back in the browser. It is pooled here: correct over answered, across
 *    the month's sessions, which is the one accuracy this app has.
 *
 * 3. "Study time" was `Math.round(mins / 60)` with the unit "h" appended.
 *    Every real total under thirty minutes printed as "0h" — the same
 *    rounding that formatStudyTime exists to prevent on the Overview tile,
 *    made here about the same minutes. Minutes are returned; the renderer
 *    picks the unit.
 */
export function deriveMonthComparison(
  weekly: WeeklyActivityPoint[],
  sessions: PracticeSessionSummary[],
  heatmap: AcademicSnapshot["activity_heatmap"],
  now = new Date(),
): { label: string; thisM: number | null; lastM: number | null; unit: string }[] {
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const lastMonth = lastMonthDate.getMonth();
  const lastYear = lastMonthDate.getFullYear();

  const inThis = (iso: string) => {
    const d = new Date(iso);
    return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
  };
  const inLast = (iso: string) => {
    const d = new Date(iso);
    return d.getFullYear() === lastYear && d.getMonth() === lastMonth;
  };

  let thisActivities = 0;
  let lastActivities = 0;
  for (const row of weekly) {
    if (inThis(row.date)) thisActivities += row.total ?? 0;
    if (inLast(row.date)) lastActivities += row.total ?? 0;
  }

  /** Pooled: correct over answered, never a mean of session percentages. */
  const pooled = (rows: PracticeSessionSummary[]): number | null => {
    let correct = 0;
    let answered = 0;
    for (const r of rows) {
      correct += r.correct_count;
      answered += r.correct_count + r.wrong_count;
    }
    return answered > 0 ? Math.round((100 * correct) / answered) : null;
  };

  let thisMins = 0;
  let lastMins = 0;
  for (const row of heatmap ?? []) {
    if (inThis(row.date)) thisMins += row.minutes ?? 0;
    if (inLast(row.date)) lastMins += row.minutes ?? 0;
  }

  return [
    { label: "Activities", thisM: thisActivities, lastM: lastActivities, unit: "" },
    {
      label: "Accuracy",
      thisM: pooled(sessions.filter((x) => inThis(x.finished_at))),
      lastM: pooled(sessions.filter((x) => inLast(x.finished_at))),
      unit: "%",
    },
    // Minutes. The renderer formats — see formatStudyTime in Analysis.tsx.
    { label: "Study time", thisM: thisMins, lastM: lastMins, unit: "min" },
  ];
}

/**
 * Recovery, as the 7C engine sees it.
 *
 * ── WHAT THIS READ BEFORE ─────────────────────────────────────────────────
 *
 * `snapshot.recovery_pending` (a count of OPEN recovery_assignments rows) and
 * `concept_mastery.recovery_attempts`. Both belong to the retired engine:
 * assignments were created on the FIRST wrong answer in a concept, and
 * measured live there were 17 of them across 2 users, every one with
 * questions_completed = 0 — abandoned stubs. Analysis reported 14 of those as
 * this student's "still pending" recovery while the Recovery screen, now on
 * chapter_state, showed one chapter actually ready.
 *
 * Two pages, two engines, two different answers about the same student.
 *
 * ── WHAT IT READS NOW ─────────────────────────────────────────────────────
 *
 * The same rpc_student_recovery_queue rows the Recovery screen renders, so
 * the two pages cannot disagree. `ready` is decided server-side against
 * RECOVERY_TRIGGER_COUNT; this file does not hold a copy of the threshold.
 */
export function deriveRecoveryProgress(queue: RecoveryQueueRow[] | null | undefined): {
  totalToRevisit: number;
  completed: number;
  stillPending: number;
} {
  const rows = queue ?? [];
  return {
    // Every chapter carrying an open mistake — what is left to fix.
    totalToRevisit: rows.length,
    // §3.2 'recovered' is the engine's own word for a chapter that cleared
    // both readiness rates. Not a mastery score over a boundary this file
    // invented.
    completed: rows.filter((r) => r.state === "recovered").length,
    // Ready means the trigger is met and a session can be built right now.
    // A chapter three mistakes in is not "pending recovery"; it is a chapter
    // the student is still working in.
    stillPending: rows.filter((r) => r.ready).length,
  };
}

/**
 * The chapters the Recovery panel lists, from the same rows Recovery uses.
 *
 * Replaces a version that matched `snapshot.weak_topics` against
 * concept_mastery by comparing display labels — string matching across two
 * tables, which is the free-text coupling §2 forbids and the reason the old
 * revision_queue filled with rows pointing at 'Chapter 3'. These rows are
 * keyed on chapter_id and need no matching at all.
 */
export function deriveRecoveryTopics(queue: RecoveryQueueRow[] | null | undefined): {
  topic: string;
  subject: string;
  status: "ready" | "building" | "recovered" | "relearn";
  openMistakes: number;
  triggerCount: number;
}[] {
  return (queue ?? [])
    .map((r) => {
      const topic = preferRealAcademicLabel(r.chapter);
      const subject = preferRealAcademicLabel(r.subject);
      if (!topic || !subject) return null;
      return {
        topic,
        subject,
        // `relearn` is checked BEFORE `building`. A relearn chapter has
        // ready=false and a state that is not "recovered", so it used to land
        // in "building" — the bucket for a chapter that has not collected
        // enough mistakes yet — and the row then rendered "26 of 1": the
        // student told they need more mistakes when the engine has declined to
        // drill them BECAUSE they have too many.
        status: r.state === "recovered" ? ("recovered" as const)
              : r.mode === "relearn" ? ("relearn" as const)
              : r.ready ? ("ready" as const)
              : ("building" as const),
        openMistakes: r.open_mistakes,
        triggerCount: r.trigger_count,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .slice(0, 6);
}

/**
 * Revision, as the 7C engine sees it.
 *
 * ── WHAT THIS READ BEFORE ─────────────────────────────────────────────────
 *
 * snapshot.revision_queue — the RETIRED queue. Every row in it was written
 * with `due_date = CURRENT_DATE` on a wrong answer and nothing anywhere
 * applied the §5.3 intervals, so "due today" was a synonym for "in the queue"
 * (measured on production: 223 rows, 223 due, 0 upcoming). `completed` was
 * hardcoded to 0 on the reasoning that finished items leave the queue, so the
 * "Done" tile could only ever read zero.
 *
 * Worse, the Revision SCREEN moved to chapter_state and this did not, so the
 * two pages described different worlds from different tables.
 *
 * ── WHAT IT READS NOW ─────────────────────────────────────────────────────
 *
 * chapter_state, where the ladder actually lives. "Done" is a chapter that has
 * gone solid — REVISION_STAGES_TO_SOLID consecutive passes.
 *
 * ── WHY IT IS NOT `next_revision_at === null` ANY MORE ────────────────────
 *
 * It was, and the comment here used to call that "the only honest completion
 * signal in the schema". It stopped being a signal at all: the database was
 * corrected so that going solid does NOT clear the date —
 *
 *   "SOLID IS NOT FINISHED. The chapter keeps a check, at
 *    REVISION_INTERVAL_SOLID, for ever. The old body set next_revision_at to
 *    NULL here, which dropped the chapter out of the schedule permanently."
 *        -- rpc_submit_revision_session, and _revision_interval_days
 *
 * So the condition this tested for can no longer occur, and "Done" was
 * structurally zero for every student — the exact defect the paragraph above
 * describes this function as having been written to fix, reintroduced by the
 * database moving underneath it rather than by anyone editing this file.
 *
 * The passes are the completion signal, and they are what the database counts
 * to decide the same thing.
 */
export function deriveRevisionData(
  states: ChapterStateRow[] | null | undefined,
): { totalRevised: number; completed: number; pending: number; dueToday: string[] } {
  const items = states ?? [];
  const solid = items.filter((s) => s.consecutive_passes >= REVISION_STAGES_TO_SOLID);
  const scheduled = items.filter((s) => s.next_revision_at !== null);
  // `revision_due` is computed server-side against now(); recomputing the
  // comparison here would put "is it due" in a second home and drift on any
  // timezone difference between the browser and the database.
  const dueToday = scheduled
    .filter((s) => s.revision_due)
    .map((s) => preferRealAcademicLabel(s.chapter, s.subject))
    .filter((label): label is string => Boolean(label));
  return {
    totalRevised: items.length,
    completed: solid.length,
    pending: scheduled.length,
    dueToday,
  };
}

/**
 * When in the day this student actually practises.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The Activity & Speed tab has a tile headed "Most productive hour" and it
 * rendered "—" for every student, always, with this note beside it:
 *
 *     // Hourly buckets are not in academic_daily_activity — honest empty.
 *
 * That was true about academic_daily_activity and false about the database.
 * question_attempts.created_at is set on every attempt — measured 2026-09-18,
 * 5,623 of them across 11 distinct hours — so the hour a student works has
 * been recorded all along. Nothing needed storing; the page needed to read it.
 *
 * ── WHY THE BUCKETING IS DONE IN THE BROWSER ───────────────────────────────
 *
 * The database runs in UTC and has no column saying where a student is. An
 * hour bucket computed server-side would therefore be a UTC hour, and India —
 * which is who this product is for — is UTC+5:30, so a UTC bucket straddles
 * two local hours and cannot be shifted into one afterwards. Hardcoding
 * Asia/Kolkata in SQL would work today and be wrong the first time a school
 * sits anywhere else.
 *
 * `new Date(iso).getHours()` is the viewer's own clock, which is the only
 * clock that makes "you work best at 5pm" mean anything to the person reading
 * it.
 */
export function hourHistogram(timestamps: (string | null | undefined)[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const iso of timestamps) {
    if (!iso) continue;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    hours[at.getHours()] += 1;
  }
  return hours;
}

/**
 * The hour with the most attempts behind it, or null when there is nothing to
 * say.
 *
 * NULL, not midnight. An empty histogram is all zeroes, and `indexOf(max)` on
 * it returns 0 — which would render "12 AM" as a confident claim about a
 * student who has never practised, in the same family as the 0% accuracy and
 * 0h study time this page has already been corrected for twice.
 *
 * A tie goes to the earlier hour, deterministically, rather than to whichever
 * the engine happened to visit first.
 */
export function busiestHour(hours: number[]): number | null {
  let best = -1;
  let bestCount = 0;
  for (let h = 0; h < hours.length; h += 1) {
    if (hours[h] > bestCount) {
      bestCount = hours[h];
      best = h;
    }
  }
  return bestCount > 0 ? best : null;
}

/** "5 PM", "12 AM" — the way a student reads a clock, not "17". */
export function formatHour(hour: number | null): string {
  if (hour == null) return "—";
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}

export function scoreAxisDomain(scores: number[]): [number, number] {
  if (scores.length === 0) return [0, 100];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const lo = Math.max(0, Math.floor((min - 10) / 10) * 10);
  const hi = Math.min(100, Math.ceil((max + 5) / 10) * 10);
  return [lo < hi ? lo : 0, hi > lo ? hi : 100];
}

/** Practice count for a weak topic from finished sessions. */
export function practiceCountForTopic(
  sessions: PracticeSessionSummary[],
  subject: string,
  topic: string,
): number {
  const needle = topic.trim().toLowerCase();
  return sessions
    .filter(
      (s) =>
        s.subject === subject &&
        ((s.chapter || "").trim().toLowerCase() === needle ||
          (s.chapter || "").toLowerCase().includes(needle)),
    )
    .reduce((sum, s) => sum + s.question_count, 0);
}
