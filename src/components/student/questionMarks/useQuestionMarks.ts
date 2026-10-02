import { useCallback, useEffect, useState } from "react";
import { loadMarkTags, loadMyMarks, type MarkTag, type QuestionMark } from "@/lib/questionMarks";
import { toErrorMessage } from "@/lib/presentation";

/**
 * One screen's view of the student's marks: the tag catalogue and every mark,
 * read once, and replaced in place as the student marks, re-marks or unmarks.
 */
export function useQuestionMarks(userId: string | null | undefined) {
  const [tags, setTags] = useState<MarkTag[]>([]);
  const [marks, setMarks] = useState<Map<string, QuestionMark>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([loadMarkTags(), loadMyMarks(userId)])
      .then(([t, m]) => {
        if (cancelled) return;
        setTags(t);
        setMarks(m);
      })
      .catch((e) => {
        if (!cancelled) setError(toErrorMessage(e, "We couldn't load your marks."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  const setMark = useCallback((questionId: string, mark: QuestionMark | null) => {
    setMarks((prev) => {
      const next = new Map(prev);
      if (mark) next.set(questionId, mark);
      else next.delete(questionId);
      return next;
    });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { tags, marks, loading, error, setMark, retry };
}
