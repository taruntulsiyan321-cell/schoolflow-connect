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

function sessionSecPerQuestion(session: PracticeSessionSummary): number | null {
  if (session.question_count <= 0) return null;
  const sec = (session.duration_minutes * 60) / session.question_count;
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
  timeHrs: number;
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
    const timeMins = sess.reduce((sum, x) => sum + x.duration_minutes, 0);
    const { state: subjectTrendState, deltaPoints } = trendState(sess.map(accuracyOf));
    return {
      name: s.name,
      accuracy,
      questions: s.attempts,
      timeHrs: Math.round((timeMins / 60) * 10) / 10,
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
  /** Practice depth toward 5 attempts (not syllabus %). */
  practiceDepth: number;
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

  const fromMastery = mastery
    .map((m) => {
      const chapterRaw = preferRealAcademicLabel(m.chapter, m.concept);
      const subjectRaw = preferRealAcademicLabel(m.subject);
      if (!chapterRaw || !subjectRaw) return null;
      const chapter = displayChapter(chapterRaw) || chapterRaw;
      const subjectCanon = normalizeSubjectName(subjectRaw) || subjectRaw;
      const subject = displaySubject(subjectCanon) || subjectCanon;
      if (!chapter || !subject || isGenericAcademicLabel(chapter) || isGenericAcademicLabel(subject)) {
        return null;
      }
      const attempts = m.total_attempts ?? 0;
      const accuracy =
        attempts > 0
          ? Math.round((100 * (m.correct_attempts ?? 0)) / attempts)
          : Math.round(m.mastery_score);
      const key = `${subject.toLowerCase()}::${chapter.toLowerCase()}`;
      const sessList = byChapter.get(key) ?? [];
      const { state: chapterTrendState, deltaPoints } = trendState(sessList.map(accuracyOf));
      return {
        chapter,
        subject,
        practiceDepth: Math.min(100, Math.round((attempts / 5) * 100)),
        accuracy,
        questions: attempts,
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
    .filter((r): r is DerivedChapterRow => r != null)
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
        practiceDepth: 0,
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

export function deriveMonthComparison(
  weekly: WeeklyActivityPoint[],
  practiceTrend: PracticeTrendPoint[],
  heatmap: AcademicSnapshot["activity_heatmap"],
  now = new Date(),
): { label: string; thisM: number; lastM: number; unit: string }[] {
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const lastMonth = lastMonthDate.getMonth();
  const lastYear = lastMonthDate.getFullYear();

  let thisQ = 0;
  let lastQ = 0;
  for (const row of weekly) {
    const d = new Date(row.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) thisQ += row.total ?? 0;
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) lastQ += row.total ?? 0;
  }

  const scoresThis: number[] = [];
  const scoresLast: number[] = [];
  for (const p of practiceTrend) {
    const d = new Date(p.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) scoresThis.push(p.score_pct);
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) scoresLast.push(p.score_pct);
  }
  const avg = (xs: number[]) =>
    xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

  let thisMins = 0;
  let lastMins = 0;
  for (const row of heatmap ?? []) {
    const d = new Date(row.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) thisMins += row.minutes ?? 0;
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) lastMins += row.minutes ?? 0;
  }

  return [
    { label: "Questions", thisM: thisQ, lastM: lastQ, unit: "" },
    { label: "Avg score", thisM: avg(scoresThis), lastM: avg(scoresLast), unit: "%" },
    {
      label: "Study time",
      thisM: Math.round(thisMins / 60),
      lastM: Math.round(lastMins / 60),
      unit: "h",
    },
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
  status: "ready" | "building" | "recovered";
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
        status: r.state === "recovered" ? ("recovered" as const)
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
 * gone solid: §5.3 says three consecutive passes and the chapter LEAVES the
 * queue, and the way it leaves is that next_revision_at becomes null. That
 * absence — paired with a recovered_at, so an untouched chapter is not counted
 * as finished — is the only honest completion signal in the schema.
 */
export function deriveRevisionData(
  states: ChapterStateRow[] | null | undefined,
): { totalRevised: number; completed: number; pending: number; dueToday: string[] } {
  const items = states ?? [];
  const solid = items.filter((s) => s.next_revision_at === null && s.recovered_at !== null);
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
