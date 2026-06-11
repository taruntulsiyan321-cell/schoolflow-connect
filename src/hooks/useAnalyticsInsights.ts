import { useCallback, useEffect, useRef, useState } from "react";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import {
  enhanceAnalyticsWithGemini,
  fetchMistakeAnalyticsBase,
  type AnalyticsInsights,
  type MistakeConceptAggregate,
} from "@/lib/analyticsInsights";

export function useAnalyticsInsights(snapshot: AcademicSnapshot | null, enabled = true) {
  const { items: mastery, loading: masteryLoading } = useConceptMastery(enabled);
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null);
  const [aggregates, setAggregates] = useState<MistakeConceptAggregate[]>([]);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enhanceKeyRef = useRef<string>("");
  const masteryRef = useRef(mastery);
  masteryRef.current = mastery;

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    enhanceKeyRef.current = "";

    try {
      const currentMastery = masteryRef.current;
      const base = await fetchMistakeAnalyticsBase(snapshot, currentMastery);
      setAggregates(base.aggregates);
      setMistakeCount(base.mistakeCount);
      setInsights(base.insights);
      setLoading(false);

      if (base.mistakeCount === 0) return;

      const enhanceKey = `${base.mistakeCount}:${snapshot?.mistake_count ?? 0}:${currentMastery.length}`;
      if (enhanceKeyRef.current === enhanceKey) return;
      enhanceKeyRef.current = enhanceKey;

      setEnhancing(true);
      const enhanced = await enhanceAnalyticsWithGemini(
        snapshot,
        currentMastery,
        base.mistakes,
        base.aggregates,
        base.insights,
        snapshot?.student?.full_name?.split(" ")[0],
      );
      setInsights(enhanced);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load insights");
      setLoading(false);
    } finally {
      setEnhancing(false);
    }
  }, [enabled, snapshot?.mistake_count, snapshot?.student?.full_name]);

  useEffect(() => {
    if (!enabled || masteryLoading) return;
    reload();
  }, [enabled, masteryLoading, snapshot?.mistake_count, reload]);

  return {
    insights,
    aggregates,
    mistakeCount,
    loading: loading || (enabled && masteryLoading && !insights),
    enhancing,
    error,
    reload,
  };
}
