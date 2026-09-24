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


/**
 * THE BOUNDARY, and it is validated rather than cast.
 *
 * `setData({ ...EMPTY, ...(rows as Partial<StudentPracticeAnalytics>) })` is
 * a promise to TypeScript, not a check. The payload is JSON built by a
 * database function, and the two can drift: a rolled-back migration, an
 * older function still live on another project, a cached edge response.
 *
 * The specific failure that matters. Every verdict on the Analysis page is
 * gated on `answered` and `timed`. If a row arrives without them, they read
 * `undefined`, mayBeJudged() is false for every row, and the page tells a
 * student with four hundred answered questions that it does not have enough
 * data yet — quietly, with no error, looking exactly like a new account.
 * Failing safe is right; failing SILENTLY is not, because "you have not
 * practised enough" and "we could not read your practice" are different
 * sentences and only one of them is true.
 *
 * So a row missing its denominators is a contract violation and surfaces as
 * an error. Everything else is coerced: a numeric string becomes a number, a
 * missing count becomes 0, and a rate that is absent stays null rather than
 * collapsing to zero.
 */
const CONTRACT_ERROR =
  "Analysis could not read your practice data — it arrived in an unexpected shape.";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Null survives as null: an absent rate is not a rate of zero. */
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

/**
 * Every grouped row must carry the denominators its figures are judged on.
 *
 * PRESENT, not merely coercible. `Number(null)` is 0 and 0 is finite, so a
 * row with `timed: null` would have passed a Number.isFinite check and then
 * gated every verdict on a zero it never measured.
 */
function isCount(v: unknown): boolean {
  return v != null && v !== "" && Number.isFinite(Number(v));
}

function hasDenominators(r: Record<string, unknown>): boolean {
  return isCount(r.attempts) && isCount(r.answered) && isCount(r.timed);
}

function rowsOf(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : [];
}

function parseAnalytics(payload: unknown): { data: StudentPracticeAnalytics; ok: boolean } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const groups = [p.by_subject, p.by_topic, p.by_chapter, p.by_difficulty];
  const ok = groups.every((g) => rowsOf(g).every(hasDenominators));

  const base = (r: Record<string, unknown>) => ({
    attempts: num(r.attempts),
    answered: num(r.answered),
    timed: num(r.timed),
    correct: num(r.correct),
    skipped: num(r.skipped),
    accuracy: numOrNull(r.accuracy),
    avg_sec: numOrNull(r.avg_sec),
  });

  return {
    ok,
    data: {
      by_subject: rowsOf(p.by_subject).map((r) => ({
        subject: str(r.subject),
        ...base(r),
        total_min: numOrNull(r.total_min),
      })),
      by_topic: rowsOf(p.by_topic).map((r) => ({
        topic: str(r.topic),
        subject: strOrNull(r.subject),
        chapter: strOrNull(r.chapter),
        ...base(r),
        total_min: numOrNull(r.total_min),
      })),
      by_chapter: rowsOf(p.by_chapter).map((r) => ({
        chapter: str(r.chapter),
        subject: strOrNull(r.subject),
        ...base(r),
        total_min: numOrNull(r.total_min),
      })),
      by_difficulty: rowsOf(p.by_difficulty).map((r) => ({
        difficulty: str(r.difficulty),
        ...base(r),
      })),
      effort:
        p.effort && typeof p.effort === "object"
          ? {
              attempts: num((p.effort as Record<string, unknown>).attempts),
              solution_viewed: num((p.effort as Record<string, unknown>).solution_viewed),
              repeat_attempts: num((p.effort as Record<string, unknown>).repeat_attempts),
              first_try_attempts: num((p.effort as Record<string, unknown>).first_try_attempts),
              first_try_correct: num((p.effort as Record<string, unknown>).first_try_correct),
            }
          : null,
      recurring: rowsOf(p.recurring).map((r) => ({
        topic: strOrNull(r.topic),
        chapter: strOrNull(r.chapter),
        subject: strOrNull(r.subject),
        times_wrong: num(r.times_wrong),
        last_wrong_at: strOrNull(r.last_wrong_at),
        question_text: strOrNull(r.question_text),
      })),
    },
  };
}

export { parseAnalytics, CONTRACT_ERROR };

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
      // NULL, not the previous answer and not EMPTY either. A panel that
      // keeps rendering the last student's figures after a failed refresh is
      // worse than one that says it has nothing — and EMPTY is not "nothing",
      // it is "no rows", which the page renders as a real count of zero
      // topics practised. Null is the absence.
      setData(null);
    } else {
      const { data: parsed, ok } = parseAnalytics(rows);
      if (!ok) {
        // NULL for the same reason as the branch above, and the comment
        // that stood here ("says so instead of looking like a student who
        // has never practised") was contradicted by the EMPTY beside it:
        // empty arrays are EXACTLY what a student who has never practised
        // looks like. The error is what says so; the data must not
        // simultaneously claim the student has no topics.
        setError(CONTRACT_ERROR);
        setData(null);
      } else {
        setData(parsed);
      }
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
