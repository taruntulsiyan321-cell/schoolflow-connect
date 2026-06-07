import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SubjectChartPoint = { name: string; accuracy: number; attempts: number };
export type WeeklyActivityPoint = { date: string; total: number; dpp: number; battles: number };
export type DppTrendPoint = { date: string; score_pct: number };

export type StudentPerformanceCharts = {
  subjects: SubjectChartPoint[];
  weekly_activity: WeeklyActivityPoint[];
  dpp_trend: DppTrendPoint[];
};

export function useStudentPerformanceCharts(enabled = true) {
  const [data, setData] = useState<StudentPerformanceCharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: charts, error: err } = await supabase.rpc("rpc_student_performance_charts");
    if (err) setError(err.message);
    else setData((charts as StudentPerformanceCharts) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled]);

  return { data, loading, error, reload };
}
