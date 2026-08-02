import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAcademicLive } from "@/academic";

export type RecoveryAssignment = {
  id: string;
  subject: string;
  chapter?: string;
  concept: string;
  severity: string;
  status: string;
  question_count: number;
  questions_completed: number;
  created_at: string;
};

export type WeakConcept = {
  subject: string;
  chapter?: string;
  concept: string;
  subconcept?: string;
  mastery_score: number;
  mistake_count?: number;
};

export type RecentCompletedRecovery = {
  id: string;
  concept: string;
  subject: string;
  date: string;
  score: number;
  improved: boolean;
};

export type RecoveryZoneData = {
  pending_count: number;
  completed_count?: number;
  weak_concepts: WeakConcept[];
  mastery: { subject: string; chapter?: string; concept: string; mastery_score: number }[];
  open_assignments: RecoveryAssignment[];
  recent_completed?: RecentCompletedRecovery[];
};

export function useRecoveryZone(enabled = true) {
  const [data, setData] = useState<RecoveryZoneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const liveVersion = useAcademicLive(["profile", "xp"]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const [{ data: zone, error: err }, completedRes] = await Promise.all([
      (supabase as any).rpc("rpc_student_recovery_zone"),
      supabase
        .from("recovery_assignments")
        .select(
          "id, subject, concept, completed_at, question_count, questions_correct, questions_completed, status",
        )
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(12),
    ]);
    if (err) setError(err.message);
    else {
      const base = (zone as RecoveryZoneData) ?? {
        pending_count: 0,
        weak_concepts: [],
        mastery: [],
        open_assignments: [],
      };
      // Prefer RPC recent_completed when present; fallback client select if older RPC.
      const fromRpc = Array.isArray(base.recent_completed) ? base.recent_completed : null;
      const recent_completed: RecentCompletedRecovery[] =
        fromRpc && fromRpc.length > 0
          ? fromRpc
          : (completedRes.data ?? []).map((row) => {
              const qCount = row.question_count ?? 0;
              const correct = row.questions_correct ?? 0;
              const completed = row.questions_completed ?? 0;
              const denom = qCount > 0 ? qCount : completed;
              const score = denom > 0 ? Math.round((100 * correct) / denom) : 0;
              return {
                id: row.id,
                concept: row.concept,
                subject: row.subject,
                date: row.completed_at ?? "",
                score,
                improved: score >= 65,
              };
            });
      setData({
        ...base,
        // Prefer server completed_count (full total), not truncated recent list length.
        completed_count:
          typeof base.completed_count === "number"
            ? base.completed_count
            : recent_completed.length,
        recent_completed,
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled, liveVersion]);

  return { data, loading, error, reload };
}
