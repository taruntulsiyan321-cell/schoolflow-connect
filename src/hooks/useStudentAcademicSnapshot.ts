import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
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
  dpp?: { open: number; completed: number };
  weak_topics?: { subject: string; chapter?: string; topic?: string; accuracy: number }[];
  strong_topics?: { subject: string; chapter?: string; topic?: string; accuracy: number }[];
  revision_queue?: { id: string; subject: string; topic?: string; chapter?: string; priority: number; due_date: string }[];
  mistake_count?: number;
  recovery_pending?: number;
  weak_concepts?: { subject: string; concept: string; mastery_score: number }[];
  self_practice?: { sessions_completed: number };
  activity_heatmap?: { date: string; dpp: number; homework: number; battles: number; self_practice?: number; minutes: number }[];
  exam_readiness?: {
    score: number;
    label: string;
    tone: string;
    attendance_pct?: number;
    accuracy_pct?: number;
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: snap, error: err } = await supabase.rpc("rpc_student_academic_snapshot");
    if (err) setError(err.message);
    else setData((snap as AcademicSnapshot) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, liveVersion, reload]);

  return { data, loading, error, reload };
}
