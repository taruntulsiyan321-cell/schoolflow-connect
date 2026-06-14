import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAcademicCoach } from "@/hooks/useAcademicCoach";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { useAuth } from "@/hooks/useAuth";
import { buildRuleAnalyticsInsights, resolveTopicGaps } from "@/lib/analyticsInsights";
import { presentationValue, withPresentationFallback } from "@/lib/presentationMode";
import {
  DEMO_AGGREGATES,
  DEMO_COACH_INSIGHTS,
  DEMO_INSIGHTS,
  DEMO_MASTERY,
  DEMO_MOMENTUM,
  DEMO_SESSIONS,
  DEMO_TOPIC_GAPS,
  DEMO_WEEKLY_PLAN,
} from "@/lib/presentationAnalytics";
import { AnalyticsHero } from "@/components/student/analytics/AnalyticsHero";
import {
  MistakeTopicTable,
  MomentumSection,
  SessionLog,
  TopicDeepCards,
  WeeklyStudyPlan,
} from "@/components/student/analytics/AnalysisDeepSections";
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
  { id: "mastery", label: "Concept mastery" },
  { id: "mistakes", label: "Mistakes" },
  { id: "coach", label: "Coach" },
  { id: "trends", label: "Trends" },
] as const;

export function AnalyticsStudio({ data, charts }: Props) {
  const { user } = useAuth();
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery } = useConceptMastery();
  const { data: recovery } = useRecoveryZone();
  const {
    insights,
    aggregates: liveAggregates,
    enhancing,
    loading: insightsLoading,
    coachLive,
    error: coachError,
    reload: reloadCoach,
  } = useAcademicCoach(data);

  const readiness = data.exam_readiness;
  const score = readiness?.score ?? 0;
  const level = data.xp?.level ?? 1;
  const rank = presentationValue(pageData?.class_rank, 6);
  const classSize = presentationValue(pageData?.class_size, 32);

  const ruleFallback =
    liveAggregates.length > 0 ? buildRuleAnalyticsInsights(liveAggregates, mastery, data) : null;
  const displayInsights = insights ?? ruleFallback ?? DEMO_INSIGHTS;

  const aggregates = withPresentationFallback(liveAggregates, DEMO_AGGREGATES, 1);
  const topicGaps = withPresentationFallback(
    resolveTopicGaps(displayInsights, aggregates),
    DEMO_TOPIC_GAPS,
    1,
  );
  const displayMastery = withPresentationFallback(mastery, DEMO_MASTERY, 4);

  const totals = pageData?.totals;
  const accuracy = presentationValue(
    totals?.accuracy_pct ?? readiness?.accuracy_pct,
    74,
  );

  const trend = pageData?.trend;
  const practiceTrend = charts?.practice_trend ?? [];
  const improvement =
    trend?.improvement_pct ??
    (() => {
      const prev = trend?.previous_accuracy ?? practiceTrend.at(-2)?.score_pct;
      const curr = trend?.current_accuracy ?? practiceTrend.at(-1)?.score_pct;
      return prev != null && curr != null ? Math.round((curr - prev) * 10) / 10 : presentationValue(null, 8.5);
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
  const displayCoachInsights = withPresentationFallback(coachInsights, DEMO_COACH_INSIGHTS, 1);

  const topGap = topicGaps[0];
  const focusTitle = topGap ? `Focus on ${topGap.topic}` : displayInsights?.headline ?? "Keep practising";
  const focusBody =
    topGap?.fix_hint ??
    displayInsights?.today_focus ??
    "Complete practice — your coach builds a drill from each wrong answer in Recovery.";

  const recoveryCount = presentationValue(
    recovery?.pending_count ?? data.recovery_pending ?? data.mistake_count,
    12,
  );
  const weeklyPlan = withPresentationFallback(
    displayInsights?.weekly_plan ?? [],
    DEMO_WEEKLY_PLAN,
    1,
  );
  const momentum = withPresentationFallback(
    displayInsights?.momentum ?? [],
    DEMO_MOMENTUM,
    1,
  );
  const sessions = withPresentationFallback(
    pageData?.recent_sessions ?? [],
    DEMO_SESSIONS,
    2,
  );

  const firstName = data.student?.full_name?.split(" ")[0] ?? "Scholar";
  const studentClass = pageData?.student_class ?? "Class 12 · Section A";
  const streak = data.xp?.current_streak ?? 5;

  const initialLoad = insightsLoading && liveAggregates.length === 0 && !displayInsights;

  if (initialLoad) {
    return (
      <div className="wisdom-analytics py-16 text-center text-sm text-[var(--wa-on-surface-variant)]">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading your analysis…
      </div>
    );
  }

  return (
    <div className="wisdom-analytics wa-gradient-bg space-y-8 animate-rise pb-10 px-1 sm:px-2">
      <AnalyticsHero
        firstName={firstName}
        studentClass={studentClass}
        readiness={presentationValue(score, 78)}
        accuracy={accuracy}
        level={level}
        rank={rank}
        classSize={classSize}
        streak={streak}
        improvement={improvement}
        coachHeadline={displayInsights?.headline ?? focusTitle}
        coachFocus={displayInsights?.today_focus ?? focusBody}
      />

      {(enhancing || coachLive || coachError) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {enhancing && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--wa-on-surface-variant)] bg-white/80 px-3 py-1 rounded-full border border-[var(--wa-outline-variant)]">
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

      <nav
        className="wa-section-nav sticky top-0 z-10 bg-[var(--wa-surface-container-lowest)]/90 backdrop-blur-md py-2.5 -mx-1 px-2 rounded-full border border-[var(--wa-outline-variant)]/40"
        aria-label="Jump to section"
      >
        {ANCHORS.map((a) => (
          <a key={a.id} href={`#${a.id}`} className="wa-section-pill no-underline">
            {a.label}
          </a>
        ))}
      </nav>

      <div id="mastery" className="scroll-mt-24">
        <MasterySection
          data={data}
          mastery={displayMastery}
          topicGaps={topicGaps}
          focusTitle={focusTitle}
          focusBody={focusBody}
          level={level}
          improvement={improvement}
          enhancing={enhancing}
          coachLive={coachLive}
        />
      </div>

      <div id="mistakes" className="scroll-mt-24 pt-2">
        <MistakeSection
          aggregates={aggregates}
          topicGaps={topicGaps}
          coachInsights={displayCoachInsights}
          recoveryCount={recoveryCount}
          priorityTarget={topGap ? `${topGap.topic} (${topGap.chapter})` : "Chain rule (Differentiation)"}
          coachLive={coachLive}
        />
        <div className="mt-6">
          <TopicDeepCards topics={topicGaps} variant="wisdom" />
        </div>
        <div className="mt-6">
          <MistakeTopicTable aggregates={aggregates} variant="wisdom" />
        </div>
      </div>

      <div id="coach" className="scroll-mt-24 pt-2 space-y-6">
        <header>
          <h2 className="wa-display text-2xl md:text-3xl">Coach insights</h2>
          <p className="wa-body mt-1">Personalised study plan and momentum signals from your attempts.</p>
        </header>
        <div className="wa-insight-strip">
          {displayCoachInsights.slice(0, 4).map((line, i) => (
            <div key={i} className="wa-insight-card">
              <p className="wa-label text-[var(--wa-primary)] mb-2">Insight {i + 1}</p>
              <p className="text-sm font-medium text-[var(--wa-on-surface)] leading-relaxed">{line}</p>
            </div>
          ))}
        </div>
        <WeeklyStudyPlan plan={weeklyPlan} variant="wisdom" />
        <MomentumSection signals={momentum} variant="wisdom" />
      </div>

      <div id="trends" className="scroll-mt-24 pt-2">
        <PerformanceSection
          data={data}
          charts={charts}
          sessions={sessions}
          accuracy={accuracy}
          rank={rank}
          classSize={classSize}
          improvement={improvement}
        />
        {!pageLoading && (
          <div className="mt-6">
            <SessionLog sessions={sessions} variant="wisdom" />
          </div>
        )}
      </div>

      <div className="wa-cta-bar">
        <Button variant="outline" size="sm" className="rounded-lg border-[var(--wa-outline-variant)] bg-white" asChild>
          <Link to="/student/practice/math12">Start practice</Link>
        </Button>
        <Button size="sm" className="rounded-lg bg-[var(--wa-primary)] hover:bg-[var(--wa-primary-container)]" asChild>
          <Link to="/student/recovery">Recovery zone</Link>
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg border-[var(--wa-outline-variant)] bg-white" asChild>
          <Link to="/student/classes#leaderboard">Class rankings</Link>
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg border-[var(--wa-outline-variant)] bg-white" asChild>
          <Link to="/student/revision">Revision center</Link>
        </Button>
      </div>
    </div>
  );
}
