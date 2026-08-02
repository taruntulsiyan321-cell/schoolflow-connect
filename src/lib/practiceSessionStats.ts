/**
 * Practice Session Stats SSOT — presentation helpers only.
 *
 * Accuracy / wrong / skip / XP are owned by `rpc_finish_practice_session`
 * (practice_sessions columns). UI must prefer those columns and must NEVER
 * invent XP (e.g. correct×10) or invent accuracy when the row exists.
 *
 * Accuracy policy (matches finish RPC): correct / total_attempts × 100,
 * where total_attempts includes skips.
 */

export type PracticeSessionStatsSource = {
  question_count?: number | null;
  correct_count?: number | null;
  wrong_count?: number | null;
  skipped_count?: number | null;
  accuracy?: number | null;
  xp_earned?: number | null;
  total_time_ms?: number | null;
  finished_at?: string | null;
  created_at?: string | null;
};

export type PracticeSessionStats = {
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  /** Rounded percent from DB when present; else derived from counts using server policy. */
  accuracy: number;
  /** Session XP from finish RPC — 0 when not yet credited. Never invent. */
  xpEarned: number;
  totalTimeMs: number | null;
  /** True when accuracy came from DB column (not derived). */
  accuracyFromDb: boolean;
  /** True when xp came from a positive DB column. */
  xpFromDb: boolean;
};

function asNonNegInt(n: unknown, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.floor(v);
}

/** Derive accuracy the same way finish RPC does (correct / total including skips). */
export function deriveSessionAccuracy(
  correctCount: number,
  questionCount: number,
): number {
  if (questionCount <= 0) return 0;
  return Math.round((correctCount / questionCount) * 100);
}

/**
 * Resolve display stats from a practice_sessions row (and optional snapshot overlay).
 * Snapshot wins for frozen Saved Session reopen; otherwise DB columns win.
 */
export function resolvePracticeSessionStats(
  session: PracticeSessionStatsSource | null | undefined,
  snapshot?: {
    questionCount?: number;
    correctCount?: number;
    wrongCount?: number;
    skippedCount?: number;
    accuracy?: number;
    xpEarned?: number;
    totalTimeMs?: number | null;
  } | null,
): PracticeSessionStats {
  const questionCount = asNonNegInt(
    snapshot?.questionCount ?? session?.question_count,
  );
  const correctCount = asNonNegInt(
    snapshot?.correctCount ?? session?.correct_count,
  );
  const skippedCount = asNonNegInt(
    snapshot?.skippedCount ?? session?.skipped_count,
  );
  const wrongFromSource =
    snapshot?.wrongCount ?? session?.wrong_count;
  const wrongCount =
    wrongFromSource != null
      ? asNonNegInt(wrongFromSource)
      : Math.max(0, questionCount - correctCount - skippedCount);

  const accuracyFromDb =
    typeof snapshot?.accuracy === "number" ||
    typeof session?.accuracy === "number";
  const accuracyRaw =
    typeof snapshot?.accuracy === "number"
      ? snapshot.accuracy
      : typeof session?.accuracy === "number"
        ? Number(session.accuracy)
        : deriveSessionAccuracy(correctCount, questionCount);
  const accuracy = Math.round(Number.isFinite(accuracyRaw) ? accuracyRaw : 0);

  const xpFromDb =
    (typeof snapshot?.xpEarned === "number" && Number.isFinite(snapshot.xpEarned) && snapshot.xpEarned >= 0) ||
    (typeof session?.xp_earned === "number" && Number.isFinite(session.xp_earned) && session.xp_earned >= 0);
  const xpEarned =
    typeof snapshot?.xpEarned === "number" && Number.isFinite(snapshot.xpEarned)
      ? Math.max(0, Math.floor(snapshot.xpEarned))
      : typeof session?.xp_earned === "number" && Number.isFinite(session.xp_earned)
        ? Math.max(0, Math.floor(session.xp_earned))
        : 0;

  const totalTimeMs =
    snapshot?.totalTimeMs ??
    (typeof session?.total_time_ms === "number" ? session.total_time_ms : null);

  return {
    questionCount,
    correctCount,
    wrongCount,
    skippedCount,
    accuracy,
    xpEarned,
    totalTimeMs,
    accuracyFromDb,
    xpFromDb,
  };
}

/** Format XP for UI — show em dash when session has no credited XP yet. */
export function formatSessionXp(xpEarned: number, xpFromDb: boolean): string {
  if (!xpFromDb && xpEarned <= 0) return "—";
  return String(xpEarned);
}
