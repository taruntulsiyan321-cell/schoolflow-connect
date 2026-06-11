import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ConceptMastery } from "@/components/student/ConceptMastery";
import {
  SoftReadinessRing,
  SoftWeekActivityBars,
  SubjectBar,
} from "@/components/student/analytics/AnalyticsBits";
import {
  aggregatesToTopicGaps,
  formatLastSeen,
  linkForActionStep,
  linkForTopicGap,
  type TopicGapInsight,
} from "@/lib/analyticsInsights";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts, WeeklyActivityPoint } from "@/hooks/useStudentPerformanceCharts";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Leaf,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

function computeWeekly(weekly: WeeklyActivityPoint[] | undefined) {
  const recent = (weekly ?? []).slice(-7);
  const total = recent.reduce((s, d) => s + (d.total ?? 0), 0);
  const active = recent.filter((d) => (d.total ?? 0) > 0).length;
  return { total, active, days: recent.length };
}

const severityAccent: Record<string, { border: string; bg: string; label: string; text: string }> = {
  critical: {
    border: "border-l-[#E07A5F]",
    bg: "bg-[#FDF0EC]",
    label: "Needs attention",
    text: "text-[#C45C44]",
  },
  moderate: {
    border: "border-l-[#D4A574]",
    bg: "bg-[#FBF5EE]",
    label: "Work on this",
    text: "text-[#B8864A]",
  },
  mild: {
    border: "border-l-[#7A9E7E]",
    bg: "bg-[#F2F7F2]",
    label: "Keep an eye",
    text: "text-[#5A7D5E]",
  },
};

