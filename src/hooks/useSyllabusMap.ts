import { useEffect, useState } from "react";
import type { SyllabusMap } from "@/academic/metrics/syllabusMap";
import { fetchSyllabusMap } from "@/lib/syllabusMap";
import { toErrorMessage } from "@/lib/presentation";

/**
 * The student's whole syllabus with their counts (rpc_student_syllabus_map),
 * for the map and for slipping topics. Like the page's other sources, a failed
 * read is an error and no map — never the last one kept.
 */
export function useSyllabusMap(enabled = true) {
  const [data, setData] = useState<SyllabusMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchSyllabusMap().then(
      (map) => {
        if (cancelled) return;
        setData(map);
        setError(null);
      },
      (e) => {
        if (cancelled) return;
        setError(toErrorMessage(e, "Could not read your syllabus"));
        setData(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { data, error };
}
