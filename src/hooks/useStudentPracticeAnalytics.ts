import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-topic, per-chapter and per-difficulty analytics, aggregated from
 * question_attempts by rpc_student_practice_analytics.
 *
 * WHY THIS EXISTS. Analysis had one aggregate source for chapters —
 * concept_mastery — and the codebase already documented it as having DRIFTED
 * from the attempts it is derived from (measured: 200 attempts recorded
 * against 120 that exist). Topic-level time, accuracy by difficulty, how often
 * a student reaches for the solution, and whether they get a question right
 * first time were all written on every attempt and read by nothing.
 *
 * Every row carries `attempts` so the screen can refuse to report a rate or a
 * pace that one answer would decide (MIN_ATTEMPTS_FOR_ACCURACY). That is not
 * optional here: measured 2026-09-18, the slowest "topic" by raw average was a
 * single attempt of 579 seconds — a tab left open, not a hard topic.
 */
export type TopicAnalyticsRow = {
  topic: string;
  subject: string | null;
  chapter: string | null;
  attempts: number;
  correct: number;
  skipped: number;
  /** correct / answered. Null when nothing was answered — never 0. */
  accuracy: number | null;
  /** Mean seconds per attempt, over the attempts that were timed. */
  avg_sec: number | null;
  total_min: number | null;
};

export type SubjectAnalyticsRow = {
  subject: string;
  attempts: number;
  correct: number;
  skipped: number;
  accuracy: number | null;
  avg_sec: number | null;
  total_min: number | null;
};

export type ChapterAnalyticsRow = {
  chapter: string;
  subject: string | null;
  attempts: number;
  correct: number;
  skipped: number;
  accuracy: number | null;
  avg_sec: number | null;
  total_min: number | null;
};

export type DifficultyAnalyticsRow = {
  difficulty: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
  avg_sec: number | null;
};

export type EffortAnalytics = {
  attempts: number;
  solution_viewed: number;
  repeat_attempts: number;
  first_try_attempts: number;
  first_try_correct: number;
};

export type RecurringMistakeRow = {
  topic: string | null;
  chapter: string | null;
  subject: string | null;
  times_wrong: number;
  last_wrong_at: string | null;
  question_text: string | null;
};

export type StudentPracticeAnalytics = {
  /**
   * Every subject this student has attempted a question in, most first.
   *
   * NOT rpc_student_performance_charts.subjects, which aggregates
   * _weak_topics_for_user and therefore only sees subjects whose attempts
   * resolve to a topic in the bank. Measured 2026-09-18: a student with
   * attempts in six subjects had ONE on the Subjects tab, and the radar — a
   * chart that exists to compare subjects — was drawing a single point.
   */
  by_subject: SubjectAnalyticsRow[];
  /** Slowest first — the question "which topic takes me longest" leads. */
  by_topic: TopicAnalyticsRow[];
  /** Weakest first, so a cap cannot drop the chapters that matter. */
  by_chapter: ChapterAnalyticsRow[];
  /** easy, medium, hard, in that order: the SHAPE is the reading. */
  by_difficulty: DifficultyAnalyticsRow[];
  effort: EffortAnalytics | null;
  recurring: RecurringMistakeRow[];
};

const EMPTY: StudentPracticeAnalytics = {
  by_subject: [],
  by_topic: [],
  by_chapter: [],
  by_difficulty: [],
  effort: null,
  recurring: [],
};

export function useStudentPracticeAnalytics(enabled = true) {
  const liveVersion = useAcademicLive(["xp", "profile"]);
  const [data, setData] = useState<StudentPracticeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    beginLoading(setLoading);
    setError(null);
    // WHY THIS CALL IS NOT TYPED BY THE GENERATED TYPES.
    //
    // src/integrations/supabase/types.ts does not know this function, and the
    // reason is worth writing down rather than papering over: that file is
    // STALE. Regenerated against production on 2026-09-18 it gains 41 live
    // functions — rpc_submit_revision_session, rpc_student_chapter_states,
    // rpc_revision_session_plan and the rest of the current recovery engine —
    // and loses 14 retired ones (rpc_student_recovery_zone,
    // rpc_complete_recovery_assignment, rpc_submit_recovery_answer …).
    //
    // Regenerating it is the right fix and it is NOT this change: it surfaces
    // 15 pre-existing type errors in homeworkService, homeworkRepository,
    // questionPaperService, questionBankService and FrictionlessChallenge —
    // real schema drift the stale file has been masking. Fixing homework and
    // question papers inside an Analysis change is the mixing that makes a
    // diff unreviewable.
    //
    // So the gap is narrowed to one call with one named shape, rather than
    // spread as `as any` or hidden by regenerating and leaving the build red.
    // Cast the CLIENT, not the method. `const rpc = supabase.rpc` detaches it
    // from its receiver and the call dies on `Cannot read properties of
    // undefined (reading 'rest')` — which renders Analysis as a header over an
    // empty page, and is how this was found: the live harness's self-check
    // refused to report an app it could not read.
    const client = supabase as unknown as {
      rpc: (
        fn: "rpc_student_practice_analytics",
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: rows, error: err } = await client.rpc("rpc_student_practice_analytics");
    if (err) {
      setError(err.message);
      // EMPTY, not the previous answer. A panel that keeps rendering the last
      // student's figures after a failed refresh is worse than one that says
      // it has nothing.
      setData(EMPTY);
    } else {
      setData({ ...EMPTY, ...((rows as Partial<StudentPracticeAnalytics>) ?? {}) });
    }
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