function TopicCard({ gap }: { gap: TopicGapInsight }) {
  const style = severityAccent[gap.severity] ?? severityAccent.mild;
  const fixLink = linkForTopicGap(gap);

  return (
    <article
      className={cn(
        "rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 shadow-sm",
        "border-l-4",
        style.border,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#8A8578]">
            {gap.subject} · {gap.chapter}
          </p>
          <h3 className="text-lg sm:text-xl font-semibold text-[#2C3E2D] mt-1 leading-snug">{gap.topic}</h3>
          {gap.misconception && (
            <span className="inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#FBF0EC] text-[#C45C44] border border-[#F0D5CC]">
              {gap.misconception}
            </span>
          )}
          {gap.ncert_ref && (
            <p className="text-xs text-[#5A7D5E] font-medium mt-2 flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> {gap.ncert_ref}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide", style.text)}>
            {style.label}
          </span>
          <span className="text-xs text-[#8A8578] tabular-nums">
            {gap.mistake_count} mistake{gap.mistake_count === 1 ? "" : "s"}
            {gap.total_wrong != null && gap.total_wrong > gap.mistake_count
              ? ` · ${gap.total_wrong} wrong attempts`
              : ""}
          </span>
          {gap.last_seen && (
            <span className="text-[10px] text-[#8A8578]">Last seen {formatLastSeen(gap.last_seen)}</span>
          )}
        </div>
      </div>

      {/* Headline insight */}
      <div className={cn("rounded-xl p-3.5 mb-3", style.bg)}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8578] mb-1">What went wrong</p>
        <p className="text-[#3D4A3E] leading-relaxed text-sm">{gap.why_weak}</p>
      </div>

      {/* Evidence */}
      {gap.evidence && (
        <p className="text-xs text-[#6B756C] mb-3 leading-relaxed border-l-2 border-[#D4CFC4] pl-3 italic">
          {gap.evidence}
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-3 text-sm mb-3">
        <div className="rounded-xl p-3.5 bg-[#F5F5F3]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8578] mb-1">Why it happened</p>
          <p className="text-[#3D4A3E] leading-relaxed">{gap.root_cause}</p>
        </div>
        <div className="rounded-xl p-3.5 bg-[#F0F5F0]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5A7D5E] mb-1">What to do</p>
          <p className="text-[#3D4A3E] leading-relaxed">{gap.fix_hint}</p>
        </div>
      </div>

      {gap.error_pattern && (
        <p className="text-xs mb-3 text-[#B8864A] font-medium">Pattern: {gap.error_pattern}</p>
      )}

      {(gap.micro_drills?.length ?? 0) > 0 && (
        <div className="rounded-xl bg-[#FAF8F4] border border-[#E8E2D9] p-3.5 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8578] mb-2 flex items-center gap-1">
            <ClipboardList className="w-3 h-3" /> Quick checks (5 min each)
          </p>
          <ol className="space-y-1.5 list-decimal list-inside text-xs text-[#4A554B] leading-relaxed">
            {gap.micro_drills!.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ol>
        </div>
      )}

      <Button
        size="sm"
        className="rounded-full bg-[#7A9E7E] hover:bg-[#6A8D6E] text-white"
        asChild
      >
        <Link to={fixLink.to}>
          {fixLink.label} <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Link>
      </Button>
    </article>
  );
}

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

export function AnalyticsStudio({ data, charts }: Props) {
  const {
    insights,
    aggregates,
    mistakeCount,
    loading,
    enhancing,
    error,
    reload,
  } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Student";
  const weekly = computeWeekly(charts?.weekly_activity);
  const subjects = [...(charts?.subjects ?? [])].sort((a, b) => b.accuracy - a.accuracy);

  const gaps: TopicGapInsight[] =
    (insights?.weak_topics?.length ?? 0) > 0
      ? insights!.weak_topics
      : enhancing
        ? []
        : aggregatesToTopicGaps(aggregates);

  const analysingMistakes = enhancing && mistakeCount > 0 && !insights;

  const topGap = gaps[0];
  const score = readiness?.score ?? 0;
  const weeklyPlan = insights?.weekly_plan ?? [];
  const steps = weeklyPlan.length
    ? weeklyPlan.map((w) => `${w.topic} (${w.chapter}) — ~${w.time_minutes} min: ${w.action}`)
    : insights?.study_priority?.length
      ? insights.study_priority
      : insights?.next_steps ?? [];
  const strong = insights?.strong_concepts ?? [];
  const momentum = insights?.momentum ?? [];
  const recurring = insights?.recurring_errors ?? [];
  const patterns = insights?.error_patterns ?? [];

  if (loading) {
    return (
      <div className="analytics-studio flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-[#7A9E7E]" />
        <p className="text-sm text-[#6B756C]">Gathering your study insights…</p>
      </div>
    );
  }

  return (
    <div className="analytics-studio space-y-8 animate-rise">
      {/* ——— Soft hero ——— */}
      <section className="rounded-3xl bg-gradient-to-br from-[#EEF4EE] via-[#FAF8F4] to-[#FFF9F5] border border-[#E0DDD4] p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <SoftReadinessRing score={score} size={108} label="Ready" />
            <div>
              <p className="text-sm text-[#7A9E7E] font-medium flex items-center gap-1.5">
                <Leaf className="w-4 h-4" /> Study insights
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold text-[#2C3E2D] mt-1">
                Hello, {firstName}
              </h1>
              <p className="text-[#5C665C] mt-2 max-w-md text-sm sm:text-base leading-relaxed">
                {insights?.diagnosis || readiness?.label || "Your personalised exam readiness overview."}
              </p>
              {analysingMistakes && (
                <p className="text-xs text-[#7A9E7E] mt-2 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Reading your mistakes and building your study plan…
                </p>
              )}
              {enhancing && insights && (
                <p className="text-xs text-[#7A9E7E] mt-2 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Updating insights…
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 w-full sm:w-auto sm:min-w-[280px]">
            {[
              { label: "Accuracy", value: `${readiness?.accuracy_pct ?? 0}%` },
              { label: "Attendance", value: `${readiness?.attendance_pct ?? 0}%` },
              { label: "Streak", value: `${data.xp?.current_streak ?? 0} days` },
              { label: "Mistakes", value: String(data.mistake_count ?? 0) },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-2xl bg-white/80 border border-[#E8E2D9] px-4 py-3 text-center shadow-sm"
              >
                <div className="text-[10px] uppercase tracking-wide text-[#8A8578] font-medium">{m.label}</div>
                <div className="text-xl font-semibold text-[#2C3E2D] tabular-nums mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-[#E0DDD4]/80">
          <Button size="sm" className="rounded-full bg-[#7A9E7E] hover:bg-[#6A8D6E] text-white" asChild>
            <Link to="/student/recovery">Fix mistakes</Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full border-[#D4CFC4] text-[#4A554B] hover:bg-white"
            asChild
          >
            <Link to="/student/practice/math12">Practice now</Link>
          </Button>
        </div>
      </section>

      {analysingMistakes && (
        <section className="rounded-2xl border border-[#C8DCC8] bg-[#F2F7F2]/80 p-8 flex flex-col items-center gap-3 text-center">
          <Sparkles className="w-8 h-8 text-[#7A9E7E] animate-pulse" />
          <p className="text-base font-medium text-[#2C3E2D]">Analysing {mistakeCount} mistakes from your book</p>
          <p className="text-sm text-[#6B756C] max-w-md">
            Finding exact topics, why you got them wrong, and what to practise today.
          </p>
          <Loader2 className="w-5 h-5 animate-spin text-[#7A9E7E]" />
        </section>
      )}

      {/* ——— What to do today ——— */}
      {!analysingMistakes && insights?.today_focus && (
        <section className="rounded-2xl bg-gradient-to-r from-[#EEF4EE] to-[#FAF8F4] border border-[#C8DCC8] p-5 sm:p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5A7D5E] mb-2 flex items-center gap-1.5">
            <Target className="w-4 h-4" /> What to do today
          </p>
          <p className="text-base sm:text-lg font-medium text-[#2C3E2D] leading-relaxed">{insights.today_focus}</p>
          {topGap && (
            <Button size="sm" className="mt-4 rounded-full" asChild>
              <Link to={linkForTopicGap(topGap).to}>
                Start with {topGap.topic} <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
          )}
        </section>
      )}

      {/* ——— Headline + patterns ——— */}
      {(insights?.headline || patterns.length > 0 || recurring.length > 0) && (
        <section className="space-y-4">
          {insights?.headline && (
            <div className="rounded-2xl bg-white border border-[#E8E2D9] p-5 sm:p-6 shadow-sm">
              <p className="text-base sm:text-lg font-medium text-[#2C3E2D] leading-relaxed">{insights.headline}</p>
              {insights.summary && (
                <p className="text-sm text-[#6B756C] mt-2 leading-relaxed">{insights.summary}</p>
              )}
            </div>
          )}

          {(recurring.length > 0 || patterns.length > 0) && (
            <div className="rounded-2xl bg-[#FBF0EC]/60 border border-[#F0D5CC] p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#C45C44] mb-3">
                Recurring mistake types
              </p>
              <div className="flex flex-wrap gap-2">
                {recurring.map((r, i) => (
                  <span
                    key={`r-${i}`}
                    className="text-xs px-3 py-2 rounded-xl bg-white text-[#C45C44] border border-[#F0D5CC] max-w-full"
                    title={r.explanation}
                  >
                    <span className="font-semibold">{r.label}</span>
                    {r.subjects.length > 0 && (
                      <span className="opacity-75 ml-1">· {r.subjects.join(", ")}</span>
                    )}
                  </span>
                ))}
                {patterns
                  .filter((p) => !recurring.some((r) => r.label === p))
                  .map((p, i) => (
                    <span
                      key={`p-${i}`}
                      className="text-xs px-3 py-1.5 rounded-full bg-white text-[#C45C44] border border-[#F0D5CC]"
                    >
                      {p}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ——— Momentum ——— */}
      {momentum.length > 0 && (
        <section className="grid sm:grid-cols-2 gap-3">
          {momentum.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-2xl border p-4 flex gap-3 items-start",
                m.direction === "improving"
                  ? "bg-[#F2F7F2] border-[#C8DCC8]"
                  : m.direction === "slipping"
                    ? "bg-[#FDF0EC] border-[#F0D5CC]"
                    : "bg-white border-[#E8E2D9]",
              )}
            >
              {m.direction === "improving" ? (
                <TrendingUp className="w-5 h-5 text-[#5A7D5E] shrink-0 mt-0.5" />
              ) : m.direction === "slipping" ? (
                <TrendingDown className="w-5 h-5 text-[#C45C44] shrink-0 mt-0.5" />
              ) : (
                <Target className="w-5 h-5 text-[#8A8578] shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#2C3E2D]">
                  {m.topic}
                  <span className="font-normal text-[#8A8578] ml-1">· {m.subject}</span>
                </p>
                <p className="text-xs text-[#6B756C] mt-1 leading-relaxed">{m.note}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ——— Focus + weekly snapshot ——— */}
      <section className="grid md:grid-cols-5 gap-4">
        <div className="md:col-span-3 rounded-3xl bg-white border border-[#E8E2D9] p-6 shadow-sm">
          <div className="flex items-center gap-2 text-[#E07A5F] mb-3">
            <Target className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Focus first</span>
          </div>
          {topGap ? (
            <>
              <h2 className="text-xl sm:text-2xl font-semibold text-[#2C3E2D] leading-tight">{topGap.topic}</h2>
              <p className="text-sm text-[#6B756C] mt-1.5">
                {topGap.chapter} · {topGap.subject}
                {topGap.last_seen ? ` · ${formatLastSeen(topGap.last_seen)}` : ""}
              </p>
              {topGap.misconception && (
                <span className="inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#FBF0EC] text-[#C45C44]">
                  {topGap.misconception}
                </span>
              )}
              <p className="text-sm text-[#4A554B] mt-4 leading-relaxed pl-4 border-l-2 border-[#E07A5F]/50">
                {topGap.fix_hint}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 rounded-full border-[#E07A5F]/40 text-[#C45C44] hover:bg-[#FDF0EC]"
                asChild
              >
                <Link to={linkForTopicGap(topGap).to}>
                  {linkForTopicGap(topGap).label} <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[#2C3E2D]">No weak topics yet</h2>
              <p className="text-sm text-[#6B756C] mt-2">Practice more — mistakes unlock topic-level insights here.</p>
              <Button size="sm" className="mt-4 rounded-full" asChild>
                <Link to="/student/practice/math12">Start practice</Link>
              </Button>
            </>
          )}
        </div>

        <div className="md:col-span-2 grid grid-rows-2 gap-4">
          <div className="rounded-2xl bg-[#F2F7F2] border border-[#D4E4D4] p-5 flex flex-col justify-center">
            <CalendarDays className="w-5 h-5 text-[#7A9E7E] mb-2" />
            <div className="text-2xl font-semibold text-[#2C3E2D] tabular-nums">
              {weekly.active}
              <span className="text-base text-[#8A8578] font-normal">/{weekly.days} days</span>
            </div>
            <p className="text-xs text-[#6B756C] mt-1">Active this week</p>
          </div>
          <div className="rounded-2xl bg-[#FFF5F0] border border-[#F0DDD4] p-5 flex flex-col justify-center">
            <TrendingUp className="w-5 h-5 text-[#E07A5F] mb-2" />
            <div className="text-2xl font-semibold text-[#2C3E2D] tabular-nums">{weekly.total}</div>
            <p className="text-xs text-[#6B756C] mt-1">Questions answered</p>
          </div>
        </div>
      </section>

      {/* ——— Weak topics ——— */}
      <section id="topics" className="scroll-mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-[#2C3E2D]">Topics to improve</h2>
            <p className="text-sm text-[#6B756C] mt-1 max-w-lg">
              Each card shows what went wrong, why, and exactly what to do next.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <Button size="sm" variant="outline" className="rounded-full" onClick={reload}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
              </Button>
            )}
            {mistakeCount > 0 && (
              <span className="text-xs text-[#8A8578]">{mistakeCount} mistakes reviewed</span>
            )}
          </div>
        </div>

        {analysingMistakes ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-[#E8E2D9] bg-white p-6 animate-pulse h-36"
              />
            ))}
          </div>
        ) : gaps.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#D4CFC4] bg-white/60 p-12 text-center">
            <Sparkles className="w-8 h-8 mx-auto text-[#7A9E7E] mb-3" />
            <p className="font-medium text-[#2C3E2D]">All clear for now</p>
            <p className="text-sm text-[#6B756C] mt-1">Wrong answers will show up here with fixes.</p>
            <Button className="mt-4 rounded-full" asChild>
              <Link to="/student/practice/math12">Start practice</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4 stagger">
            {gaps.slice(0, 8).map((gap, i) => (
              <TopicCard key={`${gap.topic}-${i}`} gap={gap} />
            ))}
          </div>
        )}
      </section>

      {/* ——— Weekly pulse ——— */}
      <section className="rounded-3xl bg-white border border-[#E8E2D9] overflow-hidden shadow-sm">
        <div className="px-5 sm:px-6 py-4 border-b border-[#EDE9E0]">
          <h3 className="text-base font-semibold text-[#2C3E2D]">Weekly rhythm</h3>
          <p className="text-xs text-[#8A8578] mt-0.5">Your study activity over the last 7 days</p>
        </div>
        <div className="p-5 sm:p-6">
          <SoftWeekActivityBars days={charts?.weekly_activity ?? []} />
        </div>
      </section>

      {/* ——— Subjects + battle plan ——— */}
      <div className="grid lg:grid-cols-2 gap-6">
        {subjects.length > 0 && (
          <section className="rounded-3xl bg-white border border-[#E8E2D9] p-5 sm:p-6 shadow-sm">
            <h3 className="text-base font-semibold text-[#2C3E2D]">Subject breakdown</h3>
            <p className="text-xs text-[#8A8578] mt-0.5 mb-5">Accuracy by subject</p>
            <div className="space-y-5">
              {subjects.map((s, i) => (
                <SubjectBar
                  key={s.name}
                  name={s.name}
                  accuracy={s.accuracy}
                  attempts={s.attempts ?? 0}
                  rank={i + 1}
                  variant="soft"
                />
              ))}
            </div>
          </section>
        )}

        <section className="rounded-3xl bg-gradient-to-br from-[#F2F7F2] to-[#FAF8F4] border border-[#D4E4D4] p-5 sm:p-6">
          <h3 className="text-base font-semibold text-[#2C3E2D]">This week&apos;s focus</h3>
          <p className="text-xs text-[#8A8578] mt-0.5 mb-5">Prioritised steps with time estimates</p>
          <ol className="space-y-3">
            {(weeklyPlan.length
              ? weeklyPlan
              : steps.length
                ? steps.map((s, i) => ({
                    topic: `Step ${i + 1}`,
                    chapter: "",
                    subject: "",
                    time_minutes: 0,
                    action: s,
                    priority: i + 1,
                  }))
                : [{ topic: "Practice", chapter: "", subject: "", time_minutes: 15, action: "Start practice to unlock your personalised plan.", priority: 1 }]
            )
              .slice(0, 5)
              .map((item, i) => {
                const link =
                  weeklyPlan.length > 0
                    ? linkForTopicGap({
                        topic: item.topic,
                        chapter: item.chapter || "General",
                        subject: item.subject || "General",
                        severity: "moderate",
                        why_weak: "",
                        root_cause: "",
                        fix_hint: item.action,
                        mistake_count: 1,
                      })
                    : linkForActionStep(item.action);
                return (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7A9E7E] text-white text-xs font-semibold">
                      {item.priority ?? i + 1}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      {weeklyPlan.length > 0 && (
                        <p className="text-sm font-medium text-[#2C3E2D]">
                          {item.topic}
                          {item.time_minutes > 0 && (
                            <span className="text-[#8A8578] font-normal ml-1">· ~{item.time_minutes} min</span>
                          )}
                        </p>
                      )}
                      <p className="text-sm leading-relaxed text-[#3D4A3E]">{item.action}</p>
                      <Link
                        to={link.to}
                        className="text-xs text-[#5A7D5E] font-medium mt-1 inline-flex items-center hover:underline"
                      >
                        {link.label} <ArrowRight className="w-3 h-3 ml-0.5" />
                      </Link>
                    </div>
                  </li>
                );
              })}
          </ol>
        </section>
      </div>

      {strong.length > 0 && (
        <section className="rounded-2xl bg-[#F2F7F2] border border-[#D4E4D4] p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-[#5A7D5E] flex items-center gap-1.5 mb-3">
            <CheckCircle2 className="w-4 h-4" /> Topics you&apos;re handling well
          </h3>
          <div className="flex flex-wrap gap-2">
            {strong.map((s, i) => (
              <span
                key={i}
                className="text-xs px-3 py-1.5 rounded-full bg-white border border-[#C8DCC8] text-[#4A6B4E]"
              >
                <span className="font-medium">{s.concept}</span>
                <span className="opacity-70 ml-1">· {s.subject}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <ConceptMastery limit={5} />
      </section>
    </div>
  );
}
