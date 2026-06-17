import { useCallback, useEffect, useRef, useState } from "react";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import {
  enhanceAnalyticsWithGemini,
  fetchMistakeAnalyticsBase,
  type AnalyticsInsights,
  type MistakeTopicAggregate,
} from "@/lib/analyticsInsights";

export function useAnalyticsInsights(snapshot: AcademicSnapshot | null, enabled = true) {
  const { items: mastery, loading: masteryLoading } = useConceptMastery(enabled);
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null);
  const [aggregates, setAggregates] = useState<MistakeTopicAggregate[]>([]);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const masteryRef = useRef(mastery);
  masteryRef.current = mastery;

  const reload = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const currentMastery = masteryRef.current;
      const base = await fetchMistakeAnalyticsBase(snapshot, currentMastery);
      if (requestId !== requestIdRef.current) return;

      setAggregates(base.aggregates);
      setMistakeCount(base.mistakeCount);

      if (base.mistakeCount === 0) {
        setInsights(base.insights);
        setLoading(false);
        setEnhancing(false);
        return;
      }

      setInsights(base.insights);
      setEnhancing(true);
      setLoading(false);

      try {
        const enhanced = await enhanceAnalyticsWithGemini(
          snapshot,
          currentMastery,
          base.mistakes,
          base.aggregates,
          base.insights,
          snapshot?.student?.full_name?.split(" ")[0],
        );
        if (requestId !== requestIdRef.current) return;
        setInsights(enhanced);
      } catch (e) {
        console.warn("Coach enhancement failed:", e);
      }
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Could not load insights");
      setLoading(false);
    } finally {
      if (requestId === requestIdRef.current) {
        setEnhancing(false);
        setLoading(false);
      }
    }
  }, [enabled, snapshot?.mistake_count, snapshot?.student?.full_name, snapshot?.exam_readiness?.accuracy_pct]);

  useEffect(() => {
    if (!enabled || masteryLoading) return;
    reload();
  }, [enabled, masteryLoading, snapshot?.mistake_count, reload]);

  const coachLive = insights?.source === "gemini";

  return {
    insights,
    aggregates,
    mistakeCount,
    loading: loading || (enabled && masteryLoading && !insights),
    enhancing,
    coachLive,
    error,
    reload,
  };
}
