import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AcademicSnapshot = {
  student?: { id: string; full_name: string; roll_number?: string; admission_number?: string } | null;
  xp?: { xp: number; level: number; current_streak?: number; wins?: number; total_battles?: number } | null;
  homework?: { pending: number; completed: number };
  dpp?: { open: number; completed: number };
  weak_topics?: { subject: string; chapter?: string; topic?: string; accuracy: number }[];
  strong_topics?: { subject: string; chapter?: string; topic?: string; accuracy: number }[];
  revision_queue?: { id: string; subject: string; topic?: string; chapter?: string; priority: number; due_date: string }[];
  mistake_count?: number;
  activity_heatmap?: { date: string; dpp: number; homework: number; battles: number; minutes: number }[];
  exam_readiness?: { score: number; label: string; tone: string; attendance_pct?: number; accuracy_pct?: number };
};

export function useStudentAcademicSnapshot(enabled = true) {
  const [data, setData] = useState<AcademicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: snap, error: err } = await supabase.rpc("rpc_student_academic_snapshot");
    if (err) setError(err.message);
    else setData((snap as AcademicSnapshot) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled]);

  return { data, loading, error, reload };
}
