import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { buildRuleAnalyticsInsights, resolveTopicGaps } from "@/lib/analyticsInsights";
import {
  DiagnosisBanner,
  MistakeTopicTable,
  MomentumSection,
  RecurringErrorsSection,
  SessionLog,
  SubjectBreakdown,
  TopicDeepCards,
  WeeklyStudyPlan,
} from "@/components/student/analytics/AnalysisDeepSections";
import {
  FlowCoachCard,
  FlowConceptPanel,
  FlowConceptTag,
  FlowHero,
  FlowRecoveryCard,
  FlowSectionTitle,
  FlowStatGrid,
  FlowTrendCard,
} from "@/components/student/flow/FlowDesign";
import { CheckCircle2, Target } from "lucide-react";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

export function AnalyticsStudio({ data, charts }: Props) {
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery } = useConceptMastery();
  const { data: recovery, loading: recoveryLoading } = useRecoveryZone();
  const { insights, aggregates, enhancing, loading: insightsLoading } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const score = readiness?.score ?? 0;
  const xp = data.xp?.xp ?? 0;
  const rank = pageData?.class_rank;

  const ruleInsights =
    aggregates.length > 0 ? buildRuleAnalyticsInsights(aggregates, mastery, data) : null;
  const displayInsights = insights ?? ruleInsights;

  const topicGaps = resolveTopicGaps(displayInsights, aggregates);

  const strongConcepts = mastery
    .filter((m) => m.mastery_score >= 72 && m.mistake_count <= 1)
    .slice(0, 8);
  const weakConcepts = mastery
    .filter((m) => m.mastery_score < 62 || m.mistake_count >= 2)
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 8);

  const coachLines: string[] = [];
  if (displayInsights?.today_focus) coachLines.push(displayInsights.today_focus);
  for (const step of displayInsights?.next_steps?.slice(0, 2) ?? []) {
    if (!coachLines.includes(step)) coachLines.push(step);
  }
  for (const t of topicGaps.slice(0, 3)) {
    const line = `${t.topic}: ${t.fix_hint}`;
    if (coachLines.length < 6 && !coachLines.some((l) => l.includes(t.topic))) coachLines.push(line);
  }
  for (const s of displayInsights?.strong_concepts?.slice(0, 2) ?? []) {
    coachLines.push(`Strength — ${s.concept}: ${s.note}`);
  }
  if (coachLines.length === 0) {
    if (strongConcepts[0]) coachLines.push(`You perform well in ${strongConcepts[0].concept.toLowerCase()}.`);
    if (weakConcepts[0]) coachLines.push(`Focus next on ${weakConcepts[0].concept.toLowerCase()} — open Recovery after reading the breakdown below.`);
  }

  const recoveryCount = recovery?.pending_count ?? data.recovery_pending ?? data.mistake_count ?? 0;
  const weakTags = (
    recovery?.weak_concepts?.slice(0, 6).map((w) => w.concept) ??
    topicGaps.slice(0, 6).map((t) => t.topic) ??
    weakConcepts.map((c) => c.concept)
  ).slice(0, 6);

  const trend = pageData?.trend;
  const practiceTrend = charts?.practice_trend ?? [];
  const prevAcc = trend?.previous_accuracy ?? practiceTrend.at(-2)?.score_pct ?? null;
  const currAcc = trend?.current_accuracy ?? practiceTrend.at(-1)?.score_pct ?? readiness?.accuracy_pct ?? null;
  const improvement =
    trend?.improvement_pct ??
    (prevAcc != null && currAcc != null ? Math.round((currAcc - prevAcc) * 10) / 10 : null);

  const totals = pageData?.totals;
  const correct = totals?.correct ?? 0;
  const wrong = totals?.wrong ?? data.mistake_count ?? 0;
  const accuracy = totals?.accuracy_pct ?? readiness?.accuracy_pct ?? 0;
  const speed = totals?.avg_sec_per_question;
  const timeMin = totals?.last_session_minutes;

  const weeklyPlan = displayInsights?.weekly_plan ?? [];
  const momentum = displayInsights?.momentum ?? [];
  const heroSummary =
    displayInsights?.summary ??
    (aggregates.length > 0
      ? `${aggregates.reduce((s, a) => s + a.mistake_count, 0)} mistakes traced across ${aggregates.length} topics`
      : undefined);

  const initialLoad = insightsLoading && aggregates.length === 0 && !displayInsights;

  if (initialLoad) {
    return (
      <div className="space-y-6 animate-rise py-8 text-center text-sm text-muted-foreground">
        Loading your analysis…
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-rise">
      <FlowHero
        eyebrow="Deep analysis"
        title="How did you perform?"
        metrics={[
          { label: "Score", value: `${score}%` },
          { label: "Accuracy", value: `${readiness?.accuracy_pct ?? accuracy}%` },
          { label: "Time", value: timeMin != null ? `${timeMin}m` : "—" },
          { label: "Rank", value: rank ? `#${rank}` : "—" },
          { label: "XP", value: xp.toLocaleString() },
        ]}
        footer={
          heroSummary ? (
            <p className="text-sm text-primary-foreground/85 leading-relaxed">{heroSummary}</p>
          ) : undefined
        }
      />

      {displayInsights && <DiagnosisBanner insights={displayInsights} />}

      <section>
        <FlowSectionTitle>Performance overview</FlowSectionTitle>
        <FlowStatGrid
          items={[
            { label: "Correct", value: correct },
            { label: "Wrong", value: wrong },
            { label: "Accuracy", value: `${accuracy}%` },
            { label: "Speed", value: speed != null ? `${speed}s` : "—", sub: speed != null ? "per question" : undefined },
          ]}
        />
      </section>

      <SubjectBreakdown subjects={charts?.subjects ?? []} />

      <section>
        <FlowSectionTitle>What did you get wrong?</FlowSectionTitle>
        <div className="grid md:grid-cols-2 gap-4">
          <FlowConceptPanel
            title="Strong concepts"
            icon={<CheckCircle2 className="w-4 h-4" />}
            variant="strong"
            empty="Practice more to unlock strengths."
          >
            {strongConcepts.map((c) => (
              <FlowConceptTag
                key={`${c.subject}-${c.concept}`}
                label={c.concept}
                meta={`${Math.round(c.mastery_score)}% · ${c.subject}`}
                variant="strong"
              />
            ))}
            {strongConcepts.length === 0 &&
              (data.strong_topics ?? []).map((t, i) => (
                <FlowConceptTag
                  key={i}
                  label={t.topic ?? t.chapter ?? t.subject}
                  meta={`${Math.round(t.accuracy)}%`}
                  variant="strong"
                />
              ))}
          </FlowConceptPanel>

          <FlowConceptPanel
            title="Needs improvement"
            icon={<Target className="w-4 h-4" />}
            variant="weak"
            empty="No weak spots flagged yet."
          >
            {topicGaps.slice(0, 8).map((t) => (
              <FlowConceptTag
                key={`${t.subject}-${t.topic}`}
                label={t.topic}
                meta={`${t.chapter} · ${t.mistake_count} mistakes`}
                variant="weak"
              />
            ))}
            {topicGaps.length === 0 &&
              weakConcepts.map((c) => (
                <FlowConceptTag
                  key={`${c.subject}-${c.concept}`}
                  label={c.concept}
                  meta={`${c.mistake_count} mistakes`}
                  variant="weak"
                />
              ))}
          </FlowConceptPanel>
        </div>
      </section>

      {topicGaps.length > 0 && <TopicDeepCards topics={topicGaps} />}

      {aggregates.length > 0 && <MistakeTopicTable aggregates={aggregates} />}

      <FlowCoachCard
        loading={enhancing}
        lines={coachLines.slice(0, 6)}
        empty="Complete a practice session — your coach will highlight patterns from your mistakes."
      />

      {weeklyPlan.length > 0 && <WeeklyStudyPlan plan={weeklyPlan} />}

      {momentum.length > 0 && <MomentumSection signals={momentum} />}

      {displayInsights && (
        <RecurringErrorsSection
          errors={displayInsights.recurring_errors}
          patterns={displayInsights.error_patterns}
        />
      )}

      {!pageLoading && <SessionLog sessions={pageData?.recent_sessions ?? []} />}

      <FlowRecoveryCard count={recoveryLoading ? 0 : recoveryCount} weakConcepts={weakTags} />

      <FlowTrendCard previous={prevAcc} current={currAcc} improvement={improvement} />

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <Link to="/student/practice/math12">Start another session</Link>
        </Button>
      </div>
    </div>
  );
}
