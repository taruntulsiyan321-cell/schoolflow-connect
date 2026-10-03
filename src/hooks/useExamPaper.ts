import { useEffect, useState } from "react";
import type { PaperShape } from "@/academic/metrics/examPaper";
import { fetchExamPaper } from "@/lib/examPaper";
import { toErrorMessage } from "@/lib/presentation";

/**
 * The CUET paper's shape (rpc_exam_paper, 20261144000000): what every pace and
 * readiness figure on the Analysis page is read against. Like the page's other
 * sources, a failed read is an error and no paper — never the last one kept.
 */
export function useExamPaper(enabled = true) {
  const [data, setData] = useState<PaperShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchExamPaper().then(
      (paper) => {
        if (cancelled) return;
        setData(paper);
        setError(null);
      },
      (e) => {
        if (cancelled) return;
        setError(toErrorMessage(e, "Could not read the paper"));
        setData(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { data, error };
}
