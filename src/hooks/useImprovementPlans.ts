import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ImprovementPlanRow = {
  subject: string;
  chapter?: string;
  topic?: string;
  accuracy: number;
  attempts: number;
  mistake_count: number;
  rule_plan: {
    headline?: string;
    steps?: string[];
    timeframe?: string;
    label?: string;
  };
  ai_plan?: {
    headline?: string;
    steps?: string[];
    resources?: string[];
    timeframe?: string;
  } | null;
};

export function useImprovementPlans(enabled = true) {
  const [plans, setPlans] = useState<ImprovementPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("rpc_student_improvement_plans");
    if (err) setError(err.message);
    else setPlans(((data as { plans?: ImprovementPlanRow[] })?.plans) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled]);

  return { plans, loading, error, reload };
}
