import { useState, useMemo, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell,
} from "recharts";
import {
  TrendingUp, Download, Share2, CheckCircle2, AlertCircle, Clock,
  BookOpen, Target, Calendar, ChevronRight, ArrowUp, ArrowDown,
  Minus, Printer
} from "lucide-react";
import { NoStudentProfile, PageHeader, PageSkeleton, Skeleton, SkeletonCard, SkeletonStats, cn } from "@/gurukul/components/shared";
import { type Tab, TABS } from "./analysisTabs";
import { withAlpha } from "@/lib/colorAlpha";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPracticeAnalytics } from "@/hooks/useStudentPracticeAnalytics";
import {
  accuracyBand,
  ACCURACY_CONCEPTUAL,
  PRACTICE_QUESTIONS_MILESTONE,
  STREAK_ESTABLISHED,
  STREAK_MILESTONE,
} from "@/academic/metrics/bands";
import {
  TREND_DELTA_POINTS,
  TREND_MIN_SESSIONS,
  type TrendState,
} from "@/academic/recovery/constants";
import { RecoveryEngineService, type ChapterStateRow, type RecoveryQueueRow } from "@/academic";
import { buildMilestones, consistencyWeeks, consistencyRatio } from "@/components/student/analytics/wisdom/analyticsDerived";
import { useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { DecisionEngineService, type WeakAreaRecommendation } from "@/academic/services/decisionEngineService";
import { DECISION_ENGINE_FEATURE_FLAGS } from "@/lib/productFeatureFlags";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicDisplay";
import {
  DAY_LABELS,
  weekdayLabel,
  buildWeekComparison,
  buildSubjectRadarPoints,
  deriveImprovingChapters,
  deriveMonthComparison,
  deriveRecoveryProgress,
  deriveRecoveryTopics,
  deriveSubjectPace,
  formatSeconds,
  deriveRevisionData,
  trendState,
  practiceCountForTopic,
  scoreAxisDomain,
  busiestHour,
  formatHour,
} from "@/lib/studentAnalysisMetrics";
import { hasStudyActiveDays, studyActiveDaysFromSnapshot } from "@/lib/learningMetrics";
import { preferRealAcademicLabel } from "@/lib/qualityGuards";
import { toErrorMessage } from "@/lib/presentation";
import { formatLastSeen } from "@/lib/analyticsInsights";
import { useKeyedResource } from "@/hooks/useKeyedResource";
import { pluralise } from "@/lib/plural";
import { accuracyWhenMeaningful, mayBeJudged, MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "hsl(var(--primary))",
  Math: "hsl(var(--primary))",
  Physics: "hsl(var(--info))",
  Chemistry: "hsl(var(--primary-glow))",
  Biology: "hsl(var(--success))",
  English: "hsl(var(--warning))",
  Hindi: "hsl(var(--destructive))",
  Science: "hsl(var(--info))",
  "Social Science": "hsl(var(--warning))",
};
const FALLBACK_COLORS = ["hsl(var(--primary))", "hsl(var(--info))", "hsl(var(--primary-glow))", "hsl(var(--success))", "hsl(var(--warning))"];

function subjectColor(name: string, index: number) {
  return SUBJECT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(v: number) {
  if (v >= 80) return "hsl(var(--info))";
  if (v >= 65) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

/**
 * Study time in the largest unit that does not round the figure away.
 *
 * Under an hour it stays in minutes: the tile used to divide by 60 and round,
 * so every real total below thirty minutes printed as "0h" — the same "you did
 * nothing" claim the null-when-unmeasured guard exists to prevent, made about
 * time the student actually spent.
 */
function formatStudyTime(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)}h`;
}

/**
 * The "% right" line printed beside a TIME.
 *
 * Both panels now require enough ANSWERED questions to appear at all, so a
 * surviving row always has a rate — but accuracyWhenMeaningful stays the
 * only thing allowed to decide that, rather than this trusting the filter
 * upstream and printing `accuracy` raw. If the two ever disagree the row
 * says so instead of asserting a rate it has not earned.
 */
function rightRate(answered: number, accuracyPct: number | null): string {
  const rate = accuracyWhenMeaningful(answered, accuracyPct);
  return rate == null ? "not enough answers" : `${Math.round(rate)}% right`;
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="text-foreground font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Analysis() {
  const [tab, setTab] = useState<Tab>("overview");
  const student = useGurukulStudent();
  const { ctx, ready: academicReady, studentId, classId } = useAcademicContext();
  // Rule 11: Analysis is practice-only, so it no longer subscribes to the
  // marks or examination channels — it has nothing to refresh from them.
  useAcademicLive(["profile"]);
  const { data: analysis, loading: analysisLoading, error: analysisError, reload: reloadAnalysis } = useAnalysisPageData(academicReady);
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts(academicReady);
  const { data: snapshot, loading: snapshotLoading, error: snapshotError, reload: reloadSnapshot } = useStudentAcademicSnapshot(academicReady);
  // CONCEPT MASTERY IS GONE FROM THIS PAGE.
  //
  // It fed three panels — the chapter grid, "Topics to revisit" and "Yet to
  // begin" — and it is a DERIVED table that this codebase has already caught
  // disagreeing with the attempts it is derived from: measured on one student,
  // 200 attempts recorded against 120 that exist, and a 46-point accuracy gap
  // against the same student's question_attempts. Every other figure on this
  // page counts question_attempts, so the chapter grid was the one panel
  // structurally unable to agree with the rest of the screen.
  //
  // rpc_student_practice_analytics does the same grouping over the attempts
  // themselves (20261039000000), which also brings topic time, difficulty and
  // effort — none of which concept_mastery could answer at all.
  const {
    data: practiceAnalytics,
    loading: practiceAnalyticsLoading,
    error: practiceAnalyticsError,
    reload: reloadPracticeAnalytics,
  } = useStudentPracticeAnalytics(academicReady);

  // Decision Engine Slice 1 swap-in for topicGroups.needs_attention only
  // (see the approved plan -- the other 6 weak_topics/strong_topics read
  // sites in this file, and the shared deriveChapterRows/deriveRecoveryTopics
  // library functions, are explicitly deferred). Reuses the same
  // weakAreasV2 flag already live for Practice.tsx and
  // RecoveryCompletionReportPage.tsx -- one rollout, not a per-consumer flag.
  const [v2WeakAreas, setV2WeakAreas] = useState<WeakAreaRecommendation[] | null>(null);
  useEffect(() => {
    if (!DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2 || !ctx || !academicReady) return;
    let cancelled = false;
    DecisionEngineService.getWeakAreasV2(ctx)
      .then((recs) => {
        if (cancelled) return;
        setV2WeakAreas(recs);
      })
      .catch((e) => {
        if (cancelled) return;
        // Same reasoning as RecoveryCompletionReportPage.tsx: rollout
        // health metrics live in practiceService.ts's wrapper, not here, so
        // this direct caller doesn't need to replicate them. Empty, not a
        // silent fallback to the legacy snapshot field.
        console.warn("[Analysis] getWeakAreasV2 failed:", e instanceof Error ? e.message : e);
        setV2WeakAreas([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady]);
  // The marks/exams fetch that used to sit here is GONE (rule 11, amended
  // 2026-09-05). Analysis issues no query against `marks` or `exams` at all,
  // which is what "provably practice-only" has to mean — rendering nothing is
  // not the same as fetching nothing. The student reads their exam marks on
  // their marks surface instead.

  const loading = analysisLoading || chartsLoading || snapshotLoading || practiceAnalyticsLoading;
  const loadError = analysisError || chartsError || snapshotError || practiceAnalyticsError;

  // EVERY SOURCE, not just the one that happened to fail first. loadError is
  // the first non-null of four, so retrying only that one leaves the other
  // three stale if more than one was down — which, for four calls that go out
  // together, is the common case rather than the odd one.
  const retryAll = useCallback(() => {
    void reloadAnalysis();
    void reloadCharts();
    void reloadSnapshot();
    void reloadPracticeAnalytics();
  }, [reloadAnalysis, reloadCharts, reloadSnapshot, reloadPracticeAnalytics]);

  useEffect(() => {
    if (loadError) {
      toast.error(loadError);
    }
  }, [loadError]);

  const overview = useMemo(() => {
    const correct = analysis?.totals.correct ?? 0;
    const incorrect = analysis?.totals.wrong ?? 0;
    // §6.6 — passed over, not got wrong. Kept out of totalQuestions so the
    // accuracy beside it is over questions actually answered.
    const skipped = analysis?.totals.skipped ?? 0;
    const totalQuestions = correct + incorrect;
    // ACCURACY COMES FROM THE COUNTS RENDERED BESIDE IT (G5).
    //
    // This read `student.accuracy` — the shell figure — while `correct` and
    // `incorrect` on the same row came from `analysis.totals`. Two sources, one
    // screen: the tiles said "13 correct · 14 incorrect · 46% accuracy" and the
    // arithmetic on display gave 48%.
    //
    // `analysis.totals.accuracy_pct` is now derived from these same two counts,
    // so the row is internally consistent by construction rather than by
    // coincidence. Null means nothing attempted — rendered as an em dash, never
    // as 0%.
    const accuracy = analysis?.totals.accuracy_pct ?? null;
    // The average-score field here used to fall back from an exam average to
    // practice accuracy — one number that meant a different measure depending
    // on whether the student had marks, with a sibling boolean as the only way
    // to tell which. That is the §4.2b blend in miniature, and it went with the
    // exam fetch. Practice accuracy is the only rate on this page now, and it
    // is named for what it is.
    //
    // The identifiers are deliberately not spelled out: analysisTabSources
    // asserts they appear nowhere in this file, and a guard that trips on its
    // own explanation is a guard nobody keeps.
    return {
      accuracy,
      totalQuestions,
      correct,
      incorrect,
      skipped,
      // A LIST LENGTH IS NOT A COUNT, and this fell back to one.
      //
      // `?? analysis?.recent_sessions.length ?? 0` reads the array this page
      // fetched with `.limit(40)`. A student with 72 completed sessions —
      // which is what production held when this was measured — would have
      // been shown 40, silently, whenever the snapshot's own count was
      // absent. The cap is a page-size decision about a list; it can never
      // stand in for how many sessions a student has sat.
      //
      // So the fallback is deleted rather than raised: the server count or
      // nothing. Null renders as an em dash, which is the honest answer when
      // the figure was not supplied, and it cannot be mistaken for 40.
      practiceCompleted: snapshot?.self_practice?.sessions_completed ?? null,
      // NULL, not 0, when no time was recorded.
      //
      // Measured 2026-09-10: only 4 of 262 practice sessions carry
      // `total_time_ms`, and `academic_daily_activity.practice_minutes` totals
      // 18 minutes across the whole platform. So "0h" beside "27 questions
      // solved" was correct arithmetic on a number nothing had written — the
      // screen was reporting a measurement that was never taken.
      //
      // The timer not recording is the real defect and it lives in the practice
      // finish path, not here. This stops the screen claiming a student studied
      // for zero hours in the meantime. KNOWN_ISSUES 44.
      //
      // studyMinutes WAS HERE, as a second copy of the sum studyActivity
      // already makes. Same label on two tabs, same arithmetic written twice,
      // agreeing only because the two copies were identical. The Overview
      // tile reads studyActivity.totalMinutes now — one sum, one window.
      streak: student.streak,
    };
  }, [analysis, snapshot, student.streak]);

  const scoreTrend = useMemo(() => {
    // TWO PATHS, ONE DEFINITION — and that is why the fallback is allowed to
    // stand where the `fallbackAvg` below was deleted.
    //
    // practice_trend.score_pct is correct_count / (correct_count +
    // wrong_count), server-side, since 20261031000000; recent_sessions
    // .accuracy_pct is accuracyOverAnswered(correct_count, wrong_count) over
    // the same columns of the same rows. Same formula, same source, one
    // aggregated by the database and one by the client, so which branch runs
    // cannot change what the line means. Change one and you must change the
    // other — a fallback between two DIFFERENT measures is a coin toss about
    // which is true, which is exactly what the pace figure was.
    //
    // A third field, `practice`, was carried here and rendered by nothing:
    // literal 0 in the first branch and question_count in the second, so the
    // one name meant "no data" or "a real count" depending on a branch
    // nobody read. Gone rather than reconciled.
    const trend = charts?.practice_trend ?? [];
    if (trend.length > 0) {
      return trend.map((p) => ({
        week: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: Math.round(p.score_pct),
      }));
    }
    const sessions = [...(analysis?.recent_sessions ?? [])].reverse();
    if (sessions.length > 0) {
      return sessions.map((s) => ({
        week: new Date(s.finished_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: s.accuracy_pct,
      }));
    }
    return [];
  }, [charts?.practice_trend, analysis?.recent_sessions]);

  const weekComparison = useMemo(
    () => buildWeekComparison(charts?.weekly_activity ?? []),
    [charts?.weekly_activity],
  );

  // SUBJECTS, FROM THE ATTEMPTS — the same rows the chapter and topic panels
  // beside them count.
  //
  // This read charts.subjects, which aggregates _weak_topics_for_user and so
  // only sees subjects whose attempts resolve to a topic in the bank.
  // Measured: six subjects practised, one subject shown, and the radar beside
  // it drawing a single point. The speed panel on the Practice tab reads
  // practice_sessions and knew about Social Science, so the two tabs
  // disagreed about which subjects this student even studies.
  const subjectData = useMemo(() => {
    const sessions = analysis?.recent_sessions ?? [];
    return (practiceAnalytics?.by_subject ?? []).map((row, i) => {
      const name = displaySubject(row.subject) || row.subject;
      const runs = sessions.filter(
        (x) => preferRealAcademicLabel(x.subject).toLowerCase() === name.toLowerCase(),
      );
      const { state: subjectTrendState, deltaPoints } = trendState(
        runs.slice().reverse().map((x) => x.accuracy_pct),
      );
      // NULL STAYS NULL, AND THE FLOOR IS APPLIED HERE — ONCE.
      //
      // Coercing null to 0 is the defect this page was corrected for three
      // times: a student with 79 Social Science attempts — every one a SKIP —
      // rendered "0%" and "Needs attention". Nothing was answered, so there is
      // no rate.
      //
      // The floor used to be re-applied at each render site, each time against
      // `questions` (the ATTEMPT count) rather than the answers the rate is
      // computed from. Three sites, three chances to pass the wrong number,
      // and the chapter grid took it. It is one decision about the row, so it
      // is made once, on the row: below the floor `accuracy` is null and every
      // consumer — badge, rate, bar, radar, band — is right for free.
      const answered = row.answered;
      const accuracy = accuracyWhenMeaningful(
        answered,
        row.accuracy == null ? null : Math.round(row.accuracy),
      );
      return {
        name,
        score: accuracy,
        accuracy,
        questions: row.attempts,
        answered,
        measuredMinutes: row.total_min,
        color: subjectColor(name, i),
        trend: deltaPoints,
        trendState: subjectTrendState,
        status: (accuracy != null && ["low", "weak"].includes(accuracyBand(accuracy))
          ? "needs-attention"
          : "steady") as "needs-attention" | "steady",
      };
    });
  }, [practiceAnalytics?.by_subject, analysis?.recent_sessions]);

  // The radar, from the same subject rows as the list beside it. It kept its
  // own source and its own shortening helper; only the data feeding it moved.
  //
  // A subject with no accuracy has no axis to plot. Measured: one student's 79
  // Social Science attempts were ALL skips, so the subject has attempts and no
  // rate — drawing it at zero would put a spike on the radar for questions
  // that were never answered.
  const radarData = useMemo(
    () =>
      buildSubjectRadarPoints(
        subjectData
          .filter((s): s is typeof s & { score: number } => s.score != null)
          .map((s) => ({ name: s.name, score: s.score })),
      ),
    [subjectData],
  );

  const chapterData = useMemo(() => {
    const sessions = analysis?.recent_sessions ?? [];
    return (practiceAnalytics?.by_chapter ?? []).slice(0, 12).map((c) => {
      const label = preferRealAcademicLabel(c.chapter);
      const subject = preferRealAcademicLabel(c.subject) || "";
      const runs = sessions.filter(
        (x) => preferRealAcademicLabel(x.chapter).toLowerCase() === label.toLowerCase(),
      );
      const { state: chapterTrendState, deltaPoints } = trendState(
        runs.slice().reverse().map((x) => x.accuracy_pct),
      );
      // Same rule as the subject rows, and the same single application of the
      // floor. Measured before this: "Circles · Mathematics · Needs attention
      // · 8 Attempts · 0% Accuracy" — 8 attempts, 7 of them skipped, ONE
      // answered and wrong. Seven skips carried the verdict over a floor of
      // five because the floor was counting attempts.
      const answered = c.answered;
      const accuracy = accuracyWhenMeaningful(
        answered,
        c.accuracy == null ? null : Math.round(c.accuracy),
      );
      return {
        chapter: label || c.chapter,
        subject,
        color: subjectColor(subject, 0),
        questions: c.attempts,
        answered,
        timed: c.timed,
        accuracy,
        avgSec: c.avg_sec,
        totalMin: c.total_min,
        trend: deltaPoints,
        trendState: chapterTrendState,
        status: (accuracy == null
          ? "practice-more"
          : ["high", "near"].includes(accuracyBand(accuracy))
            ? "ready"
            : accuracyBand(accuracy) === "building"
              ? "practice-more"
              : "needs-work") as "ready" | "practice-more" | "needs-work",
      };
    });
  }, [practiceAnalytics?.by_chapter, analysis?.recent_sessions]);

  const topicGroups = useMemo(() => {
    const realTopic = (t: { topic?: string | null; chapter?: string | null }) =>
      preferRealAcademicLabel(t.topic, t.chapter);
    const realSubject = (s: string | null | undefined) => preferRealAcademicLabel(s);
    const weakTopicsSource: {
      subject: string; chapter?: string; topic?: string; accuracy: number; attempts?: number;
    }[] =
      DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2
        ? (v2WeakAreas ?? []).map((r) => ({
            subject: r.subject,
            chapter: r.chapter ?? undefined,
            topic: r.subconcept ?? r.concept,
            // Adapter, not equivalence -- same pattern already used for
            // mastery_score elsewhere: understanding and accuracy are both
            // 0-100 "how well is this understood" scales, not the same
            // measurement.
            accuracy: r.understanding ?? 0,
          }))
        : (snapshot?.weak_topics ?? []);
    return {
      needs_attention: weakTopicsSource
        .map((t) => {
          const topic = realTopic(t);
          const subject = realSubject(t.subject);
          if (!topic || !subject) return null;
          return {
            topic,
            subject,
            score: Math.round(t.accuracy),
            // The SERVER's count for this topic, not a client re-derivation.
            //
            // practiceCountForTopic matches the topic against the SESSION's
            // chapter, which worked only while a "topic" was a chapter. Now
            // that a topic is a topic, "Word Problems on AP" never matches the
            // chapter "Arithmetic Progressions", so every weak topic counted
            // zero attempts, mayBeJudged() dropped it, and this tab read
            // "Nothing flagged yet" while the Overview tab beside it said
            // "2 topics need attention". _weak_topics_for_user already counts
            // the attempts per topic and only sets is_weak once there are
            // enough of them; the fallback is for the v2 source, which has no
            // attempt count of its own.
            practiceCount:
              t.attempts ??
              practiceCountForTopic(analysis?.recent_sessions ?? [], t.subject, topic),
          };
        })
        .filter((t): t is NonNullable<typeof t> => t != null)
        // G7: "needs your attention" is a JUDGEMENT about the student, and it
        // does not get made on one attempt. A topic below the bar still appears
        // on the tab — it just reports attempts instead of being flagged.
        .filter((t) => mayBeJudged(t.practiceCount)),
      improving: deriveImprovingChapters(
        charts?.practice_trend ?? [],
        analysis?.recent_sessions ?? [],
      ).filter(
        (t) =>
          preferRealAcademicLabel(t.chapter) &&
          (t.subject === "—" || preferRealAcademicLabel(t.subject)),
      ),
      // `not_started` WENT WITH concept_mastery, and it could not have
      // answered its own question anyway. It listed concept rows at
      // total_attempts = 0, which is not "topics you have not started" — it is
      // "rows that happen to exist with no attempts". A student's untouched
      // syllabus is not in that table at all, so the panel was answering a
      // question about coverage from a table that only knows about contact.
    };
  }, [snapshot?.weak_topics, v2WeakAreas, charts?.practice_trend, analysis?.recent_sessions]);

  // Four real Mon–Sun weeks ending with this one. Every cell is a date, so a
  // Tuesday is drawn under Tuesday; a day with no activity is a zero rather
  // than a missing cell that shunts the rest along.
  const activityWeeks = useMemo(
    () => consistencyWeeks(snapshot?.activity_heatmap, 4),
    [snapshot?.activity_heatmap],
  );

  const practiceStats = useMemo(() => {
    // ALL FOUR TILES COUNT THE SAME DAYS.
    //
    // "Activities in 4 weeks" summed charts.weekly_activity while "Activities
    // today" and "Consistency" beside it read activityWeeks, which is built
    // from snapshot.activity_heatmap. Two tables answering "did this student
    // do something on this day", in one row of tiles, over the same four
    // weeks. Rendered together they can contradict outright — measured in the
    // render fixture as "Activities in 4 weeks: 0" sitting next to
    // "Consistency: 11%", which is three active days out of twenty-eight.
    //
    // weekly_activity still feeds the MONTHLY panels, which need a longer
    // series than four weeks; that is a different window, not a second
    // answer to this one.
    const days = activityWeeks.flatMap((w) => w.days);
    const weekDone = days.reduce((s, d) => s + d.total, 0);
    // From the calendar grid, whose cells are keyed by local date. This read
    // `new Date(d.date).toDateString()`, and a date-only string parses as UTC
    // midnight — west of Greenwich that is yesterday, so "Done today" showed
    // yesterday's count.
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todayDone = days.find((c) => c.date === todayKey)?.total ?? 0;
    const streakDays = student.streak;
    // Active days over the four-week WINDOW. This divided by weekly.length —
    // the number of rows the snapshot returned — and academic_daily_activity
    // only holds a row for a day something happened, so the sum was
    // activeDays/activeDays and the tile read 100% for anyone who had ever
    // practised once, and 0% for everyone else. There was no third answer.
    const consistency = consistencyRatio(activityWeeks).pct;
    // FOUR FIELDS AND TWO CONSTANTS WENT FROM HERE, all of them dead:
    //
    //   todayTarget, weekTarget   hardcoded 0, read only by `target > 0 ?
    //                             withTarget : withoutTarget` ternaries whose
    //                             first branch could never be taken
    //   monthDone, monthTarget    computed, rendered nowhere
    //   pendingAssignments        homework, on a practice-only page (rule 11),
    //                             rendered nowhere
    //   completedSessions         a second name for overview.practiceCompleted,
    //                             rendered nowhere
    //
    // Targets are not a feature this product has. Carrying a zero for one
    // makes the screen look like it is one release away from having them, and
    // it kept `snapshot` in this hook's dependency list for a field nothing
    // read.
    return { todayDone, weekDone, streakDays, consistency };
  }, [student.streak, activityWeeks]);

  const practiceMonthly = useMemo(() => {
    const weekly = charts?.weekly_activity ?? [];
    const byMonth = new Map<string, number>();
    for (const row of weekly) {
      const key = new Date(row.date).toLocaleDateString(undefined, { month: "short" });
      byMonth.set(key, (byMonth.get(key) ?? 0) + row.total);
    }
    return [...byMonth.entries()].map(([month, done]) => ({ month, done }));
  }, [charts?.weekly_activity]);

  // ONE DEFINITION OF PER-QUESTION TIME ON THIS PAGE, AT EVERY LEVEL.
  //
  // This was deriveSpeedStats(recent_sessions), which is a DIFFERENT
  // measurement from the one the rest of the page uses: a session's
  // total_time_ms / question_count counts the gaps between questions, while
  // question_attempts.time_taken_ms counts only the time on each question.
  // The Activity tab already ranked topics and chapters on the attempt
  // record, so "Takes most time: Mathematics" and "Chapters that take you
  // longest" were answering the same question from two different clocks, and
  // nothing made them agree (G9: no two homes for one fact).
  //
  // It also had NO floor. fastestSubject and slowestSubject were literally
  // bySubject[0] and bySubject[last], so one session of one subject could be
  // named the subject that takes this student longest.
  //
  // Both are fixed by reading the same rows the chapter and topic panels
  // read: by_subject carries avg_sec and the count of TIMED attempts behind
  // it, so the floor here is the floor there.
  const subjectPace = useMemo(() => {
    const colorOf = new Map(subjectData.map((s) => [s.name, s.color]));
    return deriveSubjectPace(
      (practiceAnalytics?.by_subject ?? []).map((s) => {
        const name = displaySubject(s.subject) || s.subject;
        return {
          name,
          color: colorOf.get(name) ?? subjectColor(name, 0),
          avgSec: s.avg_sec,
          timed: s.timed,
          answered: s.answered,
        };
      }),
    );
  }, [practiceAnalytics?.by_subject, subjectData]);

  // WHAT TAKES THIS STUDENT LONGEST, per topic and per chapter.
  //
  // THE FLOOR IS NOT OPTIONAL HERE. Ordered by raw average, the slowest
  // "topic" for one student was a single attempt of 579 seconds — a tab left
  // open, not a hard topic — and the next two were also one attempt each. Four
  // attempts in 5,570 exceed five minutes and they carry 1.9% of all recorded
  // time, so the outliers are rare and ruinous: exactly the case
  // MIN_OBSERVATIONS_FOR_VERDICT exists for. Below the floor a row has a time but
  // not a rate anybody should read, so it is not ranked.
  /** Right first time, or null when too few first tries to say. */
  const firstTryAccuracy = useMemo(() => {
    const e = practiceAnalytics?.effort;
    if (!e || e.first_try_attempts <= 0) return null;
    return accuracyWhenMeaningful(
      e.first_try_attempts,
      Math.round((100 * e.first_try_correct) / e.first_try_attempts),
    );
  }, [practiceAnalytics?.effort]);

  // TWO FLOORS, AND BOTH ARE NEEDED — the same pair the subject tiles use.
  //
  // TIMED READINGS, because avg_sec averages over attempts that carry a
  // duration: a row's time can rest on ONE reading while its attempt count
  // says twenty, which is how a single 579-second reading ranked as the
  // slowest topic on the page.
  //
  // ANSWERED QUESTIONS, because these panels are about where a student's
  // SOLVING time goes, and a skip is not solving. Without it the list ranked
  // rows a student had never answered anything in — "Reporting Imperative
  // Sentences, 5 attempts, 0.9s" was five straight skips through an English
  // topic, sitting at the top of "topics that take you longest" and printing
  // a blank where its success rate goes.
  //
  // THE REAL FIX IS ONE LEVEL DOWN and needs a migration: avg_sec should be
  // averaged over ANSWERED attempts rather than all timed ones, so a row's
  // time never mixes reading-and-skipping with solving. Until then the floor
  // keeps the rows where solving dominates. Both panels and the subject
  // tiles now apply the identical pair, so the page cannot answer "what
  // takes you longest" one way per level.
  const slowestTopics = useMemo(
    () =>
      (practiceAnalytics?.by_topic ?? [])
        .filter((t) => mayBeJudged(t.timed) && mayBeJudged(t.answered) && (t.avg_sec ?? 0) > 0)
        .slice(0, 6),
    [practiceAnalytics?.by_topic],
  );
  const slowestChapters = useMemo(
    () =>
      [...(practiceAnalytics?.by_chapter ?? [])]
        .filter((c) => mayBeJudged(c.timed) && mayBeJudged(c.answered) && (c.avg_sec ?? 0) > 0)
        .sort((a, b) => (b.avg_sec ?? 0) - (a.avg_sec ?? 0))
        .slice(0, 6),
    [practiceAnalytics?.by_chapter],
  );

  const studyActivity = useMemo(() => {
    // EVERY FIGURE HERE SAYS "LAST 4 WEEKS", SO EVERY FIGURE HERE IS
    // COMPUTED OVER 4 WEEKS.
    //
    // These reduced over snapshot.activity_heatmap RAW — whatever span the
    // snapshot happens to return — while the label beside them, the heat
    // grid under them and consistencyRatio all use activityWeeks, which
    // windows to four weeks from this Monday. The label was a claim the
    // arithmetic did not make, and the two only agreed while the snapshot
    // happened to be four weeks long. Reading activityWeeks makes the window
    // in the label and the window in the sum the same thing by construction,
    // and it is the one already-windowed structure on this page.
    //
    // Its days are dense — consistencyWeeks fills every date with zeros — so
    // "active days" is a filter on minutes, not on rows existing.
    const days = activityWeeks.flatMap((w) => w.days);
    // weekdayLabel, not toLocaleDateString: DAY_LABELS is English, and a
    // browser in any other language made every one of these comparisons false
    // — seven empty bars for a student who had studied all week.
    const weeklyHrs = DAY_LABELS.map((day) => {
      const mins = days
        .filter((d) => weekdayLabel(d.date) === day)
        .reduce((s, d) => s + (d.minutes ?? 0), 0);
      return Math.round((mins / 60) * 10) / 10;
    });
    const totalMins = days.reduce((s, d) => s + (d.minutes ?? 0), 0);
    const activeDays = days.filter((d) => (d.minutes ?? 0) > 0);
    const bestDayRow = [...activeDays].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0];
    return {
      // MINUTES, NOT HOURS. `Math.round(totalMins / 60)` printed "0h" for
      // every real total under thirty minutes — measured on production as
      // "Total study time 0h" on this tab beside "Study time total 6m" on
      // Overview, off the one heat-map. Overview was fixed with
      // formatStudyTime and this was not, which is how one source ended up
      // contradicting itself on one page. The rounding is gone from here
      // entirely; formatStudyTime is the only thing that turns these minutes
      // into a label.
      totalMinutes: totalMins,
      // NULL, NOT ZERO, and for the same reason the tile above it renders
      // "—": with no day carrying a minute there is no daily average to
      // report, and "0 min" is a confident claim that the student studied
      // for no time. It sat directly beside "Study time (4 weeks) —", so
      // the same absence was rendered two ways on one row of tiles.
      avgDailyMin: activeDays.length > 0 ? Math.round(totalMins / activeDays.length) : null,
      bestDay: bestDayRow
        ? new Date(bestDayRow.date).toLocaleDateString(undefined, { weekday: "short" })
        : "—",
      // REAL NOW, AND IT WAS ALWAYS AVAILABLE.
      //
      // This said "Hourly buckets are not in academic_daily_activity — honest
      // empty" and rendered "—" for every student on every visit. The claim
      // was true about that table and false about the database:
      // question_attempts.created_at is written on every attempt, 5,623 of
      // them across 11 distinct hours when this was measured. An empty tile
      // defended by a comment is still an empty tile, and "we do not store it"
      // was not the reason.
      //
      // Still honest when there is nothing: busiestHour returns null rather
      // than hour 0, so a student who has never practised gets "—" and not a
      // confident "12 AM".
      bestHour: formatHour(busiestHour(analysis?.attempt_hours ?? [])),
      weeklyHrs: [...weeklyHrs],
    };
  }, [activityWeeks, analysis?.attempt_hours]);

  // The 7C engine, not snapshot.revision_queue.
  //
  // That queue is retired: every row was written due CURRENT_DATE and nothing
  // applied the §5.3 intervals, so "due today" meant "in the queue" (223 rows,
  // 223 due, measured). The Revision screen moved to chapter_state and this
  // did not, so the two pages were describing different worlds off different
  // tables — Analysis showing 17 items due while Revision showed the real
  // ladder.
  const [chapterStates, setChapterStates] = useState<ChapterStateRow[]>([]);
  const [recoveryQueue, setRecoveryQueue] = useState<RecoveryQueueRow[]>([]);
  useEffect(() => {
    if (!academicReady || !ctx) return;
    let cancelled = false;
    // Both: chapter_state carries the revision ladder (next_revision_at,
    // revision_due) and the queue carries the recovery side (open_mistakes,
    // ready) including chapters with no state row yet. Neither is derivable
    // from the other.
    Promise.all([
      RecoveryEngineService.getChapterStates(ctx),
      RecoveryEngineService.getRecoveryQueue(ctx),
    ])
      .then(([states, queue]) => {
        if (cancelled) return;
        setChapterStates(states);
        setRecoveryQueue(queue);
      })
      .catch((e) => {
        // Analysis is a read-only surface and every other panel stands on its
        // own, so one failed section must not blank the page. It is logged
        // rather than swallowed, and the panel renders its empty state.
        if (!cancelled) {
          console.warn("[Analysis] chapter states failed:", e instanceof Error ? e.message : e);
        }
      });
    return () => { cancelled = true; };
  }, [ctx, academicReady]);

  const recoveryProgress = useMemo(() => deriveRecoveryProgress(recoveryQueue), [recoveryQueue]);
  const recoveryTopics = useMemo(() => deriveRecoveryTopics(recoveryQueue), [recoveryQueue]);

  const revisionData = useMemo(() => deriveRevisionData(chapterStates), [chapterStates]);

  // THREE TILES, ALL COUNTED FROM ROWS THAT EXIST.
  //
  // Was "Open mistakes / Topics to revisit / Yet to begin", and two of the
  // three came from concept_mastery: concepts carrying a mistake, and concepts
  // at zero attempts. Both are facts about which concept_mastery rows happen to
  // exist rather than about the student's syllabus. §10.8 also ruled out the
  // "Topics completed" figure that preceded them — a count of mastered
  // concepts is a statement about what the student is good at, whatever
  // boundary it uses.
  //
  // Open mistakes is snapshot.mistake_count, one row per open mistake, the
  // same number the Mistake Book and Recovery show. The mastery SUM that used
  // to back it is gone with the table: it was a per-concept snapshot, so
  // adding it up counted one mistake once per matching concept row and read
  // 69 for a student with 35.
  const learningProgress = useMemo(
    () => ({
      openMistakes: snapshot?.mistake_count ?? 0,
      topicsPractised: practiceAnalytics?.by_topic.length ?? 0,
      // THE TILE COUNTS WHAT THE LIST BENEATH IT SHOWS.
      //
      // This was snapshot.weak_topics.length — the RAW array — while the
      // list on the same tab renders topicGroups.needs_attention, which drops
      // rows with no usable topic or subject label and rows under the
      // evidence floor (G7). The tile therefore counted topics the tab
      // refused to display, on the same screen, at the same moment.
      needAttention: topicGroups.needs_attention.length,
    }),
    [snapshot?.mistake_count, topicGroups.needs_attention, practiceAnalytics?.by_topic],
  );

  const milestones = useMemo(() => {
    // THE SAME §6.4 LADDER THE REST OF THE PAGE USES.
    //
    // This was handed `analysis.trend.improvement_pct` — the difference
    // between the last session's accuracy and the one before it — and turned
    // it into a milestone reading "Accuracy up 12%". Two sessions is not a
    // trend; it is one good sitting after one bad one, and TREND_MIN_SESSIONS
    // is four for that reason. A milestone is the strongest claim this page
    // makes, so it gets the strictest test: enough sessions AND movement past
    // TREND_DELTA_POINTS, or no milestone at all.
    //
    // recent_sessions arrives newest-first; trendState reads a run in the
    // order it happened.
    const { state: accuracyTrend, deltaPoints } = trendState(
      (analysis?.recent_sessions ?? []).slice().reverse().map((x) => x.accuracy_pct),
    );
    const built = buildMilestones(
      snapshot ?? {},
      accuracyTrend === "improving" ? deltaPoints : null,
    );
    const streak = overview.streak;
    const items: { title: string; desc: string; date: string; icon: string; category: string }[] = built.map((m) => ({
      title: m.title,
      desc: m.detail ?? "",
      date: m.when,
      // Was the three characters U+00E2 U+00AD U+0090 - a star read back as
      // Latin-1 after a non-UTF-8 round trip, so every badge milestone
      // rendered mojibake where its icon should be. src/lib/utf8Text.ts
      // repairs this class of damage in DATA; this one was in the source.
      icon: m.badge ? "⭐" : "📈",
      category: m.badge ?? "Progress",
    }));
    if (streak >= STREAK_ESTABLISHED) {
      items.unshift({
        title: `${streak}-day practice streak`,
        desc: "Keep practising daily to maintain your streak.",
        date: "Recent",
        icon: "🔥",
        category: "Consistency",
      });
    }
    if (overview.totalQuestions >= PRACTICE_QUESTIONS_MILESTONE) {
      items.push({
        title: `${pluralise(overview.totalQuestions, "question")} solved`,
        desc: "Total practice questions attempted so far.",
        date: "Recent",
        icon: "📚",
        category: "Practice",
      });
    }
    return items;
  }, [snapshot, analysis?.recent_sessions, overview]);

  const personalInsights = useMemo(() => {
    // Unmeasured subjects are not the weakest — they are unranked. Sorting
    // them as zero made "Subject needing more practice" name whichever
    // subject the student had only skipped.
    const sorted = subjectData
      .filter((x) => x.accuracy != null)
      .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const weakTopic = snapshot?.weak_topics?.[0];
    const bestDay = studyActivity.bestDay;
    // CHUNK 10.7 / §10.8. Two changes, and the second is the one that matters.
    //
    // The annotation: `const items = []` infers `never[]` under strictNullChecks,
    // so every push was an error. Annotated, not asserted.
    //
    // The removal: this list led with a card headed "Your strongest subject
    // right now", carrying the subject name, its accuracy and a star. §10.8 —
    // "Strong areas are never shown anywhere in the app. The product surfaces
    // weaknesses only."
    //
    // It survived the identifier gate (`strongest` is not `strong_` and not
    // `strongCamelCase`) AND the prose sweep in 58acb2e, which found five
    // user-visible strings and not this one. It took a THIRD widening — prose
    // matching over superlatives — to see it.
    const items: {
      label: string;
      value: string;
      sub: string;
      color: string;
      icon: JSX.Element;
    }[] = [];
    if (weakest && weakest.name !== strongest?.name) {
      items.push({
        label: "Subject needing more practice",
        value: weakest.name,
        sub: `${weakest.accuracy}% accuracy`,
        color: "hsl(var(--warning))",
        icon: <Target className="w-4 h-4" />,
      });
    }
    if (weakTopic) {
      items.push({
        label: "Suggested priority today",
        value: displayTopic(weakTopic.topic) || displayChapter(weakTopic.chapter) || displaySubject(weakTopic.subject),
        sub: `${Math.round(weakTopic.accuracy)}% accuracy · needs review`,
        color: "hsl(var(--info))",
        icon: <ChevronRight className="w-4 h-4" />,
      });
    }
    if (bestDay !== "—") {
      items.push({
        label: "Most active day recently",
        value: bestDay,
        sub: `${formatStudyTime(studyActivity.totalMinutes || null)} of study time in the last 4 weeks`,
        color: "hsl(var(--info))",
        icon: <Calendar className="w-4 h-4" />,
      });
    }
    // The same figure the Practice tab prints, from the same call. The sub
    // line said "Based on your latest practice session" and never was: the
    // figure it described spanned every timed session the page had loaded.
    if (subjectPace.avgSec > 0) {
      items.push({
        label: "Average time per question",
        value: formatSeconds(subjectPace.avgSec),
        sub: "Across every question you were timed on",
        color: "hsl(var(--destructive))",
        icon: <Clock className="w-4 h-4" />,
      });
    }
    return items;
  }, [subjectData, snapshot?.weak_topics, studyActivity, subjectPace.avgSec]);

  const questionCards = useMemo(() => {
    // NO CLASS RANK HERE. §6.7: analysis must never "compare the student to
    // other students (leaderboards are separate, §10.16)". This card rendered
    // "Rank #3 of 40" directly under the heading "How am I doing?", which is
    // the comparison the section forbids, on the one screen that is supposed
    // to be about this student's own learning and nobody else's.
    //
    // The streak stays: it is the student against their own last week, not
    // against a classmate.
    const streakText = overview.streak > 0 ? `${overview.streak}-day streak` : "No streak yet";
    const weakSubjects = subjectData
      .filter((s) => s.status === "needs-attention")
      .map((s) => s.name);
    const improveText = weakSubjects.length > 0
      ? weakSubjects.join(" & ")
      : subjectData.length > 0 ? "Keep building consistency" : "Start practising to see insights";
    // THE SAME FILTERED SET THE TOPICS TAB SHOWS, for the same reason as the
    // tile above. "What should I study next?" read weak_topics[0] raw, so the
    // page could name a topic as the one thing to work on and then decline to
    // list it — because it had one attempt behind it, or no real label.
    const weakTopics = topicGroups.needs_attention;
    const weakCount = weakTopics.length;
    const nextTopic = weakTopics[0];
    return [
      {
        q: "How am I doing?",
        a: overview.accuracy == null
          ? "No practice yet"
          : `${overview.accuracy}% accuracy overall`,
        sub: streakText,
        color: "hsl(var(--info))",
        icon: <TrendingUp className="w-4 h-4" />,
      },
      {
        q: "What should I improve?",
        a: improveText,
        // "1 topic need attention" — the noun was pluralised and the VERB was
        // not, so the singular case was ungrammatical on screen. pluralise()
        // handles the noun; the verb has to agree with it.
        sub: weakCount > 0
          ? `${pluralise(weakCount, "topic")} ${weakCount === 1 ? "needs" : "need"} attention`
          : "No weak topics flagged yet",
        color: "hsl(var(--warning))",
        icon: <Target className="w-4 h-4" />,
      },
      {
        q: "What should I study next?",
        a: nextTopic ? (nextTopic.topic || nextTopic.subject) : "Start a practice session",
        sub: revisionData.dueToday.length > 0
          ? `${pluralise(revisionData.dueToday.length, "revision item")} due today`
          : "Check your revision queue",
        color: "hsl(var(--primary))",
        icon: <BookOpen className="w-4 h-4" />,
      },
    ];
  }, [overview, subjectData, topicGroups.needs_attention, revisionData.dueToday.length]);

  // FIRST POINT AGAINST LAST POINT IS NOT A TREND, and points are not percent.
  //
  // This was `last.score - first.score`, rendered as "-60% over recent
  // sessions". Two failures in one line:
  //
  //   · two points. §6.4 and TREND_MIN_SESSIONS exist because a run that
  //     opens on a good sitting and closes on a bad one is not a decline, and
  //     this line took the two most extreme-in-time points of the run and
  //     ignored everything between them.
  //   · "%" on a difference of two percentages. Sixty-eight down to eight is
  //     sixty POINTS, not sixty percent; the same confusion the month
  //     comparison was corrected for on this page.
  //
  // trendState is the ladder everything else here uses: null below the floor,
  // and no caption rather than a confident one.
  const { state: scoreTrendState, deltaPoints: scoreTrendDelta } = useMemo(
    () => trendState(scoreTrend.map((p) => p.score)),
    [scoreTrend],
  );

  const monthComparison = useMemo(
    () =>
      deriveMonthComparison(analysis?.recent_sessions ?? [], snapshot?.activity_heatmap),
    [analysis?.recent_sessions, snapshot?.activity_heatmap],
  );

  const scoreTrendDomain = useMemo(
    () => scoreAxisDomain(scoreTrend.map((p) => p.score)),
    [scoreTrend],
  );

  const upcomingMilestones = useMemo(() => {
    // Annotated, not asserted: `[]` infers never[] under strictNullChecks.
    const items: { title: string; progress: number; target: number; unit: string }[] = [];
    // EVERY TARGET HERE IS THE CONSTANT THAT DECIDES IT.
    //
    // The condition used STREAK_MILESTONE and then wrote `target: 15` and
    // "Reach 15-day..." beside it; the same for 100, three times over. Moving
    // a milestone would have moved the bar the page tests and left the bar it
    // shows the student where it was.
    if (overview.streak < STREAK_MILESTONE && overview.streak > 0) {
      items.push({
        title: `Reach ${STREAK_MILESTONE}-day practice streak`,
        progress: overview.streak,
        target: STREAK_MILESTONE,
        unit: "days",
      });
    }
    if (overview.totalQuestions < PRACTICE_QUESTIONS_MILESTONE) {
      items.push({
        title: `Solve ${PRACTICE_QUESTIONS_MILESTONE} practice questions`,
        progress: overview.totalQuestions,
        target: PRACTICE_QUESTIONS_MILESTONE,
        unit: "questions",
      });
    }
    // `accuracy != null` replaces the old `> 0`, which was doing this job by
    // accident: subjectData used to carry 0 for "nothing measured", so the
    // guard excluded a genuine 0% too. Null now means unmeasured and 0 means
    // zero correct, and each is handled as what it is.
    //
    // THE TARGET WAS 75 AND NOTHING IN THE PRODUCT USES 75.
    //
    // The test beside it is `!["high","near"].includes(band)`, and a subject
    // becomes "near" at ACCURACY_CONCEPTUAL — 70. So the bar this subject
    // must clear to stop being flagged is 70, while the page told the student
    // to reach 75: a goal five points past the one the page itself applies,
    // invented at the call site and matching no boundary in the band module.
    //
    // `.find` also took whichever weak subject came first in by_subject
    // order, which is most-attempts-first — an arbitrary pick presented as
    // the thing to work on. It is the weakest MEASURED subject now; unmeasured
    // subjects are unranked, not weak, which is why the null check stays.
    const weak = subjectData
      .filter((s) => s.accuracy != null && !["high", "near"].includes(accuracyBand(s.accuracy)))
      .sort((a, b) => (a.accuracy as number) - (b.accuracy as number))[0];
    if (weak?.accuracy != null) {
      items.push({
        title: `Improve ${weak.name} above ${ACCURACY_CONCEPTUAL}%`,
        progress: weak.accuracy,
        target: ACCURACY_CONCEPTUAL,
        unit: "%",
      });
    }
    return items;
  }, [overview, subjectData]);

  // Analysis had NO page title at all.
  //
  // Nineteen screens took the shared PageHeader; this one was missed, so the
  // deepest analytical screen in the panel opened on a card labelled "Summary"
  // with nothing naming the screen or saying which section it belonged to. The
  // three screens that legitimately have no header are Home (its greeting is
  // the header), Battleground (its own visual language) and AI Coach (no page
  // body to title) — Analysis was never one of them.
  //
  // The title needs no network either, so it no longer waits for one.
  const header = (
    <PageHeader
      eyebrow="Learning"
      title="Analysis"
      subtitle="What your practice, tests and mistakes add up to."
    />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <PageSkeleton label="Loading analysis" className="space-y-6">
          <SkeletonCard className="p-5 space-y-3">
            <Skeleton className="h-5 w-24" />
            <div className="grid sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-48" />
              ))}
            </div>
          </SkeletonCard>
          <div className="grid sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} className="p-4 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </SkeletonCard>
            ))}
          </div>
          <div className="flex gap-4 border-b border-border/70 pb-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-20" />
            ))}
          </div>
          <SkeletonStats count={4} />
          <div className="grid sm:grid-cols-2 gap-3">
            <SkeletonCard className="h-40" />
            <SkeletonCard className="h-40" />
          </div>
        </PageSkeleton>
      </div>
    );
  }

  if (!academicReady) {
    return <div className="space-y-6">{header}<NoStudentProfile /></div>;
  }

  // ATTENDANCE IS NOT HERE ANY MORE.
  //
  // It was the one figure on this page that practice does not produce —
  // attendance_current, present over total — and analysisTabs.ts states the
  // rule in its own words: "Analysis is fed by practice and by nothing else —
  // not test data, and not exam/marks data either." Attendance is school data.
  // It was kept when marks went, on the argument that it is a measured figure
  // rather than a composite; that made it honest, not relevant. A student
  // reading their practice analysis cannot act on it here, and their
  // attendance surface already shows it.
  //
  // null means "no figure recorded", never 0. See the Summary block below.
  const summaryRows: { label: string; value: string | number | null }[] = [
    // THE SAME ACCURACY THE OVERVIEW TILE PRINTS, from the same counts (G5).
    //
    // This read practiceAccuracyFromSnapshot(snapshot), which is
    // exam_readiness.practice_accuracy_pct — a SECOND source for the one
    // rate on this page, sitting in the header directly above a tile that
    // computes it from analysis.totals. They agreed only for as long as the
    // two pipelines agreed about one student.
    //
    // Worse, that helper falls back to `exam_readiness.accuracy_pct` when
    // practice_accuracy_pct is null, and accuracy_pct is the TEST + PRACTICE
    // BLEND. A page that issues no query against marks (rule 11) could
    // therefore print a number containing exam marks, under the label
    // "Practice accuracy", with nothing on screen to reveal it — the §4.2b
    // blend arriving by the back door.
    //
    // overview.accuracy is correct / (correct + wrong) over question_attempts
    // and is null, never 0, when nothing has been answered. The helper stays
    // where it is for the surfaces that legitimately read readiness; this
    // page has its own figure and must not have two.
    { label: "Practice accuracy", value: overview.accuracy == null ? null : `${overview.accuracy}%` },
    { label: "Study consistency", value: hasStudyActiveDays(snapshot) ? `${studyActiveDaysFromSnapshot(snapshot)} active days (14d)` : null },
    { label: "Open mistakes", value: snapshot?.mistake_count ?? null },
    { label: "Recovery pending", value: snapshot?.recovery_pending ?? null },
  ];

  return (
    <div className="space-y-6">
      {header}
      {/* "Showing available stats as zeros where missing" — THE PAGE DOES
          NOT DO THAT, and has been corrected three times specifically so that
          it does not. Missing renders as an em dash precisely so a student
          never reads an absent measurement as a score of zero; this banner
          told them to read it as zero anyway, which is the defect those
          corrections exist to prevent, restated as help text.

          It also left them with no way forward: all four hooks expose
          reload() and none of them was wired, so a transient failure meant
          navigating away and back. */}
      {loadError && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex-1 min-w-[16rem]">
            Some analysis data could not be loaded: {loadError}. Anything
            missing is shown as — rather than as a figure.
          </span>
          <button
            type="button"
            onClick={retryAll}
            className="shrink-0 rounded-lg border border-warning/40 px-3 py-1 font-semibold hover:bg-warning/20 transition-colors"
          >
            Try again
          </button>
        </div>
      )}
      {/* ── Summary ──────────────────────────────────────────────────────
          Five figures in one place. Ported from AcademicReport (Chunk 10.6),
          which was the only screen that put them together; Analysis had them
          scattered or absent.

          The ?? 0 that AcademicReport used on attendance, mistakes and recovery
          is deliberately NOT ported. A student with nothing recorded has no
          figure, not a zero — and "Attendance 0%" is the most alarming number
          this row can display, invented from an absence. */}
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Summary</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {summaryRows.map((row) => (
            <p key={row.label}>
              {row.label}:{" "}
              {row.value === null ? (
                <span className="text-muted-foreground">not recorded yet</span>
              ) : (
                <strong>{row.value}</strong>
              )}
            </p>
          ))}
        </div>
      </div>

      {/* ── 3 Questions bar ─────────────── */}
      <div className="grid sm:grid-cols-3 gap-3">
        {questionCards.map((item) => (
          <div
            key={item.q}
            className="rounded-2xl border p-4"
            style={{ borderColor: `${withAlpha(item.color, 0.15)}`, background: `${withAlpha(item.color, 0.03)}` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span style={{ color: item.color }}>{item.icon}</span>
              <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: item.color }}>{item.q}</span>
            </div>
            <div className="text-sm font-bold text-foreground leading-tight">{item.a}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Tab bar ─────────────────────── */}
      <div className="flex gap-0 overflow-x-auto border-b border-border/70 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ───────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Questions solved",   value: overview.totalQuestions.toLocaleString(), color: "hsl(var(--foreground))" },
              { label: "Correct answers",    value: overview.correct.toLocaleString(),        color: "hsl(var(--info))" },
              { label: "Incorrect answers",  value: overview.incorrect.toLocaleString(),      color: "hsl(var(--destructive))" },
              // Was a tile whose LABEL changed between "Average score" and
              // "Accuracy" depending on whether the student had exam marks —
              // two different measures wearing one slot. It is practice
              // accuracy now, always, and named that way.
              { label: "Accuracy",           value: overview.accuracy == null ? "—" : `${overview.accuracy}%`, color: "hsl(var(--warning))" },
              // §6.6. Its own tile, not folded into "Incorrect answers", which
              // is where it used to go: `wrong = total - correct` counted every
              // skip as a wrong answer, so the student was told they had got
              // wrong what they had in fact never attempted. Accuracy now
              // excludes skips, which makes surfacing them necessary rather
              // than optional — otherwise a heavy skipper simply looks better
              // and nothing on the screen says why.
              { label: "Skipped",            value: overview.skipped.toLocaleString(),        color: "hsl(var(--muted-foreground))" },
              { label: "Practice sessions",  value: overview.practiceCompleted ?? "—",         color: "hsl(var(--foreground))" },
              // "Marks recorded" was a count of exam marks. Marks are not an
              // Analysis figure any more (rule 11); the student reads them on
              // their marks surface.
              // "Study time total" was a WINDOW wearing the word total.
              // rpc_student_academic_snapshot builds activity_heatmap from
              // `activity_date >= CURRENT_DATE - 28`, so this tile has always
              // been four weeks — measured, it read 14m for a student with 15
              // recorded minutes, the missing one being 33 days old. The chart
              // on Activity & Speed already says "last 4 weeks"; the tiles that
              // sum the same rows now say it too.
              { label: "Study time (4 weeks)",  value: formatStudyTime(studyActivity.totalMinutes || null), color: "hsl(var(--info))" },
              // "Exam readiness" was removed in the v2 redesign: a composite of
              // four measures collapsed into one number, which is the
              // no-blended-score rule and cannot be explained to a student.
              // `exam_readiness.attendance_pct` is still read below — that is
              // attendance, a measured figure, not the composite.
            ].map((s) => (
              <Metric key={s.label} label={s.label} value={s.value} color={s.color} />
            ))}
          </div>

          {/* Score over time */}
          {/* Not "7 weeks". scoreTrend is charts.practice_trend, which
              rpc_student_performance_charts builds from the last 30 days, and
              falls back to the recent-sessions list — never seven weeks of
              anything. */}
          <Card label="How your score changed — your recent sessions">
            {scoreTrend.length > 0 ? (
            <>
            <div className="h-48 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreTrend}>
                  <defs>
                    <linearGradient id="an-scGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={scoreTrendDomain} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="score" name="Score" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#an-scGrad)"
                    isAnimationActive={false} dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }} activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--card))", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* Only when §6.4 says there is a direction to report. "stuck" and
                "not_enough_data" both render nothing here — the chart above is
                still the honest picture in either case. */}
            {(scoreTrendState === "improving" || scoreTrendState === "worsening") && scoreTrendDelta != null && (
            <div className="flex items-center gap-2 mt-2">
              {scoreTrendDelta > 0 ? (
                <ArrowUp className="w-3.5 h-3.5 text-success" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-destructive" />
              )}
              <span className={cn("text-xs font-medium", scoreTrendDelta > 0 ? "text-success" : "text-destructive")}>
                {scoreTrendDelta > 0 ? "+" : ""}{scoreTrendDelta} points across these sessions
              </span>
            </div>
            )}
            </>
            ) : (
              <p className="text-sm text-muted-foreground mt-4 py-8 text-center">No score trend data yet</p>
            )}
          </Card>

          {/* This week vs last week */}
          {/* NOT QUESTIONS. buildWeekComparison sums weekly_activity.total,
              which rpc_student_performance_charts builds as
              test_count + homework_count + battle_count + self_practice_count.
              This is the fourth panel on the page to have read that column as
              questions; the other three were corrected on 2026-09-17 and this
              one was missed because its title says it in prose rather than in
              a dataKey. */}
          <Card label="This week vs last week — activities">
            {weekComparison.some((d) => d.thisWeek > 0 || d.lastWeek > 0) ? (
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekComparison} barSize={14} barGap={2}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="thisWeek" name="This week" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
                  <Bar dataKey="lastWeek" name="Last week" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-4 py-8 text-center">No weekly activity yet</p>
            )}
          </Card>

          {/* Personal Insights */}
          <div>
            <SLabel>Personal insights</SLabel>
            {personalInsights.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {personalInsights.map((ins) => (
                <div key={ins.label} className="flex items-start gap-3 p-4 rounded-xl border border-border/70 bg-surface/60 hover:border-border transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${withAlpha(ins.color, 0.08)}`, color: ins.color }}>
                    {ins.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{ins.label}</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">{ins.value}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{ins.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">Practice more to unlock personal insights</p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Subjects & Chapters ────── */}
      {tab === "subjects" && (
        <div className="space-y-6">
          {/* Subject radar */}
          <div className="grid sm:grid-cols-2 gap-6">
            <Card label="How you perform in each subject">
              {radarData.length > 0 ? (
              <div className="h-56 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 600 }} />
                    <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2.5} isAnimationActive={false}/>
                    <Tooltip content={<ChartTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              ) : (
                <p className="text-sm text-muted-foreground py-12 text-center">No subject data yet</p>
              )}
            </Card>

            <div className="space-y-3">
              <SLabel>Subjects at a glance</SLabel>
              {subjectData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No subjects tracked yet</p>
              ) : subjectData.map((s) => (
                <div key={s.name} className="flex items-center gap-3 p-3 rounded-xl border border-border/70 bg-surface/60 hover:border-border transition-colors">
                  <div className="w-2 h-10 rounded-full shrink-0" style={{ background: s.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{displaySubject(s.name) || s.name}</span>
                      {/* The "Best subject" badge that stood here was §10.8's
                          exact prohibition — a list filtered to the highest.
                          The accuracy figure beside it is unchanged and still
                          shown for every subject, high and low alike. */}
                      {/* No floor re-applied here. `status` is derived from
                          the row's gated accuracy, so it cannot be
                          "needs-attention" without a rate behind it. */}
                      {s.status === "needs-attention" && <span className="text-[9px] uppercase tracking-wider text-warning bg-warning/10 px-1.5 py-0.5 rounded-full">Needs attention</span>}
                    </div>
                    {/* formatStudyTime, not a bare `${hours}h`: this printed "0.1h study
                        time" for six measured minutes, and "0h" for anything under
                        half an hour. Silent when the subject's sessions were never
                        timed — a subject with no measurement makes no claim. */}
                    {/* "Attempts", matching the chapter cards below — the same quantity
                        was called "questions" here and "Attempts" there, on one tab. */}
                    <div className="text-[11px] text-muted-foreground mt-0.5">{pluralise(s.questions, "attempt")}{s.measuredMinutes != null && s.measuredMinutes > 0 ? ` · ${formatStudyTime(s.measuredMinutes)} study time` : ""}</div>
                    <div className="h-1 rounded-full bg-muted mt-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s.score}%`, background: s.color }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {s.score == null ? (
                      <>
                        <div className="text-lg font-black tabular-nums text-muted-foreground">—</div>
                        <div className="text-[10px] text-muted-foreground">not enough yet</div>
                      </>
                    ) : (
                      <>
                        <div className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.score}%</div>
                        <TrendCell state={s.trendState} deltaPoints={s.trend} size="xs" />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chapter breakdown */}
          <div>
            <SLabel>Chapter by chapter</SLabel>
            {chapterData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No chapter data yet</p>
            ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {chapterData.map((c) => {
                const statusLabel: Record<string, { text: string; color: string }> = {
                  "ready":        { text: "Ready for revision", color: "hsl(var(--success))" },
                  "practice-more":{ text: "Practice more",      color: "hsl(var(--warning))" },
                  "needs-work":   { text: "Needs attention",    color: "hsl(var(--destructive))" },
                };
                // Below the floor the card still appears and still says what
                // the student did — the Attempts cell carries the count and the
                // Accuracy cell says "not enough yet". It just stops telling
                // them what it means: no verdict badge, no rate, no bar.
                //
                // The floor itself is applied where chapterData is built, on
                // the answers the rate is computed from. This site used to
                // re-apply it against `c.questions`, the ATTEMPT count, which
                // is how "Circles · Needs attention · 8 Attempts · 0%
                // Accuracy" reached a student off seven skips and one wrong
                // answer.
                const meaningful = c.accuracy;
                const judged = meaningful != null;
                const st = statusLabel[c.status];
                return (
                  <div key={`${c.subject}-${c.chapter}`} className="p-4 rounded-xl border border-border/70 bg-surface/60 hover:border-border transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{displayChapter(c.chapter)}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: c.color }}>{displaySubject(c.subject)}</div>
                      </div>
                      {judged ? (
                        <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: st.color, background: `${withAlpha(st.color, 0.07)}` }}>
                          {st.text}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {/* THE COUNT, not a percentage of five. This cell read
                          "{practiceDepth}% · Practice" — progress toward the
                          five attempts accuracy needs — which a student reads
                          as having covered that much of the chapter. */}
                      <div className="text-center">
                        <div className="text-sm font-black tabular-nums text-foreground">{c.questions}</div>
                        <div className="text-[9px] text-muted-foreground">{c.questions === 1 ? "Attempt" : "Attempts"}</div>
                      </div>
                      <div className="text-center">
                        <div className={cn("text-sm font-black tabular-nums", meaningful == null ? "text-muted-foreground" : "text-foreground")}>
                          {meaningful == null ? "—" : `${meaningful}%`}
                        </div>
                        <div className="text-[9px] text-muted-foreground">{meaningful == null ? "not enough yet" : "Accuracy"}</div>
                      </div>
                      <div className="text-center">
                        <TrendCell state={c.trendState} deltaPoints={c.trend} />
                        <div className="text-[9px] text-muted-foreground">Change</div>
                      </div>
                    </div>
                    {/* The bar is the ACCURACY in the cell above it, so the
                        card has one quantity drawn one way. It used to be the
                        depth figure, which made a chapter with five attempts
                        and no correct answers render as a full bar. Nothing is
                        drawn below the judgement floor — an empty track is the
                        honest picture of "not enough yet". */}
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      {meaningful != null && (
                        <div className="h-full rounded-full" style={{ width: `${meaningful}%`, background: c.color }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Topics ─────────────────── */}
      {tab === "topics" && (
        <div className="space-y-6">
          {/* Learning journey overview */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Open mistakes",    value: learningProgress.openMistakes, color: "hsl(var(--destructive))", icon: <AlertCircle className="w-5 h-5" /> },
              { label: "Topics practised",  value: learningProgress.topicsPractised, color: "hsl(var(--info))", icon: <BookOpen className="w-5 h-5" /> },
              { label: "Need attention",    value: learningProgress.needAttention,   color: "hsl(var(--warning))", icon: <Target className="w-5 h-5" /> },
            ].map((item) => (
              <div key={item.label} className="p-4 rounded-xl border border-border/70 bg-surface/60 text-center">
                <div className="flex justify-center mb-2" style={{ color: item.color }}>{item.icon}</div>
                <div className="text-2xl font-black tabular-nums" style={{ color: item.color }}>{item.value}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-6">
            {/* Doing well removed — §10.8 */}
            {/* Needs attention */}
            <div>
              <SLabel>Topics that need your attention</SLabel>
              <div className="space-y-2">
                {topicGroups.needs_attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nothing flagged yet — a topic needs a few attempts behind it
                    before we call it weak.
                  </p>
                ) : topicGroups.needs_attention.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-warning/12 bg-warning/5 hover:border-warning/25 transition-colors cursor-pointer">
                    <AlertCircle className="w-4 h-4 text-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{displayTopic(t.topic)}</div>
                      {/* G7: the row always reports what the student DID.
                          Accuracy only appears above MIN_OBSERVATIONS_FOR_VERDICT —
                          62% of topic groups hold one question, and one attempt
                          makes accuracy 0% or 100%, which is noise dressed as a
                          measurement. */}
                      <div className="text-[11px] text-muted-foreground">
                        {displaySubject(t.subject)} · {pluralise(t.practiceCount ?? 0, "attempt")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {accuracyWhenMeaningful(t.practiceCount ?? 0, t.score) === null ? (
                        <>
                          <div className="text-sm font-black text-muted-foreground">—</div>
                          <div className="text-[10px] text-muted-foreground">not enough yet</div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm font-black text-warning">{t.score}%</div>
                          <div className="text-[10px] text-muted-foreground">accuracy</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Improving */}
            <div>
              <SLabel>Chapters getting better</SLabel>
              <div className="space-y-2">
                {topicGroups.improving.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No improvement trends yet</p>
                ) : topicGroups.improving.map((t) => (
                  <div key={t.chapter} className="flex items-center gap-3 p-3 rounded-xl border border-border/70 bg-surface/60 hover:border-border transition-colors">
                    <TrendingUp className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      {/* displayCHAPTER. presentAcademicLabel resolves against
                          a per-kind dictionary, and these rows are grouped by
                          chapter — formatting one as a topic asks the wrong
                          dictionary for the name. */}
                      <div className="text-sm font-semibold text-foreground truncate">{displayChapter(t.chapter)}</div>
                      <div className="text-[11px] text-muted-foreground">{displaySubject(t.subject)}</div>
                    </div>
                    {/* Points, not percent — the same correction as TrendCell below. */}
                    <span className="text-sm font-black text-success shrink-0">
                      +{t.improvement} {t.improvement === 1 ? "pt" : "pts"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* QUESTIONS THEY KEEP GETTING WRONG.
                This slot held "Topics yet to begin", which listed
                concept_mastery rows at zero attempts — rows that happen to
                exist, not a syllabus. student_mistakes.times_wrong is
                populated and is the most actionable number on the page:
                measured, one question missed eight times and another seven,
                and nothing anywhere showed it. */}
            <div>
              <SLabel>Questions you keep getting wrong</SLabel>
              <div className="space-y-2">
                {(practiceAnalytics?.recurring ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nothing has caught you out twice yet.
                  </p>
                ) : (practiceAnalytics?.recurring ?? []).map((r, i) => (
                  <div key={`${r.topic ?? r.chapter ?? "q"}-${i}`} className="flex items-start gap-3 p-3 rounded-xl border border-destructive/12 bg-destructive/5">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {displayTopic(r.topic ?? "") || displayChapter(r.chapter ?? "") || "This question"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.question_text ?? displaySubject(r.subject ?? "")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-destructive tabular-nums">{r.times_wrong}&times;</div>
                      <div className="text-[10px] text-muted-foreground">{formatLastSeen(r.last_wrong_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recovery & Revision */}
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <SLabel>Topics you practised again</SLabel>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-border/70 bg-surface/60 text-center">
                  <div className="text-xl font-black text-foreground">{recoveryProgress.completed}</div>
                  <div className="text-[11px] text-muted-foreground">Recovered</div>
                </div>
                <div className="p-3 rounded-xl border border-border/70 bg-surface/60 text-center">
                  <div className="text-xl font-black text-warning">{recoveryProgress.stillPending}</div>
                  <div className="text-[11px] text-muted-foreground">Ready now</div>
                </div>
              </div>
              <div className="space-y-2">
                {recoveryTopics.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No recovery topics yet</p>
                ) : recoveryTopics.map((r) => (
                  <div key={r.topic} className="flex items-center gap-3 p-3 rounded-xl border border-border/70 bg-surface/60">
                    {r.status === "recovered"
                      ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      : <Clock className={cn("w-4 h-4 shrink-0", r.status === "ready" ? "text-destructive" : "text-muted-foreground")} />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{displayTopic(r.topic)}</div>
                      <div className="text-[11px] text-muted-foreground">{displaySubject(r.subject)}</div>
                    </div>
                    {/* The count, not a percentage. The old card showed an
                        invented "+N%" improvement derived by comparing a
                        mastery score against a weak-topic accuracy from a
                        different table; open mistakes is the figure the
                        engine actually turns on. */}
                    {r.status === "recovered"
                      ? <span className="text-xs font-semibold text-success">Recovered</span>
                      : r.status === "ready"
                        ? <span className="text-xs font-semibold text-destructive">Ready</span>
                        : r.status === "relearn"
                          ? <span className="text-xs font-semibold text-warning">
                              {pluralise(r.openMistakes, "mistake")} — work through the book
                            </span>
                          : <span className="text-[11px] text-muted-foreground tabular-nums">{r.openMistakes} of {r.triggerCount}</span>
                    }
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SLabel>Revision status</SLabel>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-border/70 bg-surface/60 text-center">
                  <div className="text-xl font-black text-success">{revisionData.completed}</div>
                  <div className="text-[11px] text-muted-foreground">Done</div>
                </div>
                <div className="p-3 rounded-xl border border-border/70 bg-surface/60 text-center">
                  <div className="text-xl font-black text-warning">{revisionData.pending}</div>
                  <div className="text-[11px] text-muted-foreground">Pending</div>
                </div>
                <div className="p-3 rounded-xl border border-border/70 bg-surface/60 text-center">
                  <div className="text-xl font-black text-foreground">{revisionData.dueToday.length}</div>
                  <div className="text-[11px] text-muted-foreground">Due today</div>
                </div>
              </div>
              <SLabel>Due for revision today</SLabel>
              <div className="space-y-2">
                {revisionData.dueToday.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nothing due for revision today</p>
                ) : revisionData.dueToday.map((topic) => (
                  <div key={topic} className="flex items-center gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                    <Clock className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm text-foreground">{displayTopic(topic)}</span>
                    <span className="ml-auto text-[10px] text-primary font-semibold">Due today</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Practice & Tests ────────── */}
      {tab === "practice" && (
        <div className="space-y-6">
          {/* Practice stats */}
          <div>
            {/* weekDone sums charts.weekly_activity, which is the last 28
                days, not a week — the RPC's key is misnamed and the label
                inherited it. */}
            <SLabel>Your practice — last 4 weeks</SLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                // Both count ACTIVITIES — the heat map's own cells, which are
                // tests + homework + battles + practice sessions. "Done today"
                // sat beside "Activities in 4 weeks" naming the same unit two
                // ways, under a heading that says practice.
                { label: "Activities today",      value: `${practiceStats.todayDone}`,  color: "hsl(var(--primary))" },
                { label: "Activities in 4 weeks", value: `${practiceStats.weekDone}`,   color: "hsl(var(--info))" },
                { label: "Practice streak",   value: pluralise(practiceStats.streakDays, "day"),                        color: "hsl(var(--warning))" },
                { label: "Consistency",       value: `${practiceStats.consistency}%`,                           color: "hsl(var(--success))" },
              ].map((s) => <Metric key={s.label} label={s.label} value={s.value} color={s.color} />)}
            </div>
          </div>

          {/* Practice monthly */}
          {/* NOT QUESTIONS. practiceMonthly sums weekly_activity.total, which
              rpc_student_performance_charts builds as
              test_count + homework_count + battle_count + self_practice_count.
              The heat-map tooltip two panels down was corrected to say
              "activities" for this exact reason; the correction was made there
              and not here, so the same table kept being read as questions. */}
          <Card label="Practice activity each month">
            {practiceMonthly.length > 0 ? (
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={practiceMonthly} barSize={32}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="done" name="Activities" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {practiceMonthly.map((_, i) => (
                      <Cell key={i} fill={i === practiceMonthly.length - 1 ? "hsl(var(--primary))" : withAlpha("hsl(var(--primary))", 0.35)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-4 py-8 text-center">No monthly activity yet</p>
            )}
          </Card>

          {/* Speed */}
          <div>
            <SLabel>How fast you solve questions</SLabel>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <Metric label="Average per question"  value={subjectPace.avgSec > 0 ? formatSeconds(subjectPace.avgSec) : "—"}    color="hsl(var(--foreground))" />
              {/* Each tile asks about its OWN number. A sub line gated on the
                  overall average printed "0s avg" under a "—" whenever only
                  one subject had enough timed questions to rank. */}
              <Metric label="Fastest subject"        value={subjectPace.fastest?.name ?? "—"}  color="hsl(var(--success))" sub={subjectPace.fastest ? `${formatSeconds(subjectPace.fastest.avgSec)} avg` : undefined} />
              <Metric label="Takes most time"        value={subjectPace.slowest?.name ?? "—"}  color="hsl(var(--warning))" sub={subjectPace.slowest ? `${formatSeconds(subjectPace.slowest.avgSec)} avg` : undefined} />
            </div>
            {/* ── How you do by difficulty ───────────────────────────
                Every attempt carries a difficulty and nothing read it. The
                reading is the SHAPE, not any one bar: a student scoring worse
                on easy than on hard is making careless errors, which is a
                different thing to fix than not knowing the hard material. */}
            <Card label="How you do by difficulty">
              {(practiceAnalytics?.by_difficulty ?? []).filter((d) => mayBeJudged(d.answered)).length === 0 ? (
                <p className="text-sm text-muted-foreground mt-4 py-8 text-center">
                  Not enough attempts at any difficulty yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {(practiceAnalytics?.by_difficulty ?? [])
                    .filter((d) => mayBeJudged(d.answered))
                    .map((d) => (
                    <div key={d.difficulty} className="text-center p-3 rounded-xl border border-border/70 bg-surface/60">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{d.difficulty}</div>
                      <div className="text-xl font-black tabular-nums text-foreground">
                        {d.accuracy == null ? "—" : `${Math.round(d.accuracy)}%`}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {pluralise(d.attempts, "attempt")}
                      </div>
                      {(d.avg_sec ?? 0) > 0 && (
                        <div className="text-[10px] text-muted-foreground">{d.avg_sec}s each</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── How you work ───────────────────────────────────────────
                solution_viewed and attempt_number are written on every attempt
                and were read by nothing. Neither is a verdict: looking at a
                worked solution is studying, and meeting a question twice is
                what recovery and revision are FOR. They are reported as counts,
                with no good/bad attached. */}
            {practiceAnalytics?.effort && practiceAnalytics.effort.attempts > 0 && (
            <Card label="How you work">
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="text-center p-3 rounded-xl border border-border/70 bg-surface/60">
                  <div className="text-xl font-black tabular-nums text-foreground">
                    {Math.round((100 * practiceAnalytics.effort.solution_viewed) / practiceAnalytics.effort.attempts)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Solution opened</div>
                  <div className="text-[10px] text-muted-foreground">{practiceAnalytics.effort.solution_viewed} of {practiceAnalytics.effort.attempts}</div>
                </div>
                <div className="text-center p-3 rounded-xl border border-border/70 bg-surface/60">
                  <div className="text-xl font-black tabular-nums text-foreground">
                    {practiceAnalytics.effort.repeat_attempts}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Seen again</div>
                  <div className="text-[10px] text-muted-foreground">questions you met more than once</div>
                </div>
                <div className="text-center p-3 rounded-xl border border-border/70 bg-surface/60">
                  {/* The floor applies: first-try accuracy off three first
                      tries is not a figure. */}
                  <div className="text-xl font-black tabular-nums text-foreground">
                    {firstTryAccuracy == null ? "—" : `${firstTryAccuracy}%`}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Right first time</div>
                  <div className="text-[10px] text-muted-foreground">over {pluralise(practiceAnalytics.effort.first_try_attempts, "first try", "first tries")}</div>
                </div>
              </div>
            </Card>
            )}

            <Card label="Time per question by subject (seconds)">
              {subjectPace.rows.length > 0 ? (
              <div className="h-40 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjectPace.rows} layout="vertical" barSize={14}>
                    <CartesianGrid stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgSec" name="Seconds" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                      {subjectPace.rows.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-4 py-8 text-center">No speed data yet</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Study time (4 weeks)" value={formatStudyTime(studyActivity.totalMinutes || null)} color="hsl(var(--info))" />
            <Metric label="Average per day"     value={studyActivity.avgDailyMin == null ? "—" : `${studyActivity.avgDailyMin} min`} color="hsl(var(--foreground))" />
            <Metric label="Most active day"     value={studyActivity.bestDay}              color="hsl(var(--warning))" />
            {/* "Most active hour", not "most productive". It counts attempts,
                which is when the student WORKS — the same question "Most
                active day" beside it answers, asked of the clock instead of
                the calendar. Calling it productive would promise a judgement
                about quality that this figure does not make. */}
            <Metric label="Most active hour"    value={studyActivity.bestHour}            color="hsl(var(--info))" />
          </div>

          {/* Weekly hours */}
          <Card label="Study time by day of week — last 4 weeks (hours)">
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => ({ day: d, hours: studyActivity.weeklyHrs[i] }))}
                  barSize={28}
                >
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {studyActivity.weeklyHrs.map((v, i) => (
                      <Cell key={i} fill={v === Math.max(...studyActivity.weeklyHrs) ? "hsl(var(--primary-glow))" : withAlpha("hsl(var(--primary-glow))", 0.3)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 4-week heatmap */}
          <Card label="Practice activity — last 4 weeks">
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[380px]">
                <div className="flex gap-1 mb-2 ml-9">
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
                    <div key={d} className="flex-1 text-center text-[10px] text-muted-foreground">{d}</div>
                  ))}
                </div>
                {activityWeeks.map((row) => (
                  <div key={row.label} className="flex items-center gap-1 mb-1.5">
                    <div className="w-8 text-[10px] text-muted-foreground shrink-0">{row.label}</div>
                    {row.days.map((cell) => {
                      // The cell counts ACTIVITIES — tests, homework, battles
                      // and practice sessions — which is what
                      // academic_daily_activity stores. The tooltip called them
                      // "questions", a number this table has never held.
                      const intensity = Math.min(cell.total / 8, 1);
                      const bg = cell.total === 0
                        ? "hsl(var(--muted))"
                        : withAlpha("hsl(var(--primary))", 0.08 + intensity * 0.92);
                      return (
                        <div
                          key={cell.date}
                          title={`${cell.date} — ${pluralise(cell.total, "activity", "activities")}${
                            cell.minutes > 0 ? `, ${cell.minutes} min` : ""
                          }`}
                          className="flex-1 h-8 rounded-lg transition-all hover:scale-110 cursor-default"
                          style={{ background: bg }}
                        />
                      );
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <span className="text-[10px] text-muted-foreground">Less</span>
                  {[0.08, 0.3, 0.55, 0.75, 1].map((o) => (
                    <div key={o} className="w-3 h-3 rounded-sm" style={{ background: withAlpha("hsl(var(--primary))", o) }} />
                  ))}
                  <span className="text-[10px] text-muted-foreground">More</span>
                </div>
              </div>
            </div>
          </Card>

          {/* ── What takes longest ────────────────────────────────── */}
          <div className="grid sm:grid-cols-2 gap-6">
            <Card label="Topics that take you longest (seconds per question)">
              {slowestTopics.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-4 py-8 text-center">
                  No topic has {MIN_OBSERVATIONS_FOR_VERDICT} answered, timed questions behind it yet.
                </p>
              ) : (
                <div className="space-y-2 mt-4">
                  {slowestTopics.map((t) => (
                    <div key={t.topic} className="flex items-center gap-3 p-2.5 rounded-xl border border-border/70 bg-surface/60">
                      <Clock className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{displayTopic(t.topic)}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {displayChapter(t.chapter ?? "") || displaySubject(t.subject ?? "")} · {pluralise(t.attempts, "attempt")}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-black tabular-nums text-foreground">{t.avg_sec}s</div>
                        {/* Ranked on TIMED readings, judged on ANSWERS. A
                            topic can have five timed attempts and none of
                            them answered, which printed a bare em dash where
                            a rate goes and said nothing about why. */}
                        <div className="text-[10px] text-muted-foreground">
                          {rightRate(t.answered, t.accuracy)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card label="Chapters that take you longest (seconds per question)">
              {slowestChapters.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-4 py-8 text-center">
                  No chapter has {MIN_OBSERVATIONS_FOR_VERDICT} answered, timed questions behind it yet.
                </p>
              ) : (
                <div className="space-y-2 mt-4">
                  {slowestChapters.map((c) => (
                    <div key={c.chapter} className="flex items-center gap-3 p-2.5 rounded-xl border border-border/70 bg-surface/60">
                      <Clock className="w-4 h-4 text-info shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{displayChapter(c.chapter)}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {displaySubject(c.subject ?? "")} · {formatStudyTime(c.total_min)} total
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-black tabular-nums text-foreground">{c.avg_sec}s</div>
                        <div className="text-[10px] text-muted-foreground">
                          {rightRate(c.answered, c.accuracy)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* This month vs last month */}
          <Card label="This month vs last month">
            <div className="grid grid-cols-3 gap-4 mt-3">
              {monthComparison.map((row) => {
                // A month with nothing measured is null, not zero — "0%
                // accuracy last month" is a claim about a month the student
                // may not have practised in at all. Minutes go through the one
                // formatter; every other unit is appended as-is.
                const show = (v: number | null) =>
                  v == null ? "—" : row.unit === "min" ? formatStudyTime(v) : `${v}${row.unit}`;
                const comparable = row.thisM != null && row.lastM != null && row.lastM > 0;
                const diff = comparable ? (row.thisM as number) - (row.lastM as number) : 0;
                const up = diff > 0;

                // HOW THE CHANGE IS EXPRESSED, and it is not one rule.
                //
                // A RATE moves in POINTS. 28% to 46% is eighteen points, not
                // "+64%" — a percentage change of a percentage, which is the
                // classic way to make a modest improvement look like a
                // transformation. Every other accuracy movement on this page
                // is already in points (TrendCell, deltaPoints); this row was
                // the one place about to disagree.
                //
                // A COUNT moves in percent, but not off any base. Measured
                // live: "Activities 75 vs 1 last month +7400%" and "Study time
                // 1.8h vs 1m last month +10500%". Both are arithmetically
                // correct and neither means anything. TREND_MIN_SESSIONS is
                // the floor this page already uses for "is there enough here
                // to call it a trend", so it is the floor here too; below it
                // the two figures are shown side by side and no growth rate is
                // claimed.
                const isRate = row.unit === "%";
                const baseIsEnough = comparable && (row.lastM as number) >= TREND_MIN_SESSIONS;
                const changeLabel = !comparable
                  ? null
                  : isRate
                    ? `${up ? "+" : ""}${Math.round(diff)} points`
                    : baseIsEnough
                      ? `${up ? "+" : ""}${Math.round((diff / (row.lastM as number)) * 100)}%`
                      : null;
                return (
                  <div key={row.label} className="text-center p-3 rounded-xl border border-border/70 bg-surface/60">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{row.label}</div>
                    <div className="text-xl font-black text-foreground">{show(row.thisM)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{comparable ? `vs ${show(row.lastM)} last month` : "No prior month data"}</div>
                    {comparable && (
                    <div className={cn("flex items-center gap-1 justify-center mt-1 text-xs font-semibold", up ? "text-success" : diff < 0 ? "text-destructive" : "text-muted-foreground")}>
                      {diff !== 0 && (up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      {diff === 0 ? "no change" : (changeLabel ?? "too little last month to compare")}
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ── Tab: Milestones & Reports ────── */}
      {tab === "milestones" && (
        <div className="space-y-6">
          <div>
            <SLabel>Your progress milestones</SLabel>
            {milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No milestones yet — keep practising!</p>
            ) : (
            <div className="space-y-3">
              {milestones.map((m) => (
                <div key={m.title} className="flex items-start gap-4 p-4 rounded-xl border border-border/70 bg-surface/60 hover:border-border transition-colors">
                  <span className="text-2xl shrink-0 mt-0.5">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{m.title}</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{m.category}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{m.date}</span>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Upcoming milestones */}
          <div>
            <SLabel>Next milestones to reach</SLabel>
            {upcomingMilestones.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No upcoming milestones tracked yet</p>
            ) : (
            <div className="space-y-3">
              {upcomingMilestones.map((m) => {
                const pct = Math.round((m.progress / m.target) * 100);
                return (
                  <div key={m.title} className="p-4 rounded-xl border border-border/70 bg-surface/60">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-foreground">{m.title}</span>
                      {/* "46/70 %" — the space belongs before a word, not before a
                          percent sign. */}
                      <span className="text-xs text-muted-foreground">
                        {m.progress}/{m.target}
                        {m.unit === "%" ? "%" : ` ${m.unit}`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg,hsl(var(--primary)),hsl(var(--info)))" }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">{pct}% complete</div>
                  </div>
                );
              })}
            </div>
            )}
          </div>

          {/* Reports */}
          <div>
            <SLabel>Download & share your report</SLabel>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { label: "Print / Save as PDF", icon: <Download className="w-4 h-4" />,  color: "hsl(var(--primary))",  desc: "Opens browser print → Save as PDF", action: "pdf" as const },
                // "teacher/parent send is coming soon" promised a feature with no
                // code behind it, on the one page whose whole job is to not
                // overstate. What the button does is copy text.
                { label: "Copy summary",        icon: <Share2 className="w-4 h-4" />,    color: "hsl(var(--success))",  desc: "Copy your accuracy, questions and sessions as text", action: "share" as const },
                { label: "Print report",        icon: <Printer className="w-4 h-4" />,   color: "hsl(var(--warning))",  desc: "Print a physical copy", action: "print" as const },
              ].map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => {
                    if (r.action === "print") {
                      window.print();
                      return;
                    }
                    if (r.action === "pdf") {
                      toast.info("Use your browser Print dialog → Save as PDF.");
                      window.print();
                      return;
                    }
                    const summary = [
                      "Gurukul performance summary",
                      `Accuracy: ${overview.accuracy == null ? "not enough practice yet" : `${overview.accuracy}%`}`,
                      `Questions: ${overview.totalQuestions}`,
                      `Practice sessions: ${overview.practiceCompleted ?? "not recorded"}`,
                    ].join("\n");
                    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
                      void navigator.share({ title: "Gurukul Analysis", text: summary }).catch(() => {
                        void navigator.clipboard?.writeText(summary).then(
                          () => toast.success("Summary copied — paste to share."),
                          () => toast.info("Sharing is not available on this device."),
                        );
                      });
                      return;
                    }
                    void navigator.clipboard?.writeText(summary).then(
                      () => toast.success("Summary copied — paste to share."),
                      () => toast.info("Sharing is not available on this device."),
                    );
                  }}
                  className="flex items-center gap-3 p-4 rounded-xl border border-border/70 bg-surface/60 hover:border-border hover:bg-surface transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform" style={{ background: `${withAlpha(r.color, 0.08)}`, color: r.color }}>
                    {r.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{r.label}</div>
                    <div className="text-[11px] text-muted-foreground">{r.desc}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto shrink-0 group-hover:text-foreground transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

/**
 * The §6.4 trend cell — ONE definition, both the subject list and the chapter
 * grid.
 *
 * Three states, three different things on screen. Before this, both call sites
 * rendered `trend != null ? arrow+% : "—"`, which collapsed "steady" and "not
 * enough data" into the same dash, and — because the delta was computed from
 * as few as two sessions — drew a green up-arrow on noise. The dash is now
 * reserved for the one case where the app genuinely has nothing to say.
 */
function TrendCell({
  state,
  deltaPoints,
  size = "sm",
}: {
  state: TrendState;
  deltaPoints: number | null;
  size?: "xs" | "sm";
}) {
  const text = size === "xs" ? "text-[11px] font-medium" : "text-sm font-black tabular-nums";
  const justify = size === "xs" ? "justify-end" : "justify-center";

  if (state === "not_enough_data" || deltaPoints == null) {
    return (
      <div className={cn(text, "text-muted-foreground", size === "xs" ? "text-right" : "text-center")}
        title={`Needs ${TREND_MIN_SESSIONS} sessions before a trend means anything`}>
        —
      </div>
    );
  }
  if (state === "stuck") {
    return (
      <div className={cn("flex items-center gap-0.5", justify, text, "text-muted-foreground")}
        title={`Moved ${Math.abs(deltaPoints)} points — under the ${TREND_DELTA_POINTS}-point threshold`}>
        <Minus className="w-3 h-3" />
        Steady
      </div>
    );
  }
  const up = state === "improving";
  // POINTS, NOT PERCENT. deltaPoints is a difference between two accuracy
  // percentages, and a move from 40% to 70% is thirty POINTS, not thirty
  // percent — thirty percent of 40 is twelve. The Overview headline and the
  // milestone card were both corrected to say "points" and this cell, which
  // renders the same quantity in the subject rows, the chapter grid and the
  // topics list, kept the percent sign. Three screens of the page disagreed
  // with the two that had been fixed.
  //
  // "pt"/"pts" rather than the word in full: these cells are 11px and sit in
  // a column, and the unit has to survive being narrow.
  return (
    <div
      className={cn("flex items-center gap-0.5", justify, text, up ? "text-success" : "text-destructive")}
      title={`${up ? "Up" : "Down"} ${Math.abs(deltaPoints)} percentage points across recent sessions`}
    >
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(deltaPoints)} {Math.abs(deltaPoints) === 1 ? "pt" : "pts"}
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl border border-border/70 bg-surface/60">
      <SLabel>{label}</SLabel>
      {children}
    </div>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-0">
      <div className="w-1 h-3.5 rounded-full bg-primary" />
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{children}</span>
    </div>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl border border-border/70 bg-surface/60">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-black tabular-nums leading-none" style={{ color: color ?? "hsl(var(--foreground))", fontFamily: "var(--font-display)" }}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
