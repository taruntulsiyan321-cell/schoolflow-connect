import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ParentAlert = {
  id: string;
  kind: "weakness" | "consistency" | "improvement" | "participation";
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export type ParentDigestChild = {
  student_id: string;
  name: string;
  class: string;
  snapshot: Record<string, unknown>;
  alerts: ParentAlert[];
};

export type ParentWeeklyDigest = {
  children: ParentDigestChild[];
  generated_at: string;
};

export function useParentWeeklyDigest(enabled = true) {
  const [data, setData] = useState<ParentWeeklyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: digest, error: err } = await supabase.rpc("rpc_parent_weekly_digest");
    if (err) setError(err.message);
    else setData((digest as ParentWeeklyDigest) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled]);

  return { data, loading, error, reload };
}
