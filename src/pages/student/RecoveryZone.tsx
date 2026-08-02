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
import { displayConcept } from "@/lib/academicDisplay";

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
          _accuracy: Math.round(
            data?.weak_concepts?.find((w) => w.concept === concept)?.mastery_score ??
              brain?.weak_concepts?.find((w) => w.concept === concept)?.mastery_score ??
              0,
          ),
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
        _accuracy: Math.round(
          data?.weak_concepts?.find(
            (w) => w.concept === (m.concept ?? m.topic ?? m.chapter),
          )?.mastery_score ?? 0,
        ),
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
    const pending =
      data?.pending_count ??
      (assignments.length > 0
        ? assignments.reduce((s, a) => s + (a.question_count - a.questions_completed), 0)
        : 0);
    const recoveryPct = Math.round(brain?.recovery_completion_pct ?? 0);
    const trend = brain?.improvement_trend ?? "steady";

    const priorities: RecoveryPriority[] =
      displayWeak.length > 0
        ? displayWeak.slice(0, 3).map((w, i) => ({
            rank: i + 1,
            concept: displayConcept(w.concept),
            subject: w.subject,
            accuracy: Math.round(w.mastery_score ?? 0), // Hub prop name; value is mastery_score
            mastery: Math.round(w.mastery_score ?? 0),
            questionsAssigned: assignments.find((a) => a.concept === w.concept)?.question_count ?? 0,
          }))
        : [];

    const tasks: RecoveryTask[] = assignments.map((a) => {
      const weak = displayWeak.find((w) => w.concept === a.concept);
      const masteryNow = Math.round(weak?.mastery_score ?? 0);
      const progressPct =
        a.question_count > 0
          ? Math.round((a.questions_completed / a.question_count) * 100)
          : 0;
      return {
        id: a.id,
        concept: displayConcept(a.concept),
        subject: a.subject,
        currentMastery: masteryNow,
        targetMastery: 80,
        questionsAssigned: a.question_count,
        estimatedImprovement:
          progressPct > 0 ? `${progressPct}% of drill complete` : `${a.question_count} Qs assigned`,
      };
    });

    const mastery = data?.mastery ?? [];
    const fixedConcepts: FixedConcept[] = mastery
      .filter((m) => m.mastery_score >= 75)
      .slice(0, 3)
      .map((m) => ({
        concept: displayConcept(m.concept),
        subject: m.subject,
        improvement: `${Math.round(m.mastery_score)}% mastery`,
      }));

    const heatMap: HeatMapItem[] =
      displayWeak.length > 0 || mastery.length > 0
        ? [
            ...mastery.slice(0, 3).map((m) => ({
              concept: displayConcept(m.concept),
              subject: m.subject,
              level: masteryLevel(m.mastery_score),
              mastery: Math.round(m.mastery_score),
            })),
            ...displayWeak.slice(0, 4).map((w) => ({
              concept: displayConcept(w.concept),
              subject: w.subject,
              level: masteryLevel(w.mastery_score ?? 40) as HeatMapItem["level"],
              mastery: Math.round(w.mastery_score ?? 40),
            })),
          ].slice(0, 8)
        : [];

    const journey: JourneyStage[] = [
      { id: "detected", label: "Weakness detected", done: displayWeak.length > 0, active: displayWeak.length > 0 && assignments.length === 0 },
      { id: "assigned", label: "Recovery assigned", done: assignments.length > 0, active: assignments.length > 0 && recoveryPct < 100 },
      { id: "completed", label: "Recovery completed", done: recoveryPct >= 80, active: recoveryPct > 0 && recoveryPct < 80 },
      { id: "mastery", label: "Mastery improved", done: trend === "improving" && recoveryPct >= 80, active: recoveryPct >= 80 && trend !== "improving" },
    ];

    const topWeak = displayWeak[0]?.concept;
    const topWeakLabel = topWeak ? displayConcept(topWeak) : null;
    const coachTitle = topWeakLabel ? `Focus on ${topWeakLabel} today` : "No recovery focus yet";
    const coachBody =
      displayWeak.length > 0
        ? `You frequently struggle with ${topWeakLabel!.toLowerCase()}-related questions. Completing today's recovery plan can improve your ${displayWeak[0]?.subject ?? "subject"} performance.`
        : "Complete practice sessions to surface weak concepts and recovery tasks.";

    const masteryScores = [
      ...(brain?.strong_concepts ?? []).map((c) => c.mastery_score),
      ...(brain?.weak_concepts ?? []).map((c) => c.mastery_score),
      ...mastery.map((m) => m.mastery_score),
    ].filter((n) => Number.isFinite(n));
    const masteryNow =
      masteryScores.length > 0
        ? Math.round(masteryScores.reduce((a, b) => a + b, 0) / masteryScores.length)
        : 0;

    return {
      pending,
      potentialImprovement: "—",
      weakConcepts: displayWeak.map((w) => w.concept),
      priorities,
      tasks,
      fixedConcepts,
      journey,
      forecast: {
        accuracy: [0, 0] as [number, number],
        mastery: [masteryNow, masteryNow] as [number, number],
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
        navigate(`/student/recovery/${id}`);
      }}
    />
  );
}
