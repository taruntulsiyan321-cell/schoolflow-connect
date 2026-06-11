import { useEffect, useState } from "react";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import {
  loadAnalyticsInsights,
  type AnalyticsInsights,
  type MistakeConceptAggregate,
} from "@/lib/analyticsInsights";

export function useAnalyticsInsights(snapshot: AcademicSnapshot | null, enabled = true) {
  const { items: mastery, loading: masteryLoading } = useConceptMastery(enabled);
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null);
  const [aggregates, setAggregates] = useState<MistakeConceptAggregate[]>([]);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadAnalyticsInsights(
        snapshot,
        mastery,
        snapshot?.student?.full_name?.split(" ")[0],
      );
      setInsights(result.insights);
      setAggregates(result.aggregates);
      setMistakeCount(result.mistakeCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load insights");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled || masteryLoading) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, masteryLoading, snapshot?.mistake_count, mastery.length]);

  return {
    insights,
    aggregates,
    mistakeCount,
    loading: loading || masteryLoading,
    error,
    reload,
  };
}
