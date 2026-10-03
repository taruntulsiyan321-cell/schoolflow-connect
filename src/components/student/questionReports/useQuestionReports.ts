import { useCallback, useEffect, useMemo, useState } from "react";
import { isSettled, loadMyReports, type QuestionReport } from "@/lib/questionReports";

/** While a report waits, the screen looks again this often — the check takes a minute or two. */
export const REPORT_REFRESH_MS = 30_000;

/**
 * One screen's view of the student's reports on the questions it shows, read
 * once, replaced in place as the student reports, and read again while any of
 * them is still being checked. A failed read leaves the reports as they were:
 * the report control still works, it just starts from nothing.
 */
export function useQuestionReports(userId: string | null | undefined, questionIds: ReadonlyArray<string>) {
  const [reports, setReports] = useState<Map<string, QuestionReport>>(new Map());
  const key = useMemo(() => [...new Set(questionIds)].filter(Boolean).sort().join(","), [questionIds]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId || !key) return;
    let cancelled = false;
    loadMyReports(userId, key.split(","))
      .then((m) => { if (!cancelled) setReports(m); })
      .catch(() => { /* keep what is shown */ });
    return () => { cancelled = true; };
  }, [userId, key, tick]);

  const waiting = useMemo(() => [...reports.values()].some((r) => !isSettled(r.status)), [reports]);
  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), REPORT_REFRESH_MS);
    return () => window.clearTimeout(t);
  }, [waiting, tick]);

  const setReport = useCallback((report: QuestionReport) => {
    setReports((prev) => new Map(prev).set(report.questionId, report));
  }, []);

  return { reports, setReport };
}
