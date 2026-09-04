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
 *
 * ── THIS TYPE HAD DRIFTED FROM THE RPC AND IS NOW REALIGNED ──────────────
 *
 * It declared `marks` and `alerts`. The function returns neither, and had not
 * for two migrations: `alerts` went in 20260904190000 along with the feature,
 * and the exam-marks key it called `marks` went in 20260904210000. It also
 * omitted `remarks` and `test_marks`, which the function DOES return. Nothing
 * broke, because this hook still has no caller — which is exactly how a type
 * gets to be wrong about four keys at once.
 *
 * The payload is rule 17's five items, and the key each lands in:
 *
 *   1  attendance                 → attendance
 *   2  homework completed         → homework.submitted
 *   3  homework not completed     → homework.not_completed
 *   4  a teacher's remark, if any → remarks
 *   5  test marks (online test)   → test_marks
 *
 * Five items, four keys, because items 2 and 3 are two halves of one count.
 *
 * EXAM MARKS ARE NOT HERE, deliberately. They live in the exam report, which
 * parents have all year; the digest carried a duplicate that was empty in every
 * week without an exam. Adding an `exam_marks` key back here reintroduces that
 * duplication and will fail the payload-shape test alongside it.
 */
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
  /** Stated, not derived. Rule 17 names both halves. */
  not_completed: number;
  /** null when nothing was due in the window. */
  pct: number | null;
};

/**
 * §10.14. `edited_at` is carried because a remark the parent already read and
 * that was later changed must not arrive looking original.
 */
export type ParentDigestRemark = {
  remark: string;
  kind: string | null;
  created_at: string;
  edited_at: string | null;
};

export type ParentDigestTestMarkRow = {
  test: string | null;
  scored: number | null;
  out_of: number | null;
  /** null when the test records no max_mark. */
  pct: number | null;
};

/**
 * Marks for tests CONDUCTED ONLINE only. "Online" is inferred from the test
 * having attempts — `tests.test_kind` is NULL on every row — and that inference
 * lives in the RPC, not here.
 */
export type ParentDigestTestMarks = {
  count: number;
  tests: ParentDigestTestMarkRow[];
};

export type ParentDigestChild = {
  student_id: string;
  name: string;
  class: string | null;
  attendance: ParentDigestAttendance;
  homework: ParentDigestHomework;
  remarks: ParentDigestRemark[];
  test_marks: ParentDigestTestMarks;
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
