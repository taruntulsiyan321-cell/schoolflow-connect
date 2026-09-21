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
import { mayBeJudged } from "@/academic/metrics/thresholds";

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

/*
 * DerivedSubjectRow and deriveSubjectRows WERE HERE, and they are gone.
 *
 * They built the Subjects tab from charts.subjects, which
 * rpc_student_performance_charts aggregates out of _weak_topics_for_user —
 * so it only ever saw subjects whose attempts resolve to a topic in the
 * bank. Measured 2026-09-18: a student with attempts in six subjects had ONE
 * row, and the radar, a chart whose whole purpose is comparing subjects, was
 * drawing a single point.
 *
 * subjectData now comes from rpc_student_practice_analytics' by_subject,
 * which groups question_attempts directly. The old builder stayed behind as
 * an unused export and an unused import in Analysis.tsx, which is how a
 * retired source gets picked back up by the next screen that needs
 * "something like this".
 */


// `DerivedChapterRow` and `deriveChapterRows` WERE HERE, and they are gone
// with the table they read.
//
// They grouped concept_mastery into the Analysis chapter grid. concept_mastery
// is a DERIVED table this codebase has caught disagreeing with the attempts it
// is derived from — measured on one student, 200 attempts recorded against 120
// that exist — so the grid was the one panel on the page structurally unable
// to agree with the accuracy tile above it. rpc_student_practice_analytics
// (20261039000000) does the same grouping over question_attempts, which every
// other figure on the page already counts, and brings topic time, difficulty
// and effort that concept_mastery could not answer at all.
//
// Removed rather than left importable: this had no caller once Analysis
// stopped using it, and a shared derivation kept alive only by its own tests
// is the next session's second home for a decision already made.

/**
 * CHAPTERS getting better, and the name says so now.
 *
 * This grouped practice_trend and recent_sessions by their CHAPTER, called
 * the result `topic`, and Analysis rendered it through displayTopic() under
 * a heading reading "Topics getting better". presentAcademicLabel resolves
 * against a per-kind dictionary, so a chapter name was being looked up as
 * though it were a topic — three layers of one mislabel, on a page that
 * keeps displayChapter and displayTopic apart precisely because they are not
 * interchangeable.
 *
 * practice_trend is per chapter. There is no topic-level trend to show here,
 * so the panel says chapter.
 */
export function deriveImprovingChapters(
  practiceTrend: PracticeTrendPoint[],
  sessions: PracticeSessionSummary[],
): { chapter: string; subject: string; improvement: number }[] {
  const byKey = new Map<string, { subject: string; scores: number[] }>();

  const orderedTrend = [...practiceTrend].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  for (const p of orderedTrend) {
    const chapter = preferRealAcademicLabel(p.chapter);
    if (!chapter) continue;
    const key = chapter.toLowerCase();
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
    const chapter = preferRealAcademicLabel(s.chapter);
    const subject = preferRealAcademicLabel(s.subject);
    if (!chapter || !subject) continue;
    const key = chapter.toLowerCase();
    if (byKey.has(key)) continue;
    const entry = byChapterSessions.get(key) ?? { subject, scores: [] };
    entry.scores.push(accuracyOf(s));
    entry.subject = subject;
    byChapterSessions.set(key, entry);
  }

  const merged = [...byKey.entries(), ...byChapterSessions.entries()];
  const out: { chapter: string; subject: string; improvement: number }[] = [];
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
    const chapter =
      preferRealAcademicLabel(
        practiceTrend.find((p) => preferRealAcademicLabel(p.chapter).toLowerCase() === key)?.chapter,
        sessions.find((s) => preferRealAcademicLabel(s.chapter).toLowerCase() === key)?.chapter,
        key,
      );
    if (!chapter) continue;
    out.push({ chapter, subject: realSubject, improvement: Math.round(trend) });
  }
  return out.sort((a, b) => b.improvement - a.improvement).slice(0, 8);
}

/*
 * deriveSpeedStats, SpeedStats and sessionSecPerQuestion WERE HERE, and they
 * are gone rather than corrected.
 *
 * They measured per-question time as a SESSION's total_time_ms divided by its
 * question_count, which counts the gaps between questions. Every other time
 * figure on the Analysis page — slowest topics, slowest chapters, subject
 * study time — reads question_attempts.time_taken_ms, which counts only the
 * time on each question. Two clocks, two answers, one page: "Takes most time"
 * and "Chapters that take you longest" could disagree and nothing reconciled
 * them (G9).
 *
 * They also carried no floor, so bySubject[0] and bySubject[last] named a
 * student's fastest and slowest subject off a single session, and
 * `improvementSec` was computed on every render and rendered nowhere.
 *
 * Analysis.tsx now derives all of this from rpc_student_practice_analytics'
 * by_subject, which carries avg_sec and the count of timed attempts behind
 * it, so the subject tiles obey the same floor as the chapter and topic
 * panels beside them.
 */

export type SubjectPaceRow = { name: string; color: string; avgSec: number; timed: number };

export type SubjectPace = {
  /** Fastest first. Only subjects with enough answered, timed questions. */
  rows: SubjectPaceRow[];
  /** Pooled seconds per question across those subjects. 0 when none qualify. */
  avgSec: number;
  fastest: SubjectPaceRow | null;
  /** Null with fewer than two subjects: one row cannot be both ends. */
  slowest: SubjectPaceRow | null;
};

/** One decimal under ten seconds, whole seconds above it. Never a bare "0". */
export function formatSeconds(sec: number): string {
  return sec >= 10 ? `${Math.round(sec)}s` : `${Math.round(sec * 10) / 10}s`;
}

