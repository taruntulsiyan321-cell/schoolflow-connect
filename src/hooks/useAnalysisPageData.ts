import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ProgressionService, resolveStudentServiceContext, useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { toErrorMessage } from "@/lib/presentation";

export type PracticeSessionSummary = {
  id: string;
  subject: string;
  // CHUNK 10.7 — nullable: a session with no single chapter (Weak Areas,
  // Incorrect, Skipped, Bookmarked, Custom with no chapter chosen) is a real
  // state, not missing data.
  chapter: string | null;
  question_count: number;
  correct_count: number;
  score: number;
  created_at: string;
  // NOT nullable. Every PracticeSessionSummary is produced by sessionSummary
  // below, which only ever receives rows the query and the call-site filter
  // have already restricted to finished sessions. Widening this would have
  // been the wrong kind of honest: `new Date(null).getTime()` is 0 — the
  // epoch, not Invalid Date — so it pushed four sorts in
  // studentAnalysisMetrics into ordering unfinished sessions as though they
  // happened in 1970.
  finished_at: string;
  duration_minutes: number;
  accuracy_pct: number;
};

export type LeaderboardEntry = {
  user_id: string;
  full_name: string;
  roll_number: string | null;
  score: number;
  rank: number;
};

export type AnalysisPageData = {
  class_rank: number | null;
  leaderboard_top: LeaderboardEntry[];
  class_size: number;
  student_class: string | null;
  recent_sessions: PracticeSessionSummary[];
  totals: {
    correct: number;
    wrong: number;
    /** NULL when nothing has been attempted — never 0, which would read as
     *  "got everything wrong" for a student who has not started. */
    accuracy_pct: number | null;
    avg_sec_per_question: number | null;
    last_session_minutes: number | null;
  };
  trend: {
    previous_accuracy: number | null;
    current_accuracy: number | null;
    improvement_pct: number | null;
  };
};

function sessionSummary(row: {
  id: string;
  subject: string;
  // Nullable in practice_sessions; carried through to the summary unchanged.
  chapter: string | null;
  question_count: number;
  correct_count: number;
  score: number;
  created_at: string;
  finished_at: string;
  accuracy?: number | null;
  wrong_count?: number | null;
  skipped_count?: number | null;
  total_time_ms?: number | null;
}): PracticeSessionSummary {
  const start = new Date(row.created_at).getTime();
  const end = new Date(row.finished_at).getTime();
  const duration_minutes =
    typeof row.total_time_ms === "number" && row.total_time_ms > 0
      ? Math.max(1, Math.round(row.total_time_ms / 60000))
      : Math.max(1, Math.round((end - start) / 60000));
  // Prefer finish-RPC accuracy column — never re-derive when present.
  const accuracy_pct =
    typeof row.accuracy === "number"
      ? Math.round(Number(row.accuracy))
      : row.question_count > 0
        ? Math.round((100 * row.correct_count) / row.question_count)
        : 0;
  return {
    ...row,
    duration_minutes,
    accuracy_pct,
  };
}

