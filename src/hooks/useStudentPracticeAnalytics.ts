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
 * EVERY ROW CARRIES THE DENOMINATOR OF EVERY FIGURE IT REPORTS, because they
 * are not the same number and the screen must refuse a verdict the data
 * cannot support (MIN_OBSERVATIONS_FOR_VERDICT):
 *
 *   attempts   every attempt — how much contact the student has had
 *   answered   attempts that were not skipped — the ACCURACY denominator
 *   timed      attempts with a recorded duration — the AVG_SEC denominator
 *
 * Carrying only `attempts` is what produced "Circles · Needs attention · 8
 * Attempts · 0% Accuracy" for a chapter with 7 skips and ONE wrong answer,
 * and it let a single 579-second reading — a tab left open, not a hard topic
 * — rank as the slowest topic on the page.
 */
export type TopicAnalyticsRow = {
  topic: string;
  subject: string | null;
  chapter: string | null;
  attempts: number;
  /** Attempts that were not skipped. The accuracy denominator. */
  answered: number;
  /** Attempts with a recorded duration. The avg_sec denominator. */
  timed: number;
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
  /** Attempts that were not skipped. The accuracy denominator. */
  answered: number;
  /** Attempts with a recorded duration. The avg_sec denominator. */
  timed: number;
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
  /** Attempts that were not skipped. The accuracy denominator. */
  answered: number;
  /** Attempts with a recorded duration. The avg_sec denominator. */
  timed: number;
  correct: number;
  skipped: number;
  accuracy: number | null;
  avg_sec: number | null;
  total_min: number | null;
};

export type DifficultyAnalyticsRow = {
  difficulty: string;
  attempts: number;
  /** Attempts that were not skipped. The accuracy denominator. */
  answered: number;
  /** Attempts with a recorded duration. The avg_sec denominator. */
  timed: number;
  correct: number;
  skipped: number;
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
    const { data: rows, error: err } = await supabase.rpc("rpc_student_practice_analytics");
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
