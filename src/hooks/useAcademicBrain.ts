import { useCallback, useEffect, useState } from "react";
import { fetchAcademicBrain, refreshAcademicBrain, type AcademicBrain } from "@/lib/academicBrain";

export function useAcademicBrain(enabled = true) {
  const [brain, setBrain] = useState<AcademicBrain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (force = false) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = force ? await refreshAcademicBrain() : await fetchAcademicBrain();
      setBrain(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load academic profile");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { brain, loading, error, reload };
}