export function useAnalysisPageData(enabled = true) {
  const { user } = useAuth();
  const liveVersion = useAcademicLive(["xp", "profile", "battle"]);
  const [data, setData] = useState<AnalysisPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    if (!user) {
      setData(null);
      endLoading(setLoading);
      return;
    }

    beginLoading(setLoading);
    setError(null);

    try {
      const [sessionsRes, rankRes, classRes, snapRes, attemptsRes, correctRes] = await Promise.all([
        supabase
          .from("practice_sessions")
          .select("id, subject, chapter, question_count, correct_count, score, created_at, finished_at, accuracy, wrong_count, skipped_count, total_time_ms")
          .eq("user_id", user.id)
          .not("finished_at", "is", null)
          .order("finished_at", { ascending: false })
          .limit(40),
        (async () => {
          try {
            const ctx = await resolveStudentServiceContext();
            return await ProgressionService.leaderboard(ctx, {
              scope: "class",
              period: "lifetime",
              metric: "xp",
              limit: 200,
            });
          } catch {
            return { rows: [] as { user_id: string; name: string; value: number }[] };
          }
        })(),
        supabase
          .from("students")
          .select("class_id, classes(name, section)")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.rpc("rpc_student_academic_snapshot"),
        // THE ONE POPULATION ACCURACY IS COUNTED OVER (G5).
        //
        // `question_attempts` is the durable per-attempt record, and it is what
        // `_exam_readiness` counts for `practice_accuracy_pct` — the figure Home
        // shows. Counting the same rows here is what makes the two screens
        // agree; counting anything else is what made them disagree.
        //
        // `question attempts select self` is `user_id = auth.uid()`, so a
        // student counts their own and nobody else's.
        supabase
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_correct", true),
      ]);

      const sessions = sessionsRes.error
        ? []
        : (sessionsRes.data ?? [])
            .filter((r): r is typeof r & { finished_at: string } => r.finished_at !== null)
            .map(sessionSummary);
      const latest = sessions[0];
      const previous = sessions[1];

      let class_rank: number | null = null;
      let leaderboard_top: LeaderboardEntry[] = [];
      let class_size = 0;
      let student_class: string | null = null;

      {
        const lb = rankRes as { rows?: { user_id: string; name: string; value: number }[] };
        const rows = Array.isArray(lb?.rows) ? lb.rows : [];
        if (rows.length) {
          class_size = rows.length;
          const idx = rows.findIndex((r) => r.user_id === user.id);
          class_rank = idx >= 0 ? idx + 1 : null;
          leaderboard_top = rows.slice(0, 5).map((r, i) => ({
            user_id: r.user_id,
            full_name: r.name,
            roll_number: null,
            score: Number(r.value) || 0,
            rank: i + 1,
          }));
        }
      }

      const classRow = classRes.data as {
        classes?: { name: string; section: string } | null;
      } | null;
      if (classRow?.classes) {
        student_class = `Class ${classRow.classes.name}-${classRow.classes.section}`;
      }

      // COUNTED FROM `question_attempts`, THE SAME ROWS HOME COUNTS (G5).
      //
      // These came from `concept_mastery` — summed `total_attempts` and
      // `correct_attempts` across concepts — and that table has DRIFTED from
      // the attempt record it is derived from. Measured 2026-09-11 on a student
      // with 120 real attempts:
      //
      //     question_attempts   120 attempts,  20 correct  ->  17%   (Home)
      //     concept_mastery     200 attempts, 125 correct  ->  63%   (Analysis)
      //
      // Not a subset, not a window: MORE attempts than exist, and a rate 46
      // points apart for one student on two screens. That is the defect G5
      // names — "the same student's accuracy renders as 46%, 48%, 40% and 80%
      // across two screens" — and making the Overview tab internally
      // consistent with `concept_mastery` would only have made it consistently
      // wrong against Home.
      //
      // The session fallback is gone with it: `practice_sessions.correct_count`
      // is seeded on 240 of 244 rows and disagrees with its own attempts
      // (KNOWN_ISSUES 44), so falling back to it reintroduces the same class of
      // error by another route.
      const correct = correctRes.count ?? 0;
      const totalAttempts = attemptsRes.count ?? 0;

      const wrong = Math.max(0, totalAttempts - correct);

      // ACCURACY IS DERIVED FROM THE COUNTS SHOWN BESIDE IT (G5).
      //
      // This was `overallAccuracyFromSnapshot`, described in its own comment as
      // "the Test + practice blend". The Overview tab renders correct and
      // incorrect from `totalAttempts` — practice attempts — and then rendered
      // that blend next to them, so the tiles read "13 correct · 14 incorrect ·
      // 46% accuracy" and a student who divides gets 48%. Three sources for one
      // quantity on one screen, and the arithmetic on display disagreed with
      // the figure on display.
      //
      // The 10 September ruling settles which one is right: practice supplies
      // the detail, tests supply marks only, and "the two are NEVER combined
      // into one figure. No average, no composite, no single performance score
      // across both." A blend cannot be shown here whatever it is called.
      //
      // So it is computed from `correct` and `wrong` — the same two numbers the
      // tab prints. Null when nothing has been attempted: 0% would claim a
      // student who has never practised got everything wrong.
      const accuracy_pct = totalAttempts > 0
        ? Math.round((100 * correct) / totalAttempts)
        : null;

      // Average pace across recent timed sessions (not only the latest).
      const timed = sessions.filter((s) => s.question_count > 0 && s.duration_minutes > 0);
      const avg_sec_per_question =
        timed.length > 0
          ? Math.round(
              timed.reduce((sum, s) => sum + (s.duration_minutes * 60) / s.question_count, 0) /
                timed.length,
            )
          : null;

      const current_accuracy = latest?.accuracy_pct ?? null;
      const previous_accuracy = previous?.accuracy_pct ?? null;
      const improvement_pct =
        current_accuracy != null && previous_accuracy != null
          ? Math.round((current_accuracy - previous_accuracy) * 10) / 10
          : null;

      setData({
        class_rank,
        leaderboard_top,
        class_size,
        student_class,
        recent_sessions: sessions,
        totals: {
          correct,
          wrong,
          accuracy_pct,
          avg_sec_per_question,
          last_session_minutes: latest?.duration_minutes ?? null,
        },
        trend: {
          previous_accuracy,
          current_accuracy,
          improvement_pct,
        },
      });
    } catch (e) {
      setError(toErrorMessage(e, "Could not load analysis"));
      setData({
        class_rank: null,
        leaderboard_top: [],
        class_size: 0,
        student_class: null,
        recent_sessions: [],
        totals: {
          correct: 0,
          wrong: 0,
          accuracy_pct: null,
          avg_sec_per_question: null,
          last_session_minutes: null,
        },
        trend: { previous_accuracy: null, current_accuracy: null, improvement_pct: null },
      });
    } finally {
      endLoading(setLoading);
    }
  }, [user, beginLoading, endLoading]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }
    void reload();
  }, [enabled, reload, liveVersion]);

  return { data, loading: enabled ? showLoading(loading) : false, error, reload };
}
