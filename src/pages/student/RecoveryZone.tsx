import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchMostRecentPracticeMistake } from "@/lib/mistakeRecovery";
import {
  RecoveryHubPage,
  type FixedConcept,
  type HeatMapItem,
  type JourneyStage,
  type RecoveryPriority,
  type RecoveryTask,
} from "@/components/student/recovery/RecoveryHubPage";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { useAcademicBrain } from "@/hooks/useAcademicBrain";
import { StudentDashboardSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { toast } from "sonner";

const PLACEHOLDER_PRIORITIES: RecoveryPriority[] = [
  { rank: 1, concept: "Determinants", subject: "Mathematics", accuracy: 42, mastery: 38, questionsAssigned: 12 },
  { rank: 2, concept: "Inverse Matrix", subject: "Mathematics", accuracy: 48, mastery: 45, questionsAssigned: 10 },
  { rank: 3, concept: "Vector Algebra", subject: "Mathematics", accuracy: 55, mastery: 52, questionsAssigned: 8 },
];

const PLACEHOLDER_FIXED: FixedConcept[] = [
  { concept: "Matrices", subject: "Mathematics", improvement: "+18% mastery" },
  { concept: "Probability", subject: "Mathematics", improvement: "+14% mastery" },
  { concept: "Linear Programming", subject: "Mathematics", improvement: "+11% mastery" },
];

const PLACEHOLDER_HEAT: HeatMapItem[] = [
  { concept: "Probability", subject: "Mathematics", level: "strong", mastery: 88 },
  { concept: "Matrices", subject: "Mathematics", level: "strong", mastery: 82 },
  { concept: "Vector Algebra", subject: "Mathematics", level: "moderate", mastery: 58 },
  { concept: "Determinants", subject: "Mathematics", level: "critical", mastery: 38 },
  { concept: "Integration", subject: "Mathematics", level: "critical", mastery: 41 },
];

function masteryLevel(score: number): HeatMapItem["level"] {
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  return "critical";
}

export default function RecoveryZone() {
  const { data, loading, error, reload } = useRecoveryZone();
  const { brain, loading: brainLoading } = useAcademicBrain();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [hasPracticeMistakes, setHasPracticeMistakes] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [topicFixAttempted, setTopicFixAttempted] = useState(false);

  useEffect(() => {
    fetchMostRecentPracticeMistake().then((m) => setHasPracticeMistakes(!!m));
  }, [data?.open_assignments?.length]);

  useEffect(() => {
    if (topicFixAttempted || loading || searchParams.get("fix") !== "1") return;
    const subject = searchParams.get("subject");
    const concept = searchParams.get("concept");
    if (!subject || !concept) return;

    setTopicFixAttempted(true);
    setFixing(true);
    (async () => {
      try {
        const { data: aid, error: assignErr } = await (supabase as any).rpc("rpc_assign_concept_recovery", {
          _subject: subject,
          _chapter: searchParams.get("chapter") || null,
          _concept: concept,
          _subconcept: null,
          _accuracy: 35,
          _source_type: "analytics",
          _source_id: null,
        });
        if (assignErr) {
          toast.error(assignErr.message);
          return;
        }
        if (aid) navigate(`/student/recovery/${aid}`, { replace: true });
      } finally {
        setFixing(false);
      }
    })();
  }, [loading, navigate, searchParams, topicFixAttempted]);

  const handleFixMistakes = async () => {
    const assignments = data?.open_assignments ?? [];
    if (assignments[0]) {
      navigate(`/student/recovery/${assignments[0].id}`);
      return;
    }

    setFixing(true);
    try {
      const m = await fetchMostRecentPracticeMistake();
      if (!m) {
        toast.info("No practice mistakes yet — try Practice first.");
        return;
      }

      const { data: aid, error: assignErr } = await (supabase as any).rpc("rpc_assign_concept_recovery", {
        _subject: m.subject,
        _chapter: m.chapter ?? null,
        _concept: m.concept ?? m.topic ?? m.chapter ?? null,
        _subconcept: null,
        _accuracy: 35,
        _source_type: "practice",
        _source_id: m.id,
      });

      if (assignErr) {
        toast.error(assignErr.message);
        return;
      }
      if (aid) navigate(`/student/recovery/${aid}`);
    } finally {
      setFixing(false);
    }
  };

  const hubProps = useMemo(() => {
    const assignments = data?.open_assignments ?? [];
    const weak = data?.weak_concepts ?? [];
    const brainWeak = brain?.weak_concepts ?? [];
    const displayWeak = weak.length > 0 ? weak : brainWeak;
    const pending = data?.pending_count ?? (assignments.length > 0 ? assignments.reduce((s, a) => s + (a.question_count - a.questions_completed), 0) : 12);
    const recoveryPct = Math.round(brain?.recovery_completion_pct ?? 0);
    const trend = brain?.improvement_trend ?? "steady";

    const priorities: RecoveryPriority[] =
      displayWeak.length > 0
        ? displayWeak.slice(0, 3).map((w, i) => ({
            rank: i + 1,
            concept: w.concept,
            subject: w.subject,
            accuracy: Math.max(20, Math.round(100 - (w.mastery_score ?? 50))),
            mastery: Math.round(w.mastery_score ?? 40),
            questionsAssigned: assignments.find((a) => a.concept === w.concept)?.question_count ?? 10 - i * 2,
          }))
        : PLACEHOLDER_PRIORITIES;

    const tasks: RecoveryTask[] =
      assignments.length > 0
        ? assignments.map((a) => ({
            id: a.id,
            concept: a.concept,
            subject: a.subject,
            currentMastery: Math.round(((a.questions_completed / Math.max(1, a.question_count)) * 40) + 30),
            targetMastery: 80,
            questionsAssigned: a.question_count,
            estimatedImprovement: `+${Math.min(12, a.question_count)}% accuracy`,
          }))
        : priorities.map((p, i) => ({
            id: `placeholder-${i}`,
            concept: p.concept,
            subject: p.subject,
            currentMastery: p.mastery,
            targetMastery: 80,
            questionsAssigned: p.questionsAssigned,
            estimatedImprovement: "+5–8% accuracy",
          }));

    const mastery = data?.mastery ?? [];
    const fixedConcepts: FixedConcept[] =
      mastery.filter((m) => m.mastery_score >= 75).length > 0
        ? mastery
            .filter((m) => m.mastery_score >= 75)
            .slice(0, 3)
            .map((m) => ({
              concept: m.concept,
              subject: m.subject,
              improvement: `+${Math.round(m.mastery_score - 60)}% mastery`,
            }))
        : PLACEHOLDER_FIXED;

    const heatMap: HeatMapItem[] =
      displayWeak.length > 0 || mastery.length > 0
        ? [
            ...mastery.slice(0, 3).map((m) => ({
              concept: m.concept,
              subject: m.subject,
              level: masteryLevel(m.mastery_score),
              mastery: Math.round(m.mastery_score),
            })),
            ...displayWeak.slice(0, 4).map((w) => ({
              concept: w.concept,
              subject: w.subject,
              level: masteryLevel(w.mastery_score ?? 40) as HeatMapItem["level"],
              mastery: Math.round(w.mastery_score ?? 40),
            })),
          ].slice(0, 8)
        : PLACEHOLDER_HEAT;

    const journey: JourneyStage[] = [
      { id: "detected", label: "Weakness detected", done: displayWeak.length > 0, active: displayWeak.length > 0 && assignments.length === 0 },
      { id: "assigned", label: "Recovery assigned", done: assignments.length > 0, active: assignments.length > 0 && recoveryPct < 100 },
      { id: "completed", label: "Recovery completed", done: recoveryPct >= 80, active: recoveryPct > 0 && recoveryPct < 80 },
      { id: "mastery", label: "Mastery improved", done: trend === "improving" && recoveryPct >= 80, active: recoveryPct >= 80 && trend !== "improving" },
    ];

    const topWeak = displayWeak[0]?.concept ?? "Determinants";
    const coachTitle = `Focus on ${topWeak} today`;
    const coachBody =
      displayWeak.length > 0
        ? `You frequently struggle with ${topWeak.toLowerCase()}-related questions. Completing today's recovery plan can significantly improve your ${displayWeak[0]?.subject ?? "mathematics"} performance.`
        : "You frequently struggle with determinant transformations. Completing today's recovery plan can significantly improve your mathematics performance.";

    const baseAccuracy = 78;
    const baseMastery = 72;

    return {
      pending,
      potentialImprovement: `+${Math.min(7, Math.max(3, displayWeak.length + 2))}%`,
      weakConcepts: displayWeak.map((w) => w.concept),
      priorities,
      tasks,
      fixedConcepts,
      journey,
      forecast: {
        accuracy: [baseAccuracy, Math.min(95, baseAccuracy + 7)] as [number, number],
        mastery: [baseMastery, Math.min(95, baseMastery + 9)] as [number, number],
      },
      heatMap,
      coachTitle,
      coachBody,
    };
  }, [brain, data]);

  if (loading || brainLoading) {
    return <StudentDashboardSkeleton />;
  }

  if (error) {
    return (
      <StudentErrorState title="Recovery Center unavailable" message={error} onRetry={reload} />
    );
  }

  return (
    <RecoveryHubPage
      {...hubProps}
      fixing={fixing}
      onFixMistakes={() => {
        if ((data?.open_assignments?.length ?? 0) > 0 || hasPracticeMistakes) void handleFixMistakes();
        else toast.info("No mistakes yet — complete a practice session first.");
      }}
      onStartRecovery={(id) => {
        if (id.startsWith("placeholder-")) {
          void handleFixMistakes();
          return;
        }
        navigate(`/student/recovery/${id}`);
      }}
    />
  );
}
