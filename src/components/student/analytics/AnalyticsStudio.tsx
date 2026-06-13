import { useState } from "react";
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
import "./wisdom/wisdom-analytics.css";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

type Section = "mastery" | "mistakes" | "performance";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "mastery", label: "Mastery" },
  { id: "mistakes", label: "Mistakes" },
  { id: "performance", label: "Trends" },
];

export function AnalyticsStudio({ data, charts }: Props) {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("mastery");
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery } = useConceptMastery();
  const { data: recovery } = useRecoveryZone();
  const { insights, aggregates, enhancing, loading: insightsLoading } = useAnalyticsInsights(data);

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
  if (displayInsights?.today_focus) coachInsights.push(displayInsights.today_focus);
  for (const e of displayInsights?.recurring_errors ?? []) coachInsights.push(e.label);
  for (const p of displayInsights?.error_patterns ?? []) {
    if (!coachInsights.includes(p)) coachInsights.push(p);
  }
  for (const t of topicGaps.slice(0, 2)) {
    coachInsights.push(t.why_weak);
  }

  const topGap = topicGaps[0];
  const focusTitle = topGap ? `Focus on ${topGap.topic}` : "Keep practising";
  const focusBody =
    topGap?.fix_hint ??
    displayInsights?.diagnosis ??
    "Your next drill is chosen from mistakes in Recovery — start a session to unlock detail.";

  const recoveryCount = recovery?.pending_count ?? data.recovery_pending ?? data.mistake_count ?? 0;
  const weeklyPlan = displayInsights?.weekly_plan ?? [];
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Scholar";

  const initialLoad = insightsLoading && aggregates.length === 0 && !displayInsights;

  if (initialLoad) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground animate-rise">
        Loading your analysis…
      </div>
    );
  }

  return (
    <div className="wisdom-analytics space-y-6 animate-rise">
      <header className="pt-2">
        <p className="wa-label text-[var(--wa-primary)]">
          {pageData?.student_class ?? "Wisdom Campus"} · Level {level}
        </p>
        <h1 className="wa-display mt-1">Hi, {firstName}</h1>
        <p className="wa-body mt-1">
          Readiness {score}% · {accuracy}% accuracy
          {rank ? ` · Class rank #${rank}` : ""}
        </p>
      </header>

      <nav className="wa-section-nav" aria-label="Analysis sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="wa-section-pill"
            data-active={section === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === "mastery" && (
        <MasterySection
          data={data}
          mastery={mastery}
          topicGaps={topicGaps}
          focusTitle={focusTitle}
          focusBody={focusBody}
          level={level}
          improvement={improvement}
          enhancing={enhancing}
        />
      )}

      {section === "mistakes" && (
        <>
          <MistakeSection
            aggregates={aggregates}
            topicGaps={topicGaps}
            coachInsights={coachInsights}
            recoveryCount={recoveryCount}
            priorityTarget={topGap ? `${topGap.topic} (${topGap.chapter})` : null}
          />
          {topicGaps.length > 0 && <TopicDeepCards topics={topicGaps} />}
          {aggregates.length > 0 && <MistakeTopicTable aggregates={aggregates} />}
          {weeklyPlan.length > 0 && <WeeklyStudyPlan plan={weeklyPlan} />}
        </>
      )}

      {section === "performance" && (
        <>
          <PerformanceSection
            data={data}
            charts={charts}
            sessions={pageData?.recent_sessions ?? []}
            accuracy={accuracy}
            rank={rank}
            classSize={pageData?.class_size ?? 0}
            improvement={improvement}
          />
          <AnalysisClassStanding
            rank={rank}
            classSize={pageData?.class_size ?? 0}
            topPeers={pageData?.leaderboard_top ?? []}
            currentUserId={user?.id}
          />
          {!pageLoading && <SessionLog sessions={pageData?.recent_sessions ?? []} />}
        </>
      )}

      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Button variant="outline" size="sm" className="rounded-lg border-[var(--wa-outline-variant)]" asChild>
          <Link to="/student/practice/math12">Practice</Link>
        </Button>
        <Button size="sm" className="rounded-lg bg-[var(--wa-primary)] hover:bg-[var(--wa-primary-container)]" asChild>
          <Link to="/student/recovery">Recovery</Link>
        </Button>
      </div>
    </div>
  );
}
