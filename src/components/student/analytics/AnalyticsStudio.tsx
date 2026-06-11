import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { clipInsightText } from "@/lib/analyticsInsights";
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
import { Loader2 } from "lucide-react";
import { CheckCircle2, Target } from "lucide-react";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

export function AnalyticsStudio({ data, charts }: Props) {
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery, loading: masteryLoading } = useConceptMastery();
  const { data: recovery, loading: recoveryLoading } = useRecoveryZone();
  const { insights, enhancing, loading: insightsLoading } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const score = readiness?.score ?? 0;
  const xp = data.xp?.xp ?? 0;
  const rank = pageData?.class_rank;

  const strongConcepts = mastery
    .filter((m) => m.mastery_score >= 72 && m.mistake_count <= 1)
    .slice(0, 6);
  const weakConcepts = mastery
    .filter((m) => m.mastery_score < 62 || m.mistake_count >= 2)
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 6);

  const weakInsight = insights?.weak_topics?.[0];
  const coachLines: string[] = [];
  const strongInsight = insights?.strong_concepts?.[0];
  if (strongInsight) coachLines.push(`You perform well in ${strongInsight.concept.toLowerCase()} questions.`);
  else if (strongConcepts[0]) coachLines.push(`You perform well in ${strongConcepts[0].concept.toLowerCase()}.`);
  if (weakInsight) coachLines.push(`You struggled with ${weakInsight.topic.toLowerCase()}.`);
  else if (weakConcepts[0]) coachLines.push(`Focus on ${weakConcepts[0].concept.toLowerCase()}.`);
  if (insights?.recurring_errors?.[0]) coachLines.push(clipInsightText(insights.recurring_errors[0].label, 72));
  else if (insights?.today_focus) coachLines.push(clipInsightText(insights.today_focus, 90));

  const recoveryCount = recovery?.pending_count ?? data.recovery_pending ?? data.mistake_count ?? 0;
  const weakTags = (
    recovery?.weak_concepts?.slice(0, 5).map((w) => w.concept) ??
    weakConcepts.map((c) => c.concept)
  ).slice(0, 5);

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

  const enriching = insightsLoading || enhancing || (pageLoading && !pageData);

  return (
    <div className="space-y-8 animate-rise">
      <FlowHero
        eyebrow="Session summary"
        title="How did you perform?"
        metrics={[
          { label: "Score", value: `${score}%` },
          { label: "Accuracy", value: `${readiness?.accuracy_pct ?? accuracy}%` },
          { label: "Time", value: timeMin != null ? `${timeMin}m` : "—" },
          { label: "Rank", value: rank ? `#${rank}` : "—" },
          { label: "XP", value: xp.toLocaleString() },
        ]}
      />

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
            {weakInsight && (
              <FlowConceptTag label={weakInsight.topic} meta={weakInsight.chapter} variant="weak" />
            )}
            {weakConcepts.map((c) => (
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

      {enriching ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Building personalised coach tips…
        </div>
      ) : (
        <FlowCoachCard
          lines={coachLines}
          empty="Complete a practice session — your coach will highlight patterns from your mistakes."
        />
      )}

      <FlowRecoveryCard
        count={recoveryLoading ? 0 : recoveryCount}
        weakConcepts={weakTags}
      />

      <FlowTrendCard previous={prevAcc} current={currAcc} improvement={improvement} />

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <Link to="/student/practice/math12">Start another session</Link>
        </Button>
      </div>
    </div>
  );
}
