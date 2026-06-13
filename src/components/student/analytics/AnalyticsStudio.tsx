import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { useAuth } from "@/hooks/useAuth";
import { buildRuleAnalyticsInsights, resolveTopicGaps } from "@/lib/analyticsInsights";
import {
  MistakeTopicTable,
  SessionLog,
  TopicDeepCards,
  WeeklyStudyPlan,
} from "@/components/student/analytics/AnalysisDeepSections";
import { AnalysisClassStanding } from "@/components/student/analytics/AnalysisWidgets";
import { MasterySection } from "@/components/student/analytics/wisdom/MasterySection";
import { MistakeSection } from "@/components/student/analytics/wisdom/MistakeSection";
import { PerformanceSection } from "@/components/student/analytics/wisdom/PerformanceSection";
import { Loader2, RefreshCw } from "lucide-react";
import "./wisdom/wisdom-analytics.css";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

const ANCHORS = [
  { id: "mastery", label: "Mastery" },
  { id: "mistakes", label: "Mistakes" },
  { id: "trends", label: "Trends" },
] as const;

export function AnalyticsStudio({ data, charts }: Props) {
  const { user } = useAuth();
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery } = useConceptMastery();
  const { data: recovery } = useRecoveryZone();
  const {
    insights,
    aggregates,
    enhancing,
    loading: insightsLoading,
    coachLive,
    error: coachError,
    reload: reloadCoach,
  } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const score = readiness?.score ?? 0;
  const level = data.xp?.level ?? 1;
  const rank = pageData?.class_rank;

  const ruleInsights =
    aggregates.length > 0 ? buildRuleAnalyticsInsights(aggregates, mastery, data) : null;
  const displayInsights = insights ?? ruleInsights;
  const topicGaps = resolveTopicGaps(displayInsights, aggregates);

  const totals = pageData?.totals;
  const accuracy = totals?.accuracy_pct ?? readiness?.accuracy_pct ?? 0;

  const trend = pageData?.trend;
  const practiceTrend = charts?.practice_trend ?? [];
  const improvement =
    trend?.improvement_pct ??
    (() => {
      const prev = trend?.previous_accuracy ?? practiceTrend.at(-2)?.score_pct;
      const curr = trend?.current_accuracy ?? practiceTrend.at(-1)?.score_pct;
      return prev != null && curr != null ? Math.round((curr - prev) * 10) / 10 : null;
    })();

  const coachInsights: string[] = [];
  if (displayInsights?.diagnosis) coachInsights.push(displayInsights.diagnosis);
  if (displayInsights?.today_focus) coachInsights.push(displayInsights.today_focus);
  for (const e of displayInsights?.recurring_errors ?? []) coachInsights.push(e.label);
  for (const p of displayInsights?.error_patterns ?? []) {
    if (!coachInsights.includes(p)) coachInsights.push(p);
  }
  for (const t of topicGaps.slice(0, 2)) {
    if (!coachInsights.includes(t.why_weak)) coachInsights.push(t.why_weak);
  }

  const topGap = topicGaps[0];
  const focusTitle = topGap ? `Focus on ${topGap.topic}` : displayInsights?.headline ?? "Keep practising";
  const focusBody =
    topGap?.fix_hint ??
    displayInsights?.today_focus ??
    "Complete practice — your coach builds a drill from each wrong answer in Recovery.";

  const recoveryCount = recovery?.pending_count ?? data.recovery_pending ?? data.mistake_count ?? 0;
  const weeklyPlan = displayInsights?.weekly_plan ?? [];
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Scholar";

  const initialLoad = insightsLoading && aggregates.length === 0 && !displayInsights;

  if (initialLoad) {
    return (
      <div className="wisdom-analytics py-16 text-center text-sm text-[var(--wa-on-surface-variant)]">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading your analysis…
      </div>
    );
  }

  return (
    <div className="wisdom-analytics space-y-10 animate-rise pb-8">
      <header className="text-center md:text-left pt-2">
        <p className="wa-label text-[var(--wa-primary)] tracking-widest">Progress · Wisdom Campus</p>
        <h1 className="wa-display mt-2">Hi, {firstName}</h1>
        <p className="wa-body mt-2 max-w-lg">
          {pageData?.student_class ?? "Your class"} · Level {level} · Readiness {score}% · {accuracy}%
          accuracy{rank ? ` · Rank #${rank}` : ""}
        </p>
        {(enhancing || coachLive || coachError) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {enhancing && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--wa-on-surface-variant)] bg-[var(--wa-surface-low)] px-3 py-1 rounded-full">
                <Loader2 className="w-3 h-3 animate-spin" /> Coach analysing your mistakes…
              </span>
            )}
            {!enhancing && coachLive && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--wa-primary)] bg-[var(--wa-primary-fixed)]/40 px-3 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-[var(--wa-primary)] animate-pulse" /> Live coach ready
              </span>
            )}
            {coachError && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => reloadCoach()}>
                <RefreshCw className="w-3 h-3 mr-1" /> Retry coach
              </Button>
            )}
          </div>
        )}
      </header>

      <nav className="wa-section-nav sticky top-0 z-10 bg-[var(--wa-surface-container-lowest)]/95 backdrop-blur-sm py-2 -mx-1 px-1" aria-label="Jump to section">
        {ANCHORS.map((a) => (
          <a key={a.id} href={`#${a.id}`} className="wa-section-pill no-underline">
            {a.label}
          </a>
        ))}
      </nav>

      <div id="mastery" className="scroll-mt-20">
        <MasterySection
          data={data}
          mastery={mastery}
          topicGaps={topicGaps}
          focusTitle={focusTitle}
          focusBody={focusBody}
          level={level}
          improvement={improvement}
          enhancing={enhancing}
          coachLive={coachLive}
        />
      </div>

      <div id="mistakes" className="scroll-mt-20 pt-4 border-t border-[var(--wa-outline-variant)]/60">
        <MistakeSection
          aggregates={aggregates}
          topicGaps={topicGaps}
          coachInsights={coachInsights}
          recoveryCount={recoveryCount}
          priorityTarget={topGap ? `${topGap.topic} (${topGap.chapter})` : null}
          coachLive={coachLive}
        />
        {topicGaps.length > 0 && <div className="mt-6"><TopicDeepCards topics={topicGaps} /></div>}
        {aggregates.length > 0 && <div className="mt-6"><MistakeTopicTable aggregates={aggregates} /></div>}
        {weeklyPlan.length > 0 && <div className="mt-6"><WeeklyStudyPlan plan={weeklyPlan} /></div>}
      </div>

      <div id="trends" className="scroll-mt-20 pt-4 border-t border-[var(--wa-outline-variant)]/60">
        <PerformanceSection
          data={data}
          charts={charts}
          sessions={pageData?.recent_sessions ?? []}
          accuracy={accuracy}
          rank={rank}
          classSize={pageData?.class_size ?? 0}
          improvement={improvement}
        />
        <div className="mt-6">
          <AnalysisClassStanding
            rank={rank}
            classSize={pageData?.class_size ?? 0}
            topPeers={pageData?.leaderboard_top ?? []}
            currentUserId={user?.id}
          />
        </div>
        {!pageLoading && (
          <div className="mt-6">
            <SessionLog sessions={pageData?.recent_sessions ?? []} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3 pt-4">
        <Button variant="outline" size="sm" className="rounded-lg border-[var(--wa-outline-variant)]" asChild>
          <Link to="/student/practice/math12">Start practice</Link>
        </Button>
        <Button size="sm" className="rounded-lg bg-[var(--wa-primary)] hover:bg-[var(--wa-primary-container)]" asChild>
          <Link to="/student/recovery">Recovery zone</Link>
        </Button>
      </div>
    </div>
  );
}
