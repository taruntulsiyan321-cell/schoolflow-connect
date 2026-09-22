import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { supabase } from "@/integrations/supabase/client";

export type SubjectChartPoint = { name: string; accuracy: number; attempts: number };
export type WeeklyActivityPoint = { date: string; total: number; test: number; battles: number; self_practice?: number };
export type TestTrendPoint = { date: string; score_pct: number };
export type PracticeTrendPoint = { date: string; score_pct: number; chapter?: string };

export type StudentPerformanceCharts = {
  subjects: SubjectChartPoint[];
  weekly_activity: WeeklyActivityPoint[];
  test_trend: TestTrendPoint[];
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
    if (err) {
      setError(err.message);
      // NULL, NOT THE PREVIOUS ANSWER.
      //
      // This left `data` untouched on a failure, so a refresh that failed
      // kept rendering the figures from the last successful load with
      // nothing to say they were stale — and after a student switch, the
      // previous student's. useStudentPracticeAnalytics already states the
      // rule in its own error branch: a panel that keeps showing old
      // figures is worse than one that says it has nothing. Two of the four
      // hooks behind this page obeyed it and two did not.
      setData(null);
    } else setData((charts as StudentPerformanceCharts) ?? null);
    endLoading(setLoading);
  }, [beginLoading, endLoading]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }
    void reload();
  }, [enabled, liveVersion, reload]);

  return { data, loading: enabled ? showLoading(loading) : false, error, reload };
}
