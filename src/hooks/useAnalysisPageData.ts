import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
}): PracticeSessionSummary {
  const start = new Date(row.created_at).getTime();
  const end = new Date(row.finished_at).getTime();
  const duration_minutes = Math.max(1, Math.round((end - start) / 60000));
  const accuracy_pct =
    row.question_count > 0 ? Math.round((100 * row.correct_count) / row.question_count) : 0;
  return {
    ...row,
    duration_minutes,
    accuracy_pct,
  };
}

export function useAnalysisPageData(enabled = true) {
  const { user } = useAuth();
  const [data, setData] = useState<AnalysisPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [sessionsRes, rankRes, masteryRes, classRes] = await Promise.all([
        supabase
          .from("practice_sessions")
          .select("id, subject, chapter, question_count, correct_count, score, created_at, finished_at")
          .eq("user_id", user.id)
          .not("finished_at", "is", null)
          .order("finished_at", { ascending: false })
          .limit(12),
        supabase.rpc("rpc_leaderboard", {
          _scope: "class",
          _category: "xp",
          _subject: undefined,
          _limit: 200,
        }),
        supabase.rpc("rpc_student_concept_mastery"),
        supabase
          .from("students")
          .select("class_id, classes(name, section)")
          .eq("user_id", user.id)
          .maybeSingle(),
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

      if (Array.isArray(rankRes.data)) {
        const rows = rankRes.data as {
          user_id: string;
          full_name: string;
          roll_number: string | null;
          score: number;
          class_label?: string;
        }[];
        class_size = rows.length;
        const idx = rows.findIndex((r) => r.user_id === user.id);
        class_rank = idx >= 0 ? idx + 1 : null;
        leaderboard_top = rows.slice(0, 5).map((r, i) => ({
          user_id: r.user_id,
          full_name: r.full_name,
          roll_number: r.roll_number ?? null,
          score: Number(r.score) || 0,
          rank: i + 1,
        }));
        if (rows[0]?.class_label) {
          student_class = rows[0].class_label;
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
      const accuracy_pct =
        totalAttempts > 0 ? Math.round((100 * correct) / totalAttempts) : latest?.accuracy_pct ?? 0;

      const avg_sec_per_question =
        latest && latest.question_count > 0
          ? Math.round((latest.duration_minutes * 60) / latest.question_count)
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
      setError(e instanceof Error ? e.message : "Could not load analysis");
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
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled, reload]);

  return { data, loading, error, reload };
}
