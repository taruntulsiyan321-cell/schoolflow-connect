import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConceptMastery } from "@/components/student/ConceptMastery";
import {
  SoftReadinessRing,
  SoftWeekActivityBars,
  SubjectBar,
} from "@/components/student/analytics/AnalyticsBits";
import {
  aggregatesToTopicGaps,
  clipInsightText,
  formatLastSeen,
  insightHook,
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
  ChevronDown,
  Leaf,
  Loader2,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

function computeWeekly(weekly: WeeklyActivityPoint[] | undefined) {
  const recent = (weekly ?? []).slice(-7);
  const total = recent.reduce((s, d) => s + (d.total ?? 0), 0);
  const active = recent.filter((d) => (d.total ?? 0) > 0).length;
  return { total, active, days: recent.length };
}

const severityStyle: Record<string, { dot: string; ring: string; label: string }> = {
  critical: { dot: "bg-[#E07A5F]", ring: "ring-[#F0D5CC]", label: "Urgent" },
  moderate: { dot: "bg-[#D4A574]", ring: "ring-[#EDE4D4]", label: "Fix soon" },
  mild: { dot: "bg-[#7A9E7E]", ring: "ring-[#D4E4D4]", label: "Watch" },
};

function TopicCard({
  gap,
  rank,
  defaultOpen = false,
}: {
  gap: TopicGapInsight;
  rank: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const style = severityStyle[gap.severity] ?? severityStyle.mild;
  const fixLink = linkForTopicGap(gap);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article
        className={cn(
          "rounded-2xl border border-[#E8E2D9] bg-white shadow-sm overflow-hidden",
          "ring-2 ring-offset-0",
          style.ring,
        )}
      >
        <div className="flex items-center gap-3 p-3.5 sm:p-4">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white text-sm font-bold",
              style.dot,
            )}
          >
            {String(rank).padStart(2, "0")}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-semibold text-[#2C3E2D] truncate text-[15px]">{gap.topic}</h3>
              <span className="text-[10px] font-medium text-[#8A8578] shrink-0">
                {gap.mistake_count}× wrong
              </span>
            </div>
            <p className="text-[11px] text-[#8A8578] truncate mt-0.5">
              {gap.subject} · {gap.chapter}
              {gap.last_seen ? ` · ${formatLastSeen(gap.last_seen)}` : ""}
            </p>
            <p className="text-xs text-[#4A554B] mt-1.5 line-clamp-1">{insightHook(gap)}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" className="rounded-full h-8 px-3 text-xs bg-[#7A9E7E] hover:bg-[#6A8D6E]" asChild>
              <Link to={fixLink.to}>Fix</Link>
            </Button>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="h-8 w-8 rounded-full border border-[#E8E2D9] flex items-center justify-center text-[#8A8578] hover:bg-[#FAF8F4]"
                aria-label="More details"
              >
                <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-0 border-t border-[#F0EDE6] space-y-3">
            {gap.misconception && (
              <span className="inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#FBF0EC] text-[#C45C44]">
                {gap.misconception}
              </span>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-[#FAF8F4] p-2.5">
                <p className="text-[9px] uppercase tracking-wide text-[#8A8578] font-semibold mb-0.5">Issue</p>
                <p className="text-[#3D4A3E] line-clamp-2">{gap.why_weak}</p>
              </div>
              <div className="rounded-lg bg-[#F0F5F0] p-2.5">
                <p className="text-[9px] uppercase tracking-wide text-[#5A7D5E] font-semibold mb-0.5">Do this</p>
                <p className="text-[#3D4A3E] line-clamp-2">{gap.fix_hint}</p>
              </div>
            </div>

            {gap.evidence && (
              <p className="text-[11px] text-[#6B756C] flex items-center gap-1">
                <Zap className="w-3 h-3 text-[#E07A5F] shrink-0" />
                {gap.evidence}
              </p>
            )}

            {(gap.micro_drills?.length ?? 0) > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
                {gap.micro_drills!.map((d, i) => (
                  <span
                    key={i}
                    className="shrink-0 max-w-[200px] text-[10px] leading-snug px-2.5 py-1.5 rounded-lg bg-[#EEF4EE] text-[#4A554B] border border-[#D4E4D4]"
                  >
                    {i + 1}. {d}
                  </span>
                ))}
              </div>
            )}

            {gap.ncert_ref && (
              <p className="text-[10px] text-[#5A7D5E] flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> {gap.ncert_ref}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </article>
    </Collapsible>
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
  const momentum = insights?.momentum ?? [];
  const recurring = insights?.recurring_errors ?? [];
  const patterns = insights?.error_patterns ?? [];
  const strong = insights?.strong_concepts ?? [];
  const patternChips = [
    ...recurring.map((r) => r.label),
    ...patterns.filter((p) => !recurring.some((r) => r.label === p)),
  ].slice(0, 6);

  if (loading) {
    return (
      <div className="analytics-studio flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-[#7A9E7E]" />
        <p className="text-sm text-[#6B756C]">Gathering your study insights…</p>
      </div>
    );
  }

  return (
    <div className="analytics-studio space-y-5 animate-rise">
      {/* Hero — compact */}
      <section className="rounded-2xl bg-gradient-to-br from-[#EEF4EE] via-[#FAF8F4] to-[#FFF9F5] border border-[#E0DDD4] p-4 sm:p-5">
        <div className="flex gap-4 items-center">
          <SoftReadinessRing score={score} size={80} label="Ready" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-[#7A9E7E] font-medium flex items-center gap-1">
                <Leaf className="w-3.5 h-3.5" /> {firstName}
              </p>
              {insights?.source === "gemini" && !analysingMistakes && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#7A9E7E] text-white">
                  Live
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-[#2C3E2D] mt-1 line-clamp-2">
              {insights?.headline ||
                clipInsightText(insights?.diagnosis ?? readiness?.label ?? "Your exam readiness snapshot.", 100)}
            </p>
            {insights?.summary && (
              <p className="text-[11px] text-[#8A8578] mt-0.5">{insights.summary}</p>
            )}
          </div>
          <div className="hidden sm:grid grid-cols-2 gap-1.5 shrink-0">
            {[
              { label: "Acc", value: `${readiness?.accuracy_pct ?? 0}%` },
              { label: "Miss", value: String(data.mistake_count ?? 0) },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-white/90 border border-[#E8E2D9] px-2 py-1.5 text-center">
                <div className="text-[8px] uppercase text-[#8A8578]">{m.label}</div>
                <div className="text-sm font-semibold text-[#2C3E2D] tabular-nums">{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {!analysingMistakes && insights?.today_focus && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white/70 border border-[#C8DCC8] px-3 py-2">
            <Target className="w-4 h-4 text-[#5A7D5E] shrink-0" />
            <p className="text-xs text-[#2C3E2D] flex-1 min-w-0 line-clamp-1">{insights.today_focus}</p>
            {topGap && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-[#5A7D5E] shrink-0" asChild>
                <Link to={linkForTopicGap(topGap).to}>
                  Go <ArrowRight className="w-3 h-3 ml-0.5" />
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <Button size="sm" className="rounded-full h-8 text-xs bg-[#7A9E7E] hover:bg-[#6A8D6E]" asChild>
            <Link to="/student/recovery">Fix mistakes</Link>
          </Button>
          <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" asChild>
            <Link to="/student/practice/math12">Practice</Link>
          </Button>
        </div>
      </section>

      {analysingMistakes && (
        <div className="rounded-xl border border-[#C8DCC8] bg-[#F2F7F2] p-6 flex items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-[#7A9E7E]" />
          <p className="text-sm text-[#4A554B]">Reading {mistakeCount} mistakes…</p>
        </div>
      )}

      {/* Pattern chips — visual, no paragraphs */}
      {!analysingMistakes && patternChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {patternChips.map((label, i) => (
            <span
              key={i}
              className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-[#FBF0EC] text-[#C45C44] border border-[#F0D5CC]"
            >
              {clipInsightText(label, 32)}
            </span>
          ))}
        </div>
      )}

      {/* Momentum — single row */}
      {momentum.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {momentum.map((m, i) => (
            <div
              key={i}
              className={cn(
                "shrink-0 flex items-center gap-2 rounded-xl border px-3 py-2 min-w-[140px]",
                m.direction === "improving"
                  ? "bg-[#F2F7F2] border-[#C8DCC8]"
                  : m.direction === "slipping"
                    ? "bg-[#FDF0EC] border-[#F0D5CC]"
                    : "bg-white border-[#E8E2D9]",
              )}
            >
              {m.direction === "improving" ? (
                <TrendingUp className="w-4 h-4 text-[#5A7D5E]" />
              ) : m.direction === "slipping" ? (
                <TrendingDown className="w-4 h-4 text-[#C45C44]" />
              ) : (
                <Target className="w-4 h-4 text-[#8A8578]" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#2C3E2D] truncate">{m.topic}</p>
                <p className="text-[10px] text-[#8A8578] line-clamp-1">{clipInsightText(m.note, 40)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Week plan — horizontal cards */}
      {!analysingMistakes && weeklyPlan.length > 0 && (
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8578] mb-2">This week</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {weeklyPlan.slice(0, 5).map((item, i) => {
              const link = linkForTopicGap({
                topic: item.topic,
                chapter: item.chapter || "General",
                subject: item.subject || "General",
                severity: "moderate",
                why_weak: "",
                root_cause: "",
                fix_hint: item.action,
                mistake_count: 1,
              });
              return (
                <Link
                  key={i}
                  to={link.to}
                  className="shrink-0 w-[148px] rounded-xl border border-[#D4E4D4] bg-gradient-to-b from-[#F2F7F2] to-white p-3 hover:border-[#7A9E7E] transition-colors"
                >
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-2xl font-bold text-[#7A9E7E] tabular-nums">{item.time_minutes}</span>
                    <span className="text-[10px] text-[#8A8578]">min</span>
                  </div>
                  <p className="text-xs font-semibold text-[#2C3E2D] mt-1 truncate">{item.topic}</p>
                  <p className="text-[10px] text-[#6B756C] mt-0.5 line-clamp-2 leading-snug">{item.action}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Activity strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[#F2F7F2] border border-[#D4E4D4] p-3 text-center">
          <CalendarDays className="w-4 h-4 text-[#7A9E7E] mx-auto mb-1" />
          <div className="text-lg font-semibold text-[#2C3E2D] tabular-nums">
            {weekly.active}<span className="text-xs text-[#8A8578] font-normal">/{weekly.days}</span>
          </div>
          <p className="text-[9px] text-[#8A8578] uppercase tracking-wide">Active days</p>
        </div>
        <div className="rounded-xl bg-[#FFF5F0] border border-[#F0DDD4] p-3 text-center">
          <TrendingUp className="w-4 h-4 text-[#E07A5F] mx-auto mb-1" />
          <div className="text-lg font-semibold text-[#2C3E2D] tabular-nums">{weekly.total}</div>
          <p className="text-[9px] text-[#8A8578] uppercase tracking-wide">Questions</p>
        </div>
        <div className="rounded-xl bg-white border border-[#E8E2D9] p-3 text-center">
          <Target className="w-4 h-4 text-[#7A9E7E] mx-auto mb-1" />
          <div className="text-lg font-semibold text-[#2C3E2D] tabular-nums">{gaps.length}</div>
          <p className="text-[9px] text-[#8A8578] uppercase tracking-wide">Weak topics</p>
        </div>
      </div>

      {/* Topic list — compact cards */}
      <section id="topics" className="scroll-mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-[#2C3E2D]">Topics to fix</h2>
          <div className="flex items-center gap-2">
            {error && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reload}>
                <RefreshCw className="w-3 h-3 mr-1" /> Retry
              </Button>
            )}
            {mistakeCount > 0 && (
              <span className="text-[10px] text-[#8A8578]">{mistakeCount} reviewed</span>
            )}
          </div>
        </div>

        {analysingMistakes ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-[#E8E2D9] bg-white h-16 animate-pulse" />
            ))}
          </div>
        ) : gaps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D4CFC4] p-8 text-center">
            <p className="text-sm font-medium text-[#2C3E2D]">No weak topics yet</p>
            <Button size="sm" className="mt-3 rounded-full h-8 text-xs" asChild>
              <Link to="/student/practice/math12">Start practice</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {gaps.slice(0, 8).map((gap, i) => (
              <TopicCard key={`${gap.topic}-${i}`} gap={gap} rank={i + 1} defaultOpen={i === 0} />
            ))}
          </div>
        )}
      </section>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-2xl bg-white border border-[#E8E2D9] p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[#2C3E2D]">Weekly rhythm</h3>
          <div className="mt-3">
            <SoftWeekActivityBars days={charts?.weekly_activity ?? []} />
          </div>
        </section>

        {subjects.length > 0 && (
          <section className="rounded-2xl bg-white border border-[#E8E2D9] p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#2C3E2D]">By subject</h3>
            <div className="mt-3 space-y-3">
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
      </div>

      {strong.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <CheckCircle2 className="w-4 h-4 text-[#5A7D5E] shrink-0" />
          {strong.map((s, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-1 rounded-full bg-[#F2F7F2] border border-[#C8DCC8] text-[#4A6B4E]"
            >
              {s.concept}
            </span>
          ))}
        </div>
      )}

      <ConceptMastery limit={5} />
    </div>
  );
}
