import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export type RecoveryZoneData = {
  pending_count: number;
  weak_concepts: WeakConcept[];
  mastery: { subject: string; chapter?: string; concept: string; mastery_score: number }[];
  open_assignments: RecoveryAssignment[];
};

export function useRecoveryZone(enabled = true) {
  const [data, setData] = useState<RecoveryZoneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: zone, error: err } = await (supabase as any).rpc("rpc_student_recovery_zone");
    if (err) setError(err.message);
    else setData((zone as RecoveryZoneData) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled]);

  return { data, loading, error, reload };
}
