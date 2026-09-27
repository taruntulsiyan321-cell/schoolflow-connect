import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { supabase } from "@/integrations/supabase/client";

/**
 * The student's practice time, per day of their own calendar, from
 * rpc_student_practice_time (20261115000000).
 *
 * Every study-time figure on Analysis reads this: "Study time (4 weeks)",
 * "Average per day", "Most active day", the day-of-week chart, the heat-map
 * tooltip, "This month vs last month" and "Most active hour". They read
 * academic_daily_activity.practice_minutes before — whole minutes per session
 * with a one-minute floor, a test's minutes folded in, the day taken in UTC,
 * and only 28 days of it — and the hour came from raw timestamps fetched
 * under a 1,000-row cap. This is question_attempts, summed on the server.
 */
export type PracticeTimeDay = {
  /** yyyy-mm-dd on the student's clock. */
  date: string;
  /** Time on the questions that day, skips included: time spent. */
  ms: number;
  /** Questions answered, not skipped. */
  answered: number;
  correct: number;
  /** Practice sessions finished that day with something in them. */
  sessions: number;
};

export type StudentPracticeTime = {
  /** First day of last month, yyyy-mm-dd — nothing earlier is in `days`. */
  from: string;
  today: string;
  /** Only days with something in them, oldest first. */
  days: PracticeTimeDay[];
  /** 24 counts of answers and skips, index 0 = midnight, last 28 days. */
  hours: number[];
};

const CONTRACT_ERROR = "Practice time came back in a shape this screen cannot read.";

function count(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Null unless every field is there: a missing figure is not a zero. */
export function parsePracticeTime(payload: unknown): StudentPracticeTime | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.from !== "string" || !ISO_DAY.test(p.from)) return null;
  if (typeof p.today !== "string" || !ISO_DAY.test(p.today)) return null;
  if (!Array.isArray(p.days) || !Array.isArray(p.hours) || p.hours.length !== 24) return null;

  const hours = p.hours.map(count);
  if (hours.some((h) => h == null)) return null;

  const days: PracticeTimeDay[] = [];
  for (const raw of p.days) {
    const d = (raw ?? {}) as Record<string, unknown>;
    const ms = count(d.ms);
    const answered = count(d.answered);
    const correct = count(d.correct);
    const sessions = count(d.sessions);
    if (typeof d.date !== "string" || !ISO_DAY.test(d.date)) return null;
    if (ms == null || answered == null || correct == null || sessions == null) return null;
    days.push({ date: d.date, ms, answered, correct, sessions });
  }
  return { from: p.from, today: p.today, days, hours: hours as number[] };
}

/** The browser's IANA zone, which the server buckets days and hours in. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useStudentPracticeTime(enabled = true) {
  const liveVersion = useAcademicLive(["xp", "profile"]);
  const [data, setData] = useState<StudentPracticeTime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    beginLoading(setLoading);
    setError(null);
    // The generated types predate this function — the same gap, and the same
    // narrowing, as useStudentPracticeAnalytics. Cast the client, not the
    // method: a detached `rpc` loses its receiver.
    const client = supabase as unknown as {
      rpc: (
        fn: "rpc_student_practice_time",
        args: { _tz: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: payload, error: err } = await client.rpc("rpc_student_practice_time", { _tz: browserTimeZone() });
    if (err) {
      setError(err.message);
      setData(null);
    } else {
      const parsed = parsePracticeTime(payload);
      if (!parsed) setError(CONTRACT_ERROR);
      setData(parsed);
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
