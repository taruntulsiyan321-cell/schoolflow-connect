import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Download, Share2,
  CheckCircle2, AlertCircle, Clock, BookOpen,
  Zap, Target, Calendar, ChevronRight,
  ArrowUp, ArrowDown, Minus, Printer, Star,
} from "lucide-react";
import { cn } from "@/gurukul/components/shared";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { buildMilestones, consistencyGrid } from "@/components/student/analytics/wisdom/analyticsDerived";
import { MarksService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import type { ExamRecord, MarksRecord } from "@/academic/repository/marksRepository";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicDisplay";
import {
  DAY_LABELS,
  buildWeekComparison,
  buildSubjectRadarPoints,
  deriveSubjectRows,
  deriveChapterRows,
  deriveImprovingTopics,
  deriveSpeedStats,
  deriveMonthComparison,
  deriveRecoveryProgress,
  deriveRecoveryTopics,
  deriveRevisionData,
  practiceCountForTopic,
  scoreAxisDomain,
} from "@/lib/studentAnalysisMetrics";
import { preferRealAcademicLabel } from "@/lib/qualityGuards";

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "#3b5bdb",
  Math: "#3b5bdb",
  Physics: "#4b9fd4",
  Chemistry: "#6882e8",
  Biology: "#4aa87a",
  English: "#c08a3a",
  Hindi: "#cc5069",
  Science: "#4b9fd4",
  "Social Science": "#c08a3a",
};
const FALLBACK_COLORS = ["#3b5bdb", "#4b9fd4", "#6882e8", "#4aa87a", "#c08a3a"];

