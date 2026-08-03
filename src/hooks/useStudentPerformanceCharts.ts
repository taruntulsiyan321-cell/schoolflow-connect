import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { supabase } from "@/integrations/supabase/client";

export type SubjectChartPoint = { name: string; accuracy: number; attempts: number };
export type WeeklyActivityPoint = { date: string; total: number; dpp: number; battles: number; self_practice?: number };
export type DppTrendPoint = { date: string; score_pct: number };
export type PracticeTrendPoint = { date: string; score_pct: number; chapter?: string };

export type StudentPerformanceCharts = {
  subjects: SubjectChartPoint[];
  weekly_activity: WeeklyActivityPoint[];
  dpp_trend: DppTrendPoint[];
  practice_trend?: PracticeTrendPoint[];
};

export function useStudentPerformanceCharts(enabled = true) {
  const liveVersion = useAcademicLive(["xp", "battle", "homework", "test", "marks", "profile"]);
  const [data, setData] = useState<StudentPerformanceCharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    beginLoading(setLoading);
    setError(null);
    const { data: charts, error: err } = await supabase.rpc("rpc_student_performance_charts");
    if (err) setError(err.message);
    else setData((charts as StudentPerformanceCharts) ?? null);
    endLoading(setLoading);
  }, [beginLoading, endLoading]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, liveVersion, reload]);

  return { data, loading: showLoading(loading), error, reload };
}
