import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { supabase } from "@/integrations/supabase/client";

export type AcademicSnapshot = {
  student?: { id: string; full_name: string; roll_number?: string; admission_number?: string } | null;
  /** Raw student_xp via to_jsonb. Prefer study_streak for product streak UI; current_streak/win_streak are battle. */
  xp?: {
    xp: number;
    level: number;
    study_streak?: number;
    current_streak?: number;
    win_streak?: number;
    wins?: number;
    total_battles?: number;
  } | null;
  homework?: { pending: number; completed: number };
  test?: { open: number; completed: number };
  /**
   * From _weak_topics_for_user, filtered to is_weak. `attempts` is the count
   * the SERVER measured for that topic — the client must not re-derive it by
   * matching the topic name against session chapters, which is what
   * practiceCountForTopic did back when a "topic" was a chapter.
   */
  weak_topics?: {
    subject: string; chapter?: string; topic?: string; accuracy: number;
    attempts?: number; correct?: number; thin?: boolean;
  }[];
  /**
   * Chapters whose §5.3 revision date has arrived, from chapter_state — the
   * same source the Revision screen reads.
   *
   * It replaced `revision_queue`, which served up to ten rows of the AI
   * layer's weak-TOPIC worklist. Nothing ever read those rows; Dashboard and
   * LearningHub both took `.length`, and that length disagreed with the
   * Revision screen next to it because the two counted different things.
   */
  revision_due?: number;
  mistake_count?: number;
  /**
   * Chapters at RECOVERY_TRIGGER_COUNT open mistakes — what Recovery calls
   * `ready`. Was a count of open recovery_assignments rows until
   * 20260926000000 dropped that engine.
   */
  recovery_pending?: number;
  weak_concepts?: { subject: string; concept: string; mastery_score: number }[];
  self_practice?: { sessions_completed: number };
  activity_heatmap?: { date: string; test: number; homework: number; battles: number; self_practice?: number; minutes: number }[];
  exam_readiness?: {
    score: number;
    label: string;
    tone: string;
    attendance_pct?: number;
    /** Blended Test + practice accuracy. NOT practice accuracy on its own. */
    accuracy_pct?: number;
    /** Practice-only accuracy, straight from question_attempts. */
    practice_accuracy_pct?: number;
    test_completion_pct?: number;
    active_days_14d?: number;
  };
};

export function useStudentAcademicSnapshot(enabled = true) {
  const liveVersion = useAcademicLive([
    "homework",
    "xp",
    "battle",
    "profile",
    "test",
    "marks",
    "achievements",
  ]);
  const [data, setData] = useState<AcademicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    beginLoading(setLoading);
    setError(null);
    const { data: snap, error: err } = await supabase.rpc("rpc_student_academic_snapshot");
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
    } else setData((snap as AcademicSnapshot) ?? null);
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