function subjectColor(name: string, index: number) {
  return SUBJECT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(v: number) {
  if (v >= 80) return "#4b9fd4";
  if (v >= 65) return "#c08a3a";
  return "#cc5069";
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#131316] border border-white/10 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="text-[#78788c] mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-[#a0a0b0]">{p.name}:</span>
          <span className="text-white font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "subjects" | "topics" | "practice" | "activity" | "milestones";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview",    label: "Overview" },
  { key: "subjects",    label: "Subjects & Chapters" },
  { key: "topics",      label: "Topics" },
  { key: "practice",    label: "Practice & Tests" },
  { key: "activity",    label: "Activity & Speed" },
  { key: "milestones",  label: "Milestones & Reports" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function Analysis() {
  const [tab, setTab] = useState<Tab>("overview");
  const student = useGurukulStudent();
  const { ctx, ready: academicReady, studentId, classId } = useAcademicContext();
  const liveVersion = useAcademicLive(["marks", "examination", "profile"]);
  const { data: analysis, loading: analysisLoading, error: analysisError } = useAnalysisPageData(academicReady);
  const { data: charts, loading: chartsLoading } = useStudentPerformanceCharts(academicReady);
  const { data: snapshot, loading: snapshotLoading } = useStudentAcademicSnapshot(academicReady);
  const { items: mastery, loading: masteryLoading } = useConceptMastery(academicReady);
  const [marks, setMarks] = useState<MarksRecord[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);

  useEffect(() => {
    if (!academicReady || !ctx || !studentId) return;
    let cancelled = false;
    (async () => {
      try {
        const [markRows, examRows] = await Promise.all([
          MarksService.listForStudent(ctx, studentId, { limit: 50 }),
          classId ? MarksService.listExamsForClass(ctx, classId, { limit: 50 }) : Promise.resolve([]),
        ]);
        if (!cancelled) {
          setMarks(markRows);
          setExams(examRows);
        }
      } catch (e) {
        if (!cancelled) {
          setMarks([]);
          setExams([]);
          toast.error(e instanceof Error ? e.message : "Could not load marks for reports");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [academicReady, ctx, studentId, classId, liveVersion]);

  const loading = analysisLoading || chartsLoading || snapshotLoading || masteryLoading;

  const testResults = useMemo(() => {
    const examById = new Map(exams.map((e) => [e.id, e]));
    return marks
      .map((m) => {
        const exam = examById.get(m.examId);
        if (!exam) return null;
        const maxScore = exam.maxMarks || 100;
        const score = Math.round((m.marksObtained / maxScore) * 100);
        return {
          name: exam.name,
          date: exam.examDate
            ? new Date(exam.examDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "—",
          subject: exam.subject || "—",
          score,
          maxScore: 100,
          marksObtained: m.marksObtained,
          rawMax: maxScore,
          rank: 0,
          total: 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .slice(0, 12);
  }, [marks, exams]);
  const testTrend = testResults.map((t) => ({ name: t.date, score: t.score }));

  const overview = useMemo(() => {
    const correct = analysis?.totals.correct ?? 0;
    const incorrect = analysis?.totals.wrong ?? 0;
    const totalQuestions = correct + incorrect;
    const heatmap = snapshot?.activity_heatmap ?? [];
    const studyMinutes = heatmap.reduce((s, d) => s + (d.minutes ?? 0), 0);
    // Accuracy + study streak: same shell SSOT as Home (Progression + snapshot) — not mastery recompute.
    const accuracy = Math.round(student.accuracy);
    return {
      accuracy,
      totalQuestions,
      correct,
      incorrect,
      practiceCompleted: snapshot?.self_practice?.sessions_completed ?? analysis?.recent_sessions.length ?? 0,
      testsCompleted: testResults.length,
      avgScore: accuracy,
      studyHours: Math.round(studyMinutes / 60),
      streak: student.streak,
      rank: analysis?.class_rank ?? student.rank ?? 0,
      totalStudents: analysis?.class_size ?? student.totalStudents ?? 0,
      examReadiness: snapshot?.exam_readiness?.score ?? 0,
    };
  }, [analysis, snapshot, testResults.length, student.accuracy, student.streak, student.rank, student.totalStudents]);

  const scoreTrend = useMemo(() => {
    const trend = charts?.practice_trend ?? [];
    if (trend.length > 0) {
      return trend.map((p, i) => ({
        week: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: Math.round(p.score_pct),
        practice: 0,
      }));
    }
    const sessions = [...(analysis?.recent_sessions ?? [])].reverse();
    if (sessions.length > 0) {
      return sessions.map((s) => ({
        week: new Date(s.finished_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: s.accuracy_pct,
        practice: s.question_count,
      }));
    }
    return [];
  }, [charts?.practice_trend, analysis?.recent_sessions]);

  const weekComparison = useMemo(
    () => buildWeekComparison(charts?.weekly_activity ?? []),
    [charts?.weekly_activity],
  );

  const subjectData = useMemo(() => {
    const rows = deriveSubjectRows(charts?.subjects ?? [], analysis?.recent_sessions ?? []);
    return rows.map((s, i) => ({
      ...s,
      color: subjectColor(s.name, i),
      score: s.accuracy,
      rankInClass: 0,
    }));
  }, [charts?.subjects, analysis?.recent_sessions]);

  const radarData = useMemo(
    () => buildSubjectRadarPoints(subjectData.map((s) => ({ name: s.name, score: s.score }))),
    [subjectData],
  );

  const chapterData = useMemo(() => {
    const rows = deriveChapterRows(mastery, analysis?.recent_sessions ?? [], snapshot);
    return rows.map((c) => ({
      chapter: c.chapter,
      subject: c.subject,
      color: subjectColor(c.subject, 0),
      completion: c.practiceDepth,
      questions: c.questions,
      accuracy: c.accuracy,
      trend: c.trend,
      status: c.status,
    }));
  }, [mastery, analysis?.recent_sessions, snapshot]);

  const topicGroups = useMemo(() => {
    const realTopic = (t: { topic?: string | null; chapter?: string | null }) =>
      preferRealAcademicLabel(t.topic, t.chapter);
    const realSubject = (s: string | null | undefined) => preferRealAcademicLabel(s);
    return {
      doing_well: (snapshot?.strong_topics ?? [])
        .map((t) => {
          const topic = realTopic(t);
          const subject = realSubject(t.subject);
          if (!topic || !subject) return null;
          return { topic, subject, score: Math.round(t.accuracy) };
        })
        .filter((t): t is NonNullable<typeof t> => t != null),
      needs_attention: (snapshot?.weak_topics ?? [])
        .map((t) => {
          const topic = realTopic(t);
          const subject = realSubject(t.subject);
          if (!topic || !subject) return null;
          return {
            topic,
            subject,
            score: Math.round(t.accuracy),
            practiceCount: practiceCountForTopic(
              analysis?.recent_sessions ?? [],
              t.subject,
              topic,
            ),
          };
        })
        .filter((t): t is NonNullable<typeof t> => t != null),
      improving: deriveImprovingTopics(
        charts?.practice_trend ?? [],
        analysis?.recent_sessions ?? [],
      ).filter(
        (t) =>
          preferRealAcademicLabel(t.topic) &&
          (t.subject === "—" || preferRealAcademicLabel(t.subject)),
      ),
      not_started: mastery
        .filter(
          (m) =>
            m.total_attempts === 0 &&
            preferRealAcademicLabel(m.concept) &&
            preferRealAcademicLabel(m.subject),
        )
        .slice(0, 8)
        .map((m) => ({
          topic: preferRealAcademicLabel(m.concept),
          subject: preferRealAcademicLabel(m.subject),
        })),
    };
  }, [snapshot?.strong_topics, snapshot?.weak_topics, mastery, charts?.practice_trend, analysis?.recent_sessions]);

  const practiceStats = useMemo(() => {
    const weekly = charts?.weekly_activity ?? [];
    const weekDone = weekly.reduce((s, d) => s + d.total, 0);
    const todayKey = new Date().toDateString();
    const todayDone = weekly.find((d) => new Date(d.date).toDateString() === todayKey)?.total ?? 0;
    const streakDays = student.streak;
    const activeDays = (snapshot?.activity_heatmap ?? []).filter(
      (d) => (d.dpp ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0) > 0,
    ).length;
    const consistency = weekly.length > 0 ? Math.round((activeDays / Math.max(weekly.length, 1)) * 100) : 0;
    return {
      todayDone,
      todayTarget: 0,
      weekDone,
      weekTarget: 0,
      monthDone: overview.totalQuestions,
      monthTarget: 0,
      streakDays,
      consistency,
      pendingAssignments: snapshot?.homework?.pending ?? 0,
      completedSessions: overview.practiceCompleted,
    };
  }, [charts?.weekly_activity, snapshot, student.streak, overview]);

  const practiceMonthly = useMemo(() => {
    const weekly = charts?.weekly_activity ?? [];
    const byMonth = new Map<string, number>();
    for (const row of weekly) {
      const key = new Date(row.date).toLocaleDateString(undefined, { month: "short" });
      byMonth.set(key, (byMonth.get(key) ?? 0) + row.total);
    }
    return [...byMonth.entries()].map(([month, done]) => ({ month, done }));
  }, [charts?.weekly_activity]);

  const { speedStats, speedBySubject } = useMemo(() => {
    const derived = deriveSpeedStats(analysis?.recent_sessions ?? []);
    const fallbackAvg = analysis?.totals.avg_sec_per_question ?? 0;
    const stats = {
      ...derived.stats,
      avgSec: derived.stats.avgSec > 0 ? derived.stats.avgSec : fallbackAvg,
    };
    const bySubject =
      derived.bySubject.length > 0
        ? derived.bySubject.map((s, i) => ({
            name: s.name,
            color: subjectColor(s.name, i),
            avgSec: s.avgSec,
          }))
        : stats.avgSec > 0
          ? [{ name: "Overall", color: "#3b5bdb", avgSec: stats.avgSec }]
          : [];
    return { speedStats: stats, speedBySubject: bySubject };
  }, [analysis?.recent_sessions, analysis?.totals.avg_sec_per_question]);

  const studyActivity = useMemo(() => {
    const heatmap = snapshot?.activity_heatmap ?? [];
    const weeklyHrs = DAY_LABELS.map((day) => {
      const mins = heatmap
        .filter((d) => new Date(d.date).toLocaleDateString(undefined, { weekday: "short" }) === day)
        .reduce((s, d) => s + (d.minutes ?? 0), 0);
      return Math.round((mins / 60) * 10) / 10;
    });
    const totalMins = heatmap.reduce((s, d) => s + (d.minutes ?? 0), 0);
    const activeDays = heatmap.filter((d) => (d.minutes ?? 0) > 0);
    const bestDayRow = [...activeDays].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0];
    return {
      totalHrs: Math.round(totalMins / 60),
      avgDailyMin: activeDays.length > 0 ? Math.round(totalMins / activeDays.length) : 0,
      bestDay: bestDayRow
        ? new Date(bestDayRow.date).toLocaleDateString(undefined, { weekday: "short" })
        : "—",
      // Hourly buckets are not in academic_daily_activity — honest empty.
      bestHour: "—",
      weeklyHrs: [...weeklyHrs],
    };
  }, [snapshot?.activity_heatmap]);

  const activityHeatmap = useMemo(() => {
    const cells = consistencyGrid(snapshot?.activity_heatmap);
    const weeks: { week: string; days: { day: string; value: number }[] }[] = [];
    for (let w = 0; w < Math.ceil(cells.length / 7); w++) {
      const slice = cells.slice(w * 7, w * 7 + 7);
      weeks.push({
        week: `W${w + 1}`,
        days: DAY_LABELS.map((day, i) => ({
          day,
          value: slice[i]?.total ?? 0,
        })),
      });
    }
    return weeks.slice(-4);
  }, [snapshot?.activity_heatmap]);

  const recoveryProgress = useMemo(
    () => deriveRecoveryProgress(mastery, snapshot?.recovery_pending ?? 0),
    [snapshot?.recovery_pending, mastery],
  );

  const recoveryTopics = useMemo(
    () => deriveRecoveryTopics(snapshot?.weak_topics, mastery),
    [snapshot?.weak_topics, mastery],
  );

  const revisionData = useMemo(
    () => deriveRevisionData(snapshot?.revision_queue),
    [snapshot?.revision_queue],
  );

  const learningProgress = useMemo(() => {
    const completed = mastery.filter((m) => m.mastery_score >= 75).length;
    const inProgress = mastery.filter((m) => m.total_attempts > 0 && m.mastery_score < 75).length;
    const notStarted = mastery.filter((m) => m.total_attempts === 0).length;
    return { completed, inProgress, notStarted, total: mastery.length };
  }, [mastery]);

  const milestones = useMemo(() => {
    const built = buildMilestones(snapshot ?? {}, [], analysis?.trend.improvement_pct ?? null);
    const streak = overview.streak;
    const items: { title: string; desc: string; date: string; icon: string; category: string }[] = built.map((m) => ({
      title: m.title,
      desc: m.detail ?? "",
      date: m.when,
      icon: m.badge ? "⭐" : "📈",
      category: m.badge ?? "Progress",
    }));
    if (streak >= 3) {
      items.unshift({
        title: `${streak}-day practice streak`,
        desc: "Keep practicing daily to maintain your streak.",
        date: "Recent",
        icon: "🔥",
        category: "Consistency",
      });
    }
    if (overview.totalQuestions >= 100) {
      items.push({
        title: `${overview.totalQuestions} questions solved`,
        desc: "Total practice questions attempted so far.",
        date: "Recent",
        icon: "📚",
        category: "Practice",
      });
    }
    return items;
  }, [snapshot, analysis?.trend.improvement_pct, overview]);

  const personalInsights = useMemo(() => {
    const sorted = [...subjectData].sort((a, b) => b.accuracy - a.accuracy);
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const weakTopic = snapshot?.weak_topics?.[0];
    const bestDay = studyActivity.bestDay;
    const items = [];
    if (strongest) {
      items.push({
        label: "Your strongest subject right now",
        value: strongest.name,
        sub: `${strongest.accuracy}% accuracy`,
        color: strongest.color,
        icon: <Star className="w-4 h-4" />,
      });
    }
    if (weakest && weakest.name !== strongest?.name) {
      items.push({
        label: "Subject needing more practice",
        value: weakest.name,
        sub: `${weakest.accuracy}% accuracy`,
        color: "#c08a3a",
        icon: <Target className="w-4 h-4" />,
      });
    }
    if (weakTopic) {
      items.push({
        label: "Suggested priority today",
        value: weakTopic.topic || weakTopic.chapter || weakTopic.subject,
        sub: `${Math.round(weakTopic.accuracy)}% accuracy · needs review`,
        color: "#4b9fd4",
        icon: <ChevronRight className="w-4 h-4" />,
      });
    }
    if (bestDay !== "—") {
      items.push({
        label: "Most active day recently",
        value: bestDay,
        sub: `${studyActivity.totalHrs}h total study time logged`,
        color: "#6882e8",
        icon: <Calendar className="w-4 h-4" />,
      });
    }
    if (analysis?.totals.avg_sec_per_question) {
      items.push({
        label: "Average time per question",
        value: `${analysis.totals.avg_sec_per_question}s`,
        sub: "Based on your latest practice session",
        color: "#cc5069",
        icon: <Clock className="w-4 h-4" />,
      });
    }
    return items;
  }, [subjectData, snapshot?.weak_topics, studyActivity, analysis]);

  const questionCards = useMemo(() => {
    const rankText = overview.rank > 0 && overview.totalStudents > 0
      ? `Rank #${overview.rank} of ${overview.totalStudents}`
      : overview.rank > 0 ? `Rank #${overview.rank}` : "No rank yet";
    const streakText = overview.streak > 0 ? `${overview.streak}-day streak` : "No streak yet";
    const weakSubjects = subjectData
      .filter((s) => s.status === "needs-attention")
      .map((s) => s.name);
    const improveText = weakSubjects.length > 0
      ? weakSubjects.join(" & ")
      : subjectData.length > 0 ? "Keep building consistency" : "Start practicing to see insights";
    const weakCount = snapshot?.weak_topics?.length ?? 0;
    const nextTopic = snapshot?.weak_topics?.[0];
    return [
      {
        q: "How am I doing?",
        a: `${overview.accuracy}% accuracy overall`,
        sub: `${rankText} · ${streakText}`,
        color: "#4b9fd4",
        icon: <TrendingUp className="w-4 h-4" />,
      },
      {
        q: "What should I improve?",
        a: improveText,
        sub: weakCount > 0 ? `${weakCount} topic${weakCount === 1 ? "" : "s"} need attention` : "No weak topics flagged yet",
        color: "#c08a3a",
        icon: <Target className="w-4 h-4" />,
      },
      {
        q: "What should I study next?",
        a: nextTopic ? (nextTopic.topic || nextTopic.chapter || nextTopic.subject) : "Start a practice session",
        sub: revisionData.dueToday.length > 0
          ? `${revisionData.dueToday.length} revision item${revisionData.dueToday.length === 1 ? "" : "s"} due today`
          : "Check your revision queue",
        color: "#3b5bdb",
        icon: <BookOpen className="w-4 h-4" />,
      },
    ];
  }, [overview, subjectData, snapshot?.weak_topics, revisionData.dueToday.length]);

  const scoreTrendDelta = scoreTrend.length >= 2
    ? scoreTrend[scoreTrend.length - 1].score - scoreTrend[0].score
    : null;

  const monthComparison = useMemo(
    () =>
      deriveMonthComparison(
        charts?.weekly_activity ?? [],
        charts?.practice_trend ?? [],
        snapshot?.activity_heatmap,
      ),
    [charts?.weekly_activity, charts?.practice_trend, snapshot?.activity_heatmap],
  );

  const scoreTrendDomain = useMemo(
    () => scoreAxisDomain(scoreTrend.map((p) => p.score)),
    [scoreTrend],
  );

  const testTrendDomain = useMemo(
    () => scoreAxisDomain(testTrend.map((t) => t.score)),
    [testTrend],
  );

  const upcomingMilestones = useMemo(() => {
    const items = [];
    if (overview.streak < 15 && overview.streak > 0) {
      items.push({ title: "Reach 15-day practice streak", progress: overview.streak, target: 15, unit: "days" });
    }
    if (overview.totalQuestions < 100) {
      items.push({ title: "Solve 100 practice questions", progress: overview.totalQuestions, target: 100, unit: "questions" });
    }
    const weak = subjectData.find((s) => s.accuracy < 75 && s.accuracy > 0);
    if (weak) {
      items.push({ title: `Improve ${weak.name} above 75%`, progress: weak.accuracy, target: 75, unit: "%" });
    }
    return items;
  }, [overview, subjectData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-[#78788c]">Loading analysis…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 3 Questions bar ─────────────── */}
      <div className="grid sm:grid-cols-3 gap-3">
        {questionCards.map((item) => (
          <div
            key={item.q}
            className="rounded-2xl border p-4"
            style={{ borderColor: `${item.color}25`, background: `${item.color}08` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span style={{ color: item.color }}>{item.icon}</span>
              <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: item.color }}>{item.q}</span>
            </div>
            <div className="text-sm font-bold text-white leading-tight">{item.a}</div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Tab bar ─────────────────────── */}
      <div className="flex gap-0 overflow-x-auto border-b border-white/7 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap",
              tab === t.key
                ? "border-[#3b5bdb] text-white"
                : "border-transparent text-[#78788c] hover:text-white"
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
              { label: "Questions solved",   value: overview.totalQuestions.toLocaleString(), color: "#e8eaf0" },
              { label: "Correct answers",    value: overview.correct.toLocaleString(),        color: "#4b9fd4" },
              { label: "Incorrect answers",  value: overview.incorrect.toLocaleString(),      color: "#cc5069" },
              { label: "Average score",      value: `${overview.avgScore}%`,                  color: "#c08a3a" },
              { label: "Practice sessions",  value: overview.practiceCompleted,               color: "#e8eaf0" },
              { label: "Tests completed",    value: overview.testsCompleted,                  color: "#e8eaf0" },
              { label: "Study hours total",  value: `${overview.studyHours}h`,                color: "#6882e8" },
              { label: "Exam readiness",     value: `${overview.examReadiness}%`,             color: "#3b5bdb" },
            ].map((s) => (
              <Metric key={s.label} label={s.label} value={s.value} color={s.color} />
            ))}
          </div>

          {/* Score over time */}
          <Card label="How your score changed over 7 weeks">
            {scoreTrend.length > 0 ? (
            <>
            <div className="h-48 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreTrend}>
                  <defs>
                    <linearGradient id="an-scGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b5bdb" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b5bdb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={scoreTrendDomain} tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="score" name="Score" stroke="#3b5bdb" strokeWidth={2.5} fill="url(#an-scGrad)"
                    isAnimationActive={false} dot={{ r: 4, fill: "#3b5bdb", strokeWidth: 0 }} activeDot={{ r: 6, fill: "#3b5bdb", stroke: "#0d0d0f", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {scoreTrendDelta != null && scoreTrendDelta !== 0 && (
            <div className="flex items-center gap-2 mt-2">
              {scoreTrendDelta > 0 ? (
                <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span className={cn("text-xs font-medium", scoreTrendDelta > 0 ? "text-emerald-400" : "text-rose-400")}>
                {scoreTrendDelta > 0 ? "+" : ""}{scoreTrendDelta}% over recent sessions
              </span>
            </div>
            )}
            </>
            ) : (
              <p className="text-sm text-[#78788c] mt-4 py-8 text-center">No score trend data yet</p>
            )}
          </Card>

          {/* This week vs last week */}
          <Card label="This week vs last week — questions done">
            {weekComparison.some((d) => d.thisWeek > 0 || d.lastWeek > 0) ? (
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekComparison} barSize={14} barGap={2}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="thisWeek" name="This week" fill="#3b5bdb" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
                  <Bar dataKey="lastWeek" name="Last week" fill="rgba(255,255,255,0.08)" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            ) : (
              <p className="text-sm text-[#78788c] mt-4 py-8 text-center">No weekly activity yet</p>
            )}
          </Card>

          {/* Personal Insights */}
          <div>
            <SLabel>Personal insights</SLabel>
            {personalInsights.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {personalInsights.map((ins) => (
                <div key={ins.label} className="flex items-start gap-3 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/15 transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${ins.color}15`, color: ins.color }}>
                    {ins.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[#78788c]">{ins.label}</div>
                    <div className="text-sm font-bold text-white mt-0.5">{ins.value}</div>
                    <div className="text-[11px] text-[#78788c] mt-0.5">{ins.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            ) : (
              <p className="text-sm text-[#78788c] py-6 text-center">Practice more to unlock personal insights</p>
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
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#a0a0b0", fontSize: 12, fontWeight: 600 }} />
                    <Radar name="Score" dataKey="score" stroke="#3b5bdb" fill="#3b5bdb" fillOpacity={0.2} strokeWidth={2.5} isAnimationActive={false}/>
                    <Tooltip content={<ChartTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              ) : (
                <p className="text-sm text-[#78788c] py-12 text-center">No subject data yet</p>
              )}
            </Card>

            <div className="space-y-3">
              <SLabel>Subjects at a glance</SLabel>
              {subjectData.length === 0 ? (
                <p className="text-sm text-[#78788c] py-6 text-center">No subjects tracked yet</p>
              ) : subjectData.map((s) => (
                <div key={s.name} className="flex items-center gap-3 p-3 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                  <div className="w-2 h-10 rounded-full shrink-0" style={{ background: s.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{displaySubject(s.name) || s.name}</span>
                      {s.status === "best" && <span className="text-[9px] uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">Best subject</span>}
                      {s.status === "needs-attention" && <span className="text-[9px] uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">Needs attention</span>}
                    </div>
                    <div className="text-[11px] text-[#78788c] mt-0.5">{s.questions} questions{s.timeHrs > 0 ? ` · ${s.timeHrs}h study time` : ""}{s.rankInClass > 0 ? ` · Rank #${s.rankInClass}` : ""}</div>
                    <div className="h-1 rounded-full bg-white/5 mt-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s.score}%`, background: s.color }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.score}%</div>
                    {s.trend != null ? (
                    <div className={cn("flex items-center gap-0.5 text-[11px] font-medium justify-end", s.trend >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {s.trend >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {Math.abs(s.trend)}%
                    </div>
                    ) : (
                      <div className="text-[11px] text-[#78788c]">—</div>
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
              <p className="text-sm text-[#78788c] py-6 text-center">No chapter data yet</p>
            ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {chapterData.map((c) => {
                const statusLabel: Record<string, { text: string; color: string }> = {
                  "ready":        { text: "Ready for revision", color: "#4aa87a" },
                  "practice-more":{ text: "Practice more",      color: "#c08a3a" },
                  "needs-work":   { text: "Needs attention",    color: "#cc5069" },
                };
                const st = statusLabel[c.status];
                return (
                  <div key={`${c.subject}-${c.chapter}`} className="p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-sm font-semibold text-white">{displayChapter(c.chapter)}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: c.color }}>{displaySubject(c.subject)}</div>
                      </div>
                      <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: st.color, background: `${st.color}12` }}>
                        {st.text}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div className="text-center">
                        <div className="text-sm font-black tabular-nums text-white">{c.completion}%</div>
                        <div className="text-[9px] text-[#78788c]">Practice</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-black tabular-nums text-white">{c.accuracy}%</div>
                        <div className="text-[9px] text-[#78788c]">Accuracy</div>
                      </div>
                      <div className="text-center">
                        {c.trend != null ? (
                        <div className={cn("text-sm font-black tabular-nums flex items-center justify-center gap-0.5", c.trend >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {c.trend >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          {Math.abs(c.trend)}%
                        </div>
                        ) : (
                          <div className="text-sm font-black tabular-nums text-[#78788c]">—</div>
                        )}
                        <div className="text-[9px] text-[#78788c]">Change</div>
                      </div>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${c.completion}%`, background: c.color }} />
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
              { label: "Topics completed",   value: learningProgress.completed,  color: "#4aa87a", icon: <CheckCircle2 className="w-5 h-5" /> },
              { label: "Topics in progress", value: learningProgress.inProgress, color: "#3b5bdb", icon: <BookOpen className="w-5 h-5" /> },
              { label: "Yet to begin",        value: learningProgress.notStarted, color: "#78788c", icon: <Minus className="w-5 h-5" /> },
            ].map((item) => (
              <div key={item.label} className="p-4 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                <div className="flex justify-center mb-2" style={{ color: item.color }}>{item.icon}</div>
                <div className="text-2xl font-black tabular-nums" style={{ color: item.color }}>{item.value}</div>
                <div className="text-[11px] text-[#78788c] mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Doing well */}
            <div>
              <SLabel>Topics you're doing well in</SLabel>
              <div className="space-y-2">
                {topicGroups.doing_well.length === 0 ? (
                  <p className="text-sm text-[#78788c] py-4 text-center">No strong topics yet</p>
                ) : topicGroups.doing_well.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-emerald-400/12 bg-emerald-400/5 hover:border-emerald-400/25 transition-colors">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{displayTopic(t.topic)}</div>
                      <div className="text-[11px] text-[#78788c]">{displaySubject(t.subject)}</div>
                    </div>
                    <span className="text-sm font-black text-emerald-400 shrink-0">{t.score}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Needs attention */}
            <div>
              <SLabel>Topics that need your attention</SLabel>
              <div className="space-y-2">
                {topicGroups.needs_attention.length === 0 ? (
                  <p className="text-sm text-[#78788c] py-4 text-center">No weak topics flagged</p>
                ) : topicGroups.needs_attention.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-amber-400/12 bg-amber-400/5 hover:border-amber-400/25 transition-colors cursor-pointer">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{displayTopic(t.topic)}</div>
                      <div className="text-[11px] text-[#78788c]">{displaySubject(t.subject)}{t.practiceCount > 0 ? ` · ${t.practiceCount} questions done` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-amber-400">{t.score}%</div>
                      <div className="text-[10px] text-[#78788c]">accuracy</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Improving */}
            <div>
              <SLabel>Topics getting better</SLabel>
              <div className="space-y-2">
                {topicGroups.improving.length === 0 ? (
                  <p className="text-sm text-[#78788c] py-4 text-center">No improvement trends yet</p>
                ) : topicGroups.improving.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                    <TrendingUp className="w-4 h-4 text-[#3b5bdb] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{displayTopic(t.topic)}</div>
                      <div className="text-[11px] text-[#78788c]">{displaySubject(t.subject)}</div>
                    </div>
                    <span className="text-sm font-black text-emerald-400 shrink-0">+{t.improvement}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Not started */}
            <div>
              <SLabel>Topics yet to begin</SLabel>
              <div className="space-y-2">
                {topicGroups.not_started.length === 0 ? (
                  <p className="text-sm text-[#78788c] py-4 text-center">All tracked topics attempted</p>
                ) : topicGroups.not_started.map((t) => (
                  <div key={t.topic} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/2">
                    <Minus className="w-4 h-4 text-[#78788c] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#a0a0b0] truncate">{displayTopic(t.topic)}</div>
                      <div className="text-[11px] text-[#78788c]">{displaySubject(t.subject)}</div>
                    </div>
                    <span className="text-[10px] text-[#78788c]">Not started</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recovery & Revision */}
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <SLabel>Topics you practiced again</SLabel>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-white">{recoveryProgress.completed}</div>
                  <div className="text-[11px] text-[#78788c]">Completed</div>
                </div>
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-amber-400">{recoveryProgress.stillPending}</div>
                  <div className="text-[11px] text-[#78788c]">Still pending</div>
                </div>
              </div>
              <div className="space-y-2">
                {recoveryTopics.length === 0 ? (
                  <p className="text-sm text-[#78788c] py-4 text-center">No recovery topics yet</p>
                ) : recoveryTopics.map((r) => (
                  <div key={r.topic} className="flex items-center gap-3 p-3 rounded-xl border border-white/7 bg-[#131316]/60">
                    {r.status === "completed"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      : <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{displayTopic(r.topic)}</div>
                      <div className="text-[11px] text-[#78788c]">{displaySubject(r.subject)}</div>
                    </div>
                    {r.status === "completed"
                      ? <span className="text-xs font-semibold text-emerald-400">+{r.improvement}%</span>
                      : <span className="text-[11px] text-[#78788c]">{r.attempts} tries</span>
                    }
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SLabel>Revision status</SLabel>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-emerald-400">{revisionData.completed}</div>
                  <div className="text-[11px] text-[#78788c]">Done</div>
                </div>
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-amber-400">{revisionData.pending}</div>
                  <div className="text-[11px] text-[#78788c]">Pending</div>
                </div>
                <div className="p-3 rounded-xl border border-white/7 bg-[#131316]/60 text-center">
                  <div className="text-xl font-black text-white">{revisionData.pending}</div>
                  <div className="text-[11px] text-[#78788c]">In queue</div>
                </div>
              </div>
              <SLabel>Due for revision today</SLabel>
              <div className="space-y-2">
                {revisionData.dueToday.length === 0 ? (
                  <p className="text-sm text-[#78788c] py-4 text-center">Nothing due for revision today</p>
                ) : revisionData.dueToday.map((topic) => (
                  <div key={topic} className="flex items-center gap-3 p-3 rounded-xl border border-[#3b5bdb]/20 bg-[#3b5bdb]/5">
                    <Clock className="w-4 h-4 text-[#3b5bdb] shrink-0" />
                    <span className="text-sm text-white">{displayTopic(topic)}</span>
                    <span className="ml-auto text-[10px] text-[#3b5bdb] font-semibold">Due today</span>
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
            <SLabel>Your practice this week</SLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Done today",        value: practiceStats.todayTarget > 0 ? `${practiceStats.todayDone}/${practiceStats.todayTarget}` : `${practiceStats.todayDone}`,  color: "#3b5bdb" },
                { label: "Done this week",    value: practiceStats.weekTarget > 0 ? `${practiceStats.weekDone}/${practiceStats.weekTarget}` : `${practiceStats.weekDone}`,   color: "#4b9fd4" },
                { label: "Practice streak",   value: `${practiceStats.streakDays} days`,                        color: "#c08a3a" },
                { label: "Consistency",       value: `${practiceStats.consistency}%`,                           color: "#4aa87a" },
              ].map((s) => <Metric key={s.label} label={s.label} value={s.value} color={s.color} />)}
            </div>
          </div>

          {/* Practice monthly */}
          <Card label="Questions practiced each month">
            {practiceMonthly.length > 0 ? (
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={practiceMonthly} barSize={32}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="done" name="Questions" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {practiceMonthly.map((_, i) => (
                      <Cell key={i} fill={i === practiceMonthly.length - 1 ? "#3b5bdb" : "rgba(59,130,246,0.35)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            ) : (
              <p className="text-sm text-[#78788c] mt-4 py-8 text-center">No monthly practice data yet</p>
            )}
          </Card>

          {/* Test results */}
          <div>
            <SLabel>Recent tests</SLabel>
            {testResults.length === 0 ? (
              <p className="text-sm text-[#78788c] py-6 text-center">No test results yet</p>
            ) : (
            <div className="space-y-2">
              {testResults.map((t) => {
                const col = scoreColor(t.score);
                return (
                  <div key={t.name} className="flex items-center gap-4 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-black" style={{ background: `${col}15`, color: col }}>
                      {t.score}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white">{t.name}</div>
                      <div className="text-[11px] text-[#78788c]">{t.subject} · {t.date}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black tabular-nums" style={{ color: col }}>{t.marksObtained}/{t.rawMax}</div>
                      <div className="text-[11px] text-[#78788c]">{t.score}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>

          {/* Score trend */}
          {testTrend.length > 0 && (
          <Card label="How your test scores changed">
            <div className="h-40 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={testTrend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={testTrendDomain} tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="score" name="Score" stroke="#4b9fd4" strokeWidth={2.5}
                    isAnimationActive={false} dot={{ r: 5, fill: "#4b9fd4", strokeWidth: 0 }} activeDot={{ r: 7, stroke: "#0d0d0f", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          )}

          {/* Speed */}
          <div>
            <SLabel>How fast you solve questions</SLabel>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <Metric label="Average per question"  value={speedStats.avgSec > 0 ? `${speedStats.avgSec}s` : "—"}    color="#e8eaf0" />
              <Metric label="Fastest subject"        value={speedStats.fastestSubject}  color="#4aa87a" sub={speedStats.avgSec > 0 ? `${speedStats.fastestSec}s avg` : undefined} />
              <Metric label="Takes most time"        value={speedStats.slowestSubject}  color="#c08a3a" sub={speedStats.avgSec > 0 ? `${speedStats.slowestSec}s avg` : undefined} />
            </div>
            <Card label="Time per question by subject (seconds)">
              {speedBySubject.length > 0 && speedStats.avgSec > 0 ? (
              <div className="h-40 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={speedBySubject} layout="vertical" barSize={14}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "#a0a0b0", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgSec" name="Seconds" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                      {speedBySubject.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
              ) : (
                <p className="text-sm text-[#78788c] mt-4 py-8 text-center">No speed data yet</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Tab: Activity & Speed ────────── */}
      {tab === "activity" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Total study time"    value={`${studyActivity.totalHrs}h`}       color="#6882e8" />
            <Metric label="Average per day"     value={`${studyActivity.avgDailyMin} min`} color="#e8eaf0" />
            <Metric label="Most active day"     value={studyActivity.bestDay}              color="#c08a3a" />
            <Metric label="Most productive hour" value={studyActivity.bestHour}            color="#4b9fd4" />
          </div>

          {/* Weekly hours */}
          <Card label="Study time each day this week (hours)">
            <div className="h-44 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => ({ day: d, hours: studyActivity.weeklyHrs[i] }))}
                  barSize={28}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#78788c", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {studyActivity.weeklyHrs.map((v, i) => (
                      <Cell key={i} fill={v === Math.max(...studyActivity.weeklyHrs) ? "#6882e8" : "rgba(167,139,250,0.3)"} />
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
                    <div key={d} className="flex-1 text-center text-[10px] text-[#78788c]">{d}</div>
                  ))}
                </div>
                {activityHeatmap.map((row) => (
                  <div key={row.week} className="flex items-center gap-1 mb-1.5">
                    <div className="w-8 text-[10px] text-[#78788c] shrink-0">{row.week}</div>
                    {row.days.map((cell) => {
                      const intensity = cell.value / 50;
                      const bg = cell.value === 0 ? "rgba(255,255,255,0.04)" : `rgba(59,130,246,${0.08 + intensity * 0.92})`;
                      return (
                        <div key={cell.day} title={`${cell.value} questions`}
                          className="flex-1 h-8 rounded-lg transition-all hover:scale-110 cursor-default"
                          style={{ background: bg }} />
                      );
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <span className="text-[10px] text-[#78788c]">Less</span>
                  {[0.08, 0.3, 0.55, 0.75, 1].map((o) => (
                    <div key={o} className="w-3 h-3 rounded-sm" style={{ background: `rgba(59,130,246,${o})` }} />
                  ))}
                  <span className="text-[10px] text-[#78788c]">More</span>
                </div>
              </div>
            </div>
          </Card>

          {/* This month vs last month */}
          <Card label="This month vs last month">
            <div className="grid grid-cols-3 gap-4 mt-3">
              {monthComparison.map((row) => {
                const diff = row.lastM > 0 ? row.thisM - row.lastM : 0;
                const pct = row.lastM > 0 ? Math.round((diff / row.lastM) * 100) : 0;
                const up = diff > 0;
                return (
                  <div key={row.label} className="text-center p-3 rounded-xl border border-white/7 bg-[#131316]/60">
                    <div className="text-[10px] text-[#78788c] uppercase tracking-wider mb-1">{row.label}</div>
                    <div className="text-xl font-black text-white">{row.thisM}{row.unit}</div>
                    <div className="text-[10px] text-[#78788c] mt-0.5">{row.lastM > 0 ? `vs ${row.lastM}${row.unit} last month` : "No prior month data"}</div>
                    {row.lastM > 0 && (
                    <div className={cn("flex items-center gap-1 justify-center mt-1 text-xs font-semibold", up ? "text-emerald-400" : diff < 0 ? "text-rose-400" : "text-[#78788c]")}>
                      {diff !== 0 && (up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      {diff !== 0 ? `${up ? "+" : ""}${pct}%` : "—"}
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
              <p className="text-sm text-[#78788c] py-6 text-center">No milestones yet — keep practicing!</p>
            ) : (
            <div className="space-y-3">
              {milestones.map((m) => (
                <div key={m.title} className="flex items-start gap-4 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/12 transition-colors">
                  <span className="text-2xl shrink-0 mt-0.5">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{m.title}</span>
                      <span className="text-[9px] uppercase tracking-wider text-[#78788c] bg-white/5 px-2 py-0.5 rounded-full">{m.category}</span>
                    </div>
                    <div className="text-xs text-[#78788c] mt-0.5">{m.desc}</div>
                  </div>
                  <span className="text-[11px] text-[#78788c] shrink-0">{m.date}</span>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Upcoming milestones */}
          <div>
            <SLabel>Next milestones to reach</SLabel>
            {upcomingMilestones.length === 0 ? (
              <p className="text-sm text-[#78788c] py-6 text-center">No upcoming milestones tracked yet</p>
            ) : (
            <div className="space-y-3">
              {upcomingMilestones.map((m) => {
                const pct = Math.round((m.progress / m.target) * 100);
                return (
                  <div key={m.title} className="p-4 rounded-xl border border-white/7 bg-[#131316]/60">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-white">{m.title}</span>
                      <span className="text-xs text-[#78788c]">{m.progress}/{m.target} {m.unit}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#3b5bdb,#4b9fd4)" }} />
                    </div>
                    <div className="text-[10px] text-[#78788c] mt-1">{pct}% complete</div>
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
                { label: "Download PDF report",   icon: <Download className="w-4 h-4" />,  color: "#3b5bdb",  desc: "Full performance report as PDF", action: "pdf" as const },
                { label: "Share with teacher",    icon: <Share2 className="w-4 h-4" />,    color: "#4aa87a",  desc: "Send a link to your teacher", action: "share" as const },
                { label: "Share with parents",    icon: <Share2 className="w-4 h-4" />,    color: "#6882e8",  desc: "Send a summary to your parents", action: "share" as const },
                { label: "Print report",          icon: <Printer className="w-4 h-4" />,   color: "#c08a3a",  desc: "Print a physical copy", action: "print" as const },
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
                      `Accuracy: ${overview.accuracy}%`,
                      `Questions: ${overview.totalQuestions}`,
                      `Practice sessions: ${overview.practiceCompleted}`,
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
                  className="flex items-center gap-3 p-4 rounded-xl border border-white/7 bg-[#131316]/60 hover:border-white/20 hover:bg-[#131316] transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform" style={{ background: `${r.color}15`, color: r.color }}>
                    {r.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{r.label}</div>
                    <div className="text-[11px] text-[#78788c]">{r.desc}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#78788c] ml-auto shrink-0 group-hover:text-white transition-colors" />
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

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl border border-white/7 bg-[#131316]/60">
      <SLabel>{label}</SLabel>
      {children}
    </div>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-0">
      <div className="w-1 h-3.5 rounded-full bg-[#3b5bdb]" />
      <span className="text-[11px] uppercase tracking-[0.14em] text-[#78788c]">{children}</span>
    </div>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl border border-white/7 bg-[#131316]/60">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[#78788c] mb-1">{label}</div>
      <div className="text-2xl font-black tabular-nums leading-none" style={{ color: color ?? "#e8eaf0", fontFamily: "var(--font-display)" }}>{value}</div>
      {sub && <div className="text-[11px] text-[#78788c] mt-1">{sub}</div>}
    </div>
  );
}
