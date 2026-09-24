import { useCallback, useEffect, useRef, useState } from "react";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
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
  test?: { open: number; completed: number };
  /**
   * From _weak_topics_for_user, filtered to is_weak. `attempts` is the count
   * the SERVER measured for that topic — the client must not re-derive it by
   * matching the topic name against session chapters, which is what
   * practiceCountForTopic did back when a "topic" was a chapter.
   */
  weak_topics?: {
    subject: string; chapter?: string; topic?: string; accuracy: number;
    attempts?: number; correct?: number; thin?: boolean;
  }[];
  /**
   * Chapters whose §5.3 revision date has arrived, from chapter_state — the
   * same source the Revision screen reads.
   *
   * It replaced `revision_queue`, which served up to ten rows of the AI
   * layer's weak-TOPIC worklist. Nothing ever read those rows; Dashboard and
   * LearningHub both took `.length`, and that length disagreed with the
   * Revision screen next to it because the two counted different things.
   */
  revision_due?: number;
  mistake_count?: number;
  /**
   * Chapters at RECOVERY_TRIGGER_COUNT open mistakes — what Recovery calls
   * `ready`. Was a count of open recovery_assignments rows until
   * 20260926000000 dropped that engine.
   */
  recovery_pending?: number;
  weak_concepts?: { subject: string; concept: string; mastery_score: number }[];
  self_practice?: { sessions_completed: number };
  activity_heatmap?: { date: string; test: number; homework: number; battles: number; self_practice?: number; minutes: number }[];
  exam_readiness?: {
    score: number;
    label: string;
    tone: string;
    attendance_pct?: number;
    /** Blended Test + practice accuracy. NOT practice accuracy on its own. */
    accuracy_pct?: number;
    /** Practice-only accuracy, straight from question_attempts. */
    practice_accuracy_pct?: number;
    test_completion_pct?: number;
    active_days_14d?: number;
  };
};

/**
 * ONE READ OF THE SNAPSHOT AT A TIME, SHARED BY EVERY CALLER.
 *
 * `rpc_student_academic_snapshot` is not a cheap read: it counts homework and
 * tests, builds the weak-topic list, walks the recovery queue and the revision
 * ladder, reads 28 days of activity and computes exam readiness — and it
 * WRITES, through `_rebuild_revision_queue`. Measured on production
 * 2026-09-23, from pg_stat_statements: **29,322 calls, 1,975 s of database
 * time, max 7.7 s**, and it is the call that returns
 * `57014 canceling statement due to statement timeout` on the student's home
 * and analysis screens (KNOWN_ISSUES 74).
 *
 * It had no sharing of any kind. Dashboard, Analysis, the Practice hub and the
 * Battleground each called it on mount, and this hook re-fires on live events
 * across SEVEN domains — so one XP bump during a battle made every mounted
 * screen ask again, at once.
 *
 * So: one in-flight request is shared by everyone who asks while it runs, and
 * an answer is reused for FRESH_MS. A live event invalidates it, which makes
 * the next read real — the point is to collapse the herd, never to show a
 * stale figure after something changed.
 */
export const SNAPSHOT_FRESH_MS = 15_000;
/**
 * How recent an answer must be for a LIVE EVENT to accept it.
 *
 * A live event means something changed, so it does not take the ordinary
 * 15-second answer — but a burst of them must not become a burst of reads.
 * Measured in the browser 2026-09-23: six XP events, as a battle sends them,
 * produced six reads of a call whose worst case is 7.7 s. With this, the same
 * burst costs one read and the screens are at most three seconds behind.
 */
export const SNAPSHOT_LIVE_COALESCE_MS = 3_000;
let snapshotInFlight: Promise<AcademicSnapshot | null> | null = null;
let snapshotCache: { at: number; data: AcademicSnapshot | null } | null = null;

/** Test seam: forget the cache AND any request in flight. */
export function resetStudentAcademicSnapshot(): void {
  snapshotCache = null;
  snapshotInFlight = null;
}

export async function readStudentAcademicSnapshot(
  opts: { maxAgeMs?: number } = {},
): Promise<AcademicSnapshot | null> {
  const maxAge = opts.maxAgeMs ?? SNAPSHOT_FRESH_MS;
  // Strictly younger than maxAge, so `maxAgeMs: 0` means "ask the server",
  // even when the cached answer arrived in this same millisecond.
  if (snapshotCache && Date.now() - snapshotCache.at < maxAge) return snapshotCache.data;
  if (snapshotInFlight) return snapshotInFlight;
  snapshotInFlight = (async () => {
    const { data, error } = await supabase.rpc("rpc_student_academic_snapshot");
    if (error) throw error;
    const snap = (data as AcademicSnapshot) ?? null;
    snapshotCache = { at: Date.now(), data: snap };
    return snap;
  })();
  try {
    return await snapshotInFlight;
  } finally {
    snapshotInFlight = null;
  }
}

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
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async (opts: { maxAgeMs?: number } = {}) => {
    beginLoading(setLoading);
    setError(null);
    // Whatever this read accepts, it shares one request with every other
    // screen asking at the same moment.
    let snap: AcademicSnapshot | null = null;
    let err: { message: string } | null = null;
    try {
      snap = await readStudentAcademicSnapshot(opts);
    } catch (e) {
      err = e as { message: string };
    }
    if (err) {
      setError(err.message);
      // NULL, NOT THE PREVIOUS ANSWER.
      //
      // This left `data` untouched on a failure, so a refresh that failed
      // kept rendering the figures from the last successful load with
      // nothing to say they were stale — and after a student switch, the
      // previous student's. useStudentPracticeAnalytics already states the
      // rule in its own error branch: a panel that keeps showing old
      // figures is worse than one that says it has nothing. Two of the four
      // hooks behind this page obeyed it and two did not.
      setData(null);
    } else setData((snap as AcademicSnapshot) ?? null);
    endLoading(setLoading);
  }, [beginLoading, endLoading]);

  const seenVersion = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }
    // A first mount takes whatever is fresh — that is how four screens opening
    // together ask the server once. A live event says something changed, so it
    // will not take a 15-second answer, but it takes a three-second one, which
    // is what keeps a burst of XP events from becoming a burst of reads.
    const liveChanged = seenVersion.current !== null && liveVersion !== seenVersion.current;
    seenVersion.current = liveVersion;
    void reload(liveChanged ? { maxAgeMs: SNAPSHOT_LIVE_COALESCE_MS } : {});
  }, [enabled, liveVersion, reload]);

  return { data, loading: enabled ? showLoading(loading) : false, error, reload };
}
