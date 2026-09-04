import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The §10.15 weekly parent summary. SCHOOL DATA ONLY.
 *
 * `snapshot: Record<string, unknown>` used to sit here, and that opacity is
 * how practice data reached a parent unnoticed: the RPC forwarded the child's
 * entire academic snapshot — practice_accuracy_pct, battle-weighted
 * active_days, a readiness score 15% practice volume — and the type said
 * nothing about it. The shape is now written out, so anything practice-derived
 * has to be added here deliberately rather than smuggled through an index
 * signature.
 *
 * Every figure is nullable ON PURPOSE. A week in which nothing was marked has
 * an UNKNOWN rate, not a rate of zero, and `null < 60` is true in JavaScript —
 * band these through @/academic/metrics, which treats null as `unknown`.
 */
export type ParentAlert = {
  id: string;
  kind: "weakness" | "consistency" | "improvement" | "participation";
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export type ParentDigestAttendance = {
  present: number;
  absent: number;
  late: number;
  leave: number;
  half_day: number;
  marked: number;
  /** null when nothing was marked in the window. */
  pct: number | null;
};

export type ParentDigestHomework = {
  due: number;
  submitted: number;
  /** null when nothing was due in the window. */
  pct: number | null;
};

export type ParentDigestMarkRow = {
  exam: string | null;
  subject: string | null;
  scored: number | null;
  out_of: number | null;
  /** null when the exam records no max_marks. */
  pct: number | null;
};

export type ParentDigestMarks = {
  published: number;
  subjects: ParentDigestMarkRow[];
};

export type ParentDigestChild = {
  student_id: string;
  name: string;
  class: string | null;
  attendance: ParentDigestAttendance;
  homework: ParentDigestHomework;
  marks: ParentDigestMarks;
  /**
   * Read-only. The digest no longer GENERATES alerts — every generation rule
   * it had was derived from practice. Empty until a school-data emitter exists.
   */
  alerts: ParentAlert[];
};

export type ParentWeeklyDigest = {
  /** The reporting window, stated rather than assumed by the reader. */
  window: { starts_on: string; ends_on: string };
  children: ParentDigestChild[];
  generated_at: string;
};

export function useParentWeeklyDigest(enabled = true) {
  const [data, setData] = useState<ParentWeeklyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: digest, error: err } = await supabase.rpc("rpc_parent_weekly_digest");
    if (err) setError(err.message);
    else setData((digest as unknown as ParentWeeklyDigest) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled]);

  return { data, loading, error, reload };
}