/**
 * Per-question time by subject, from the attempt record.
 *
 * Takes rows already mapped to their display name and colour so this stays a
 * pure calculation. Three rules it exists to hold:
 *
 *   ENOUGH TIMED READINGS, the denominator of avg_sec. Without it the fastest
 *   and slowest subject were the first and last of an unfiltered sort, so one
 *   timed question could name the subject a student is slowest at.
 *
 *   ENOUGH ANSWERED QUESTIONS. The panel is headed "How fast you solve
 *   questions", and skipping is not solving. Measured: a student with 79
 *   Social Science attempts, EVERY ONE of them skipped at about a third of a
 *   second, was named their "fastest subject" at "0s avg" — a subject they
 *   had never answered a question in, presented as the one they are quickest
 *   at, with a time of zero.
 *
 *   POOLING ON THE UNROUNDED VALUE (§4.2b). Averaging per-subject averages
 *   weights a subject with four timed questions the same as one with four
 *   hundred. Rounding each subject to a whole second BEFORE pooling is the
 *   same error in miniature: it made those 79 Social Science questions
 *   contribute exactly zero seconds to the student's overall pace.
 */
export function deriveSubjectPace(
  input: { name: string; color: string; avgSec: number | null; timed: number; answered: number }[],
): SubjectPace {
  const kept = input.filter(
    (r) => mayBeJudged(r.timed) && mayBeJudged(r.answered) && (r.avgSec ?? 0) > 0,
  );
  const rows: SubjectPaceRow[] = kept
    .map((r) => ({ name: r.name, color: r.color, avgSec: r.avgSec as number, timed: r.timed }))
    .sort((a, b) => a.avgSec - b.avgSec);
  const timed = rows.reduce((n, r) => n + r.timed, 0);
  const seconds = rows.reduce((n, r) => n + r.avgSec * r.timed, 0);
  return {
    rows,
    avgSec: timed > 0 ? seconds / timed : 0,
    fastest: rows[0] ?? null,
    slowest: rows.length > 1 ? rows[rows.length - 1] : null,
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
/**
 * `weekly: WeeklyActivityPoint[]` WAS THE FIRST PARAMETER AND IT IS GONE.
 *
 * This counted a month's ACTIVITIES from charts.weekly_activity and that same
 * month's MINUTES from snapshot.activity_heatmap — two tables answering "what
 * did this student do on this day", inside one three-row panel. Rendered
 * together they contradict: the panel showed "Activities 0" directly above
 * "Study time 1.8h", which is 107 minutes of activity on no activities.
 *
 * The heat-map rows already carry the components the count needs
 * (test + homework + battles + self_practice), so both rows read the same
 * days now, and they agree with the Practice tab's four-week tiles for the
 * same reason.
 */
export function deriveMonthComparison(
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

  let thisActivities = 0;
  let lastActivities = 0;
  let thisMins = 0;
  let lastMins = 0;
  for (const row of heatmap ?? []) {
    // The same components consistencyWeeks counts, so "activities" means one
    // thing on this page.
    const done =
      (row.test ?? 0) + (row.homework ?? 0) + (row.battles ?? 0) + (row.self_practice ?? 0);
    if (inThis(row.date)) {
      thisActivities += done;
      thisMins += row.minutes ?? 0;
    }
    if (inLast(row.date)) {
      lastActivities += done;
      lastMins += row.minutes ?? 0;
    }
  }

  // A MONTH WITH NOTHING RECORDED HAS NOTHING TO REPORT.
  //
  // thisMins/thisActivities are 0 for such a month and the accuracy is null,
  // so the panel rendered "Activities 0 / Accuracy — / Study time 0m" — two
  // confident zeroes and one honest dash for the same absence, directly
  // below a tile showing "Study time (4 weeks) —". A real zero inside a
  // month that HAS activity still reports as zero; this only covers the
  // month where nothing happened at all.
  const orNull = (n: number, active: number) => (active > 0 ? n : null);

  return [
    {
      label: "Activities",
      thisM: orNull(thisActivities, thisActivities),
      lastM: orNull(lastActivities, lastActivities),
      unit: "",
    },
    {
      label: "Accuracy",
      thisM: pooled(sessions.filter((x) => inThis(x.finished_at))),
      lastM: pooled(sessions.filter((x) => inLast(x.finished_at))),
      unit: "%",
    },
    // Minutes. The renderer formats — see formatStudyTime in Analysis.tsx.
    {
      label: "Study time",
      thisM: orNull(thisMins, thisActivities),
      lastM: orNull(lastMins, lastActivities),
      unit: "min",
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
  // DONE AND PENDING ARE SHOWN SIDE BY SIDE, SO THEY MUST NOT OVERLAP.
  //
  // A solid chapter does not leave the schedule — it drops to the much
  // longer REVISION_INTERVAL_SOLID — so it carries a next_revision_at and was
  // counted in BOTH tiles. Measured in the render fixture: three chapters
  // rendering as "1 Done, 2 Pending", which reads as three when one of them
  // is the same chapter twice.
  //
  // Pending is therefore "scheduled and not yet solid". Due today stays a
  // subset of it, which is what "2 pending, 1 of them due today" should
  // mean.
  const scheduled = items.filter(
    (s) => s.next_revision_at !== null && s.consecutive_passes < REVISION_STAGES_TO_SOLID,
  );
  // `revision_due` is computed server-side against now(); recomputing the
  // comparison here would put "is it due" in a second home and drift on any
  // timezone difference between the browser and the database.
  // FROM EVERY CHAPTER, not from `scheduled`. A solid chapter is still on the
  // ladder — a much longer rung of it — so it comes due like any other, and
  // narrowing `scheduled` to the not-yet-solid ones above would have hidden
  // a solid chapter that is due today. `revision_due` is the server's own
  // verdict and needs no help from the tile's grouping.
  const dueToday = items
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
