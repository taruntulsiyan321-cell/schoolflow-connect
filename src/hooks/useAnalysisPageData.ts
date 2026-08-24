import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ProgressionService, resolveStudentServiceContext, useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { overallAccuracyFromSnapshot } from "@/lib/learningMetrics";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { toErrorMessage } from "@/lib/presentation";

export type PracticeSessionSummary = {
  id: string;
  subject: string;
  chapter: string;
  question_count: number;
  correct_count: number;
  score: number;
  created_at: string;
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
    accuracy_pct: number;
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
  chapter: string;
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
      const [sessionsRes, rankRes, masteryRes, classRes, snapRes] = await Promise.all([
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
        supabase.rpc("rpc_student_concept_mastery"),
        supabase
          .from("students")
          .select("class_id, classes(name, section)")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.rpc("rpc_student_academic_snapshot"),
      ]);

      const sessions = sessionsRes.error
        ? []
        : (sessionsRes.data ?? []).map(sessionSummary);
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

      const masteryItems =
        ((masteryRes.data as { items?: { correct_attempts: number; total_attempts: number }[] })
          ?.items as { correct_attempts: number; total_attempts: number }[]) ?? [];

      let correct = masteryItems.reduce((s, m) => s + (m.correct_attempts ?? 0), 0);
      let totalAttempts = masteryItems.reduce((s, m) => s + (m.total_attempts ?? 0), 0);

      if (totalAttempts === 0 && sessions.length > 0) {
        correct = sessions.reduce((s, x) => s + x.correct_count, 0);
        totalAttempts = sessions.reduce((s, x) => s + x.question_count, 0);
      }

      const wrong = Math.max(0, totalAttempts - correct);
      // Overall accuracy SSOT: academic snapshot exam_readiness.accuracy_pct (the
      // DPP + practice blend), not the practice-only figure.
      const accuracy_pct = overallAccuracyFromSnapshot(
        (snapRes.error ? null : snapRes.data) as AcademicSnapshot | null,
      );

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
          accuracy_pct: 0,
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
