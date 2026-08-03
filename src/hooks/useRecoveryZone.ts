import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { isGenericAcademicLabel } from "@/lib/qualityGuards";

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
  /** From recovery_assignments.source_type when available. */
  source_type?: string | null;
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

function hasUsableRecoveryLabels(item: {
  subject?: string | null;
  chapter?: string | null;
  concept?: string | null;
}): boolean {
  return (
    !isGenericAcademicLabel(item.subject) &&
    !isGenericAcademicLabel(item.concept) &&
    (!item.chapter || !isGenericAcademicLabel(item.chapter))
  );
}

export function useRecoveryZone(enabled = true) {
  const [data, setData] = useState<RecoveryZoneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const liveVersion = useAcademicLive(["profile", "xp"]);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = async () => {
    beginLoading(setLoading);
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
      const weak_concepts = (base.weak_concepts ?? []).filter(hasUsableRecoveryLabels);
      const mastery = (base.mastery ?? []).filter(hasUsableRecoveryLabels);
      let open_assignments = (base.open_assignments ?? []).filter(hasUsableRecoveryLabels);
      // RPC may omit source_type — enrich from table so source filters work.
      if (open_assignments.length > 0 && open_assignments.some((a) => !a.source_type)) {
        const { data: srcRows } = await supabase
          .from("recovery_assignments")
          .select("id, source_type")
          .in(
            "id",
            open_assignments.map((a) => a.id),
          );
        if (srcRows?.length) {
          const byId = new Map(srcRows.map((r) => [r.id, r.source_type as string | null]));
          open_assignments = open_assignments.map((a) => ({
            ...a,
            source_type: a.source_type ?? byId.get(a.id) ?? null,
          }));
        }
      }
      // Prefer RPC recent_completed when present; fallback client select if older RPC.
      const fromRpc = Array.isArray(base.recent_completed) ? base.recent_completed : null;
      const recent_completed: RecentCompletedRecovery[] =
        fromRpc && fromRpc.length > 0
          ? fromRpc.filter(hasUsableRecoveryLabels)
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
            })
            .filter(hasUsableRecoveryLabels);
      setData({
        ...base,
        weak_concepts,
        mastery,
        open_assignments,
        // Prefer server completed_count (full total), not truncated recent list length.
        completed_count:
          typeof base.completed_count === "number"
            ? base.completed_count
            : recent_completed.length,
        // Keep the visible count aligned with assignments that have usable academic labels.
        pending_count: open_assignments.length,
        recent_completed,
      });
    }
    endLoading(setLoading);
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }
    void reload();
  }, [enabled, liveVersion]);

  return { data, loading: enabled ? showLoading(loading) : false, error, reload };
}
