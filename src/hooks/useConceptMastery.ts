import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";

export type ConceptMasteryItem = {
  subject: string;
  chapter?: string;
  concept: string;
  subconcept?: string;
  mastery_score: number;
  total_attempts: number;
  correct_attempts: number;
  recovery_attempts: number;
  mistake_count: number;
  last_attempt_at?: string;
};

export function useConceptMastery(enabled = true) {
  const [items, setItems] = useState<ConceptMasteryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const liveVersion = useAcademicLive(["xp", "profile"]);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = async () => {
    beginLoading(setLoading);
    setError(null);
    const { data, error: err } = await (supabase as any).rpc("rpc_student_concept_mastery");
    if (err) setError(err.message);
    else setItems((data?.items as ConceptMasteryItem[]) ?? []);
    endLoading(setLoading);
  };

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, liveVersion]);

  return { items, loading: showLoading(loading), error, reload };
}