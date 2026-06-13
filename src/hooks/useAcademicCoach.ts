import { useCallback, useEffect, useRef, useState } from "react";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import {
  runAcademicIntelligencePipeline,
  type AcademicIntelligenceBundle,
  type CoachReport,
} from "@/lib/academicAgents";
import {
  buildRuleAnalyticsInsights,
  fetchMistakeAnalyticsBase,
  type AnalyticsInsights,
  type MistakeTopicAggregate,
} from "@/lib/analyticsInsights";
import { useConceptMastery } from "@/hooks/useConceptMastery";

export function useAcademicCoach(snapshot: AcademicSnapshot | null, enabled = true) {
  const { items: mastery, loading: masteryLoading } = useConceptMastery(enabled);
  const [bundle, setBundle] = useState<AcademicIntelligenceBundle | null>(null);
  const [ruleInsights, setRuleInsights] = useState<AnalyticsInsights | null>(null);
  const [aggregates, setAggregates] = useState<MistakeTopicAggregate[]>([]);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const base = await fetchMistakeAnalyticsBase(snapshot, mastery);
      if (requestId !== requestIdRef.current) return;
      setAggregates(base.aggregates);
      setMistakeCount(base.mistakeCount);
      setRuleInsights(base.insights);
      setLoading(false);
      setEnhancing(true);

      const displayName = snapshot?.student?.full_name?.split(" ")[0];
      const pipeline = await runAcademicIntelligencePipeline(displayName);
      if (requestId !== requestIdRef.current) return;
      setBundle(pipeline);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Could not load coach insights");
    } finally {
      if (requestId === requestIdRef.current) {
        setEnhancing(false);
        setLoading(false);
      }
    }
  }, [enabled, snapshot?.student?.full_name, snapshot?.mistake_count, mastery]);

  useEffect(() => {
    if (!enabled || masteryLoading) return;
    reload();
  }, [enabled, masteryLoading, snapshot?.mistake_count, reload]);

  const coachReport: CoachReport | null = bundle?.coachReport ?? null;
  const coachLive = coachReport?.source === "coach";

  const insights: AnalyticsInsights | null = coachReport
    ? mergeCoachIntoInsights(ruleInsights, coachReport, bundle)
    : ruleInsights;

  return {
    bundle,
    insights,
    ruleInsights,
    aggregates,
    mistakeCount,
    coachReport,
    loading: loading || (enabled && masteryLoading && !bundle),
    enhancing,
    coachLive,
    error,
    reload,
  };
}

function mergeCoachIntoInsights(
  rule: AnalyticsInsights | null,
  coach: CoachReport,
  bundle: AcademicIntelligenceBundle | null,
): AnalyticsInsights {
  const fallback = rule ?? buildRuleAnalyticsInsights([], [], null);
  const recovery = bundle?.recoveryPlan;
  const revision = bundle?.revisionPlan;
  const patterns = bundle?.learningPatterns;

  return {
    ...fallback,
    headline: coach.headline || fallback.headline,
    summary: coach.summary || fallback.summary,
    diagnosis: coach.diagnosis || fallback.diagnosis,
    today_focus: coach.today_focus || fallback.today_focus,
    next_steps: coach.next_steps?.length ? coach.next_steps : fallback.next_steps,
    error_patterns: patterns?.patterns?.map((p) => p.label) ?? fallback.error_patterns,
    weekly_plan: revision?.today_plan?.map((p, i) => ({
      topic: p.topic,
      chapter: p.chapter ?? "",
      subject: p.subject,
      time_minutes: p.time_minutes,
      action: p.action,
      priority: p.priority ?? i + 1,
    })) ?? fallback.weekly_plan,
    study_priority: revision?.today_plan?.map(
      (p, i) => `${i + 1}. ${p.topic} (${p.subject}) — ~${p.time_minutes} min`,
    ) ?? fallback.study_priority,
    weak_topics: recovery?.plan?.map((p) => ({
      topic: p.concept,
      chapter: p.chapter ?? "",
      subject: p.subject,
      severity: p.priority >= 80 ? "critical" as const : p.priority >= 60 ? "moderate" as const : "mild" as const,
      why_weak: p.rationale,
      root_cause: p.rationale,
      fix_hint: `Practice ${p.question_count} questions in Recovery.`,
      mistake_count: p.question_count,
    })) ?? fallback.weak_topics,
    weak_concepts: recovery?.plan?.map((p) => ({
      topic: p.concept,
      chapter: p.chapter ?? "",
      subject: p.subject,
      severity: p.priority >= 80 ? "critical" as const : "moderate" as const,
      why_weak: p.rationale,
      root_cause: p.rationale,
      fix_hint: `Practice ${p.question_count} questions.`,
      mistake_count: p.question_count,
    })) ?? fallback.weak_concepts,
    source: coach.source === "coach" ? "gemini" : "rule",
  };
}
