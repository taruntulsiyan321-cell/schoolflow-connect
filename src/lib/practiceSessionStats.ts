/**
 * Practice session figures, for display — one reading of a session for every
 * screen that shows one.
 *
 * rpc_finish_practice_session decides them and stores them on
 * practice_sessions; a finished row is therefore the answer, and a screen that
 * has no row yet reads the finish RPC's own reply (the overlay). Nothing here
 * invents XP.
 *
 * Accuracy is correct ÷ ANSWERED — skipped questions are not wrong answers
 * (20261021000000) — and it is ABSENT, not 0%, when nothing was answered. A
 * student who skipped every question has no accuracy; "0%" would be a claim
 * about them the data does not make.
 */

type PracticeSessionStatsSource = {
  question_count?: number | null;
  correct_count?: number | null;
  wrong_count?: number | null;
  skipped_count?: number | null;
  accuracy?: number | string | null;
  xp_earned?: number | null;
  total_time_ms?: number | null;
  finished_at?: string | null;
};

/** The finish RPC's reply, for a screen that has not loaded the row yet. */
type PracticeSessionStatsOverlay = {
  questionCount?: number;
  correctCount?: number;
  wrongCount?: number;
  skippedCount?: number;
  accuracy?: number | null;
  xpEarned?: number;
  totalTimeMs?: number | null;
};

type PracticeSessionStats = {
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  /** Rounded percent over answered questions; null when none was answered. */
  accuracy: number | null;
  /** Session XP from the finish — 0 when not yet credited. Never invented. */
  xpEarned: number;
  totalTimeMs: number | null;
  /** True once XP has actually been credited (a finished row, or the finish's reply). */
  xpFromDb: boolean;
};

function asCount(n: unknown): number | null {
  const v = typeof n === "number" ? n : n == null ? NaN : Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** correct ÷ (correct + wrong), rounded — the finish RPC's rule. */
export function deriveSessionAccuracy(correctCount: number, wrongCount: number): number | null {
  const answered = correctCount + wrongCount;
  return answered > 0 ? Math.round((correctCount / answered) * 100) : null;
}

export function resolvePracticeSessionStats(
  session: PracticeSessionStatsSource | null | undefined,
  overlay?: PracticeSessionStatsOverlay | null,
): PracticeSessionStats {
  // ONE source per reading, never a mix. A finished row is what the server
  // holds — including any correction made after a finish reply or a saved
  // snapshot was taken. Before the row is there, the finish's own reply.
  if (session?.finished_at) {
    const questionCount = asCount(session.question_count) ?? 0;
    const correctCount = asCount(session.correct_count) ?? 0;
    const skippedCount = asCount(session.skipped_count) ?? 0;
    const wrongCount = asCount(session.wrong_count) ?? Math.max(0, questionCount - correctCount - skippedCount);
    // A finished row's NULL is the finish saying "nothing answered".
    const acc = session.accuracy == null ? NaN : Number(session.accuracy);
    return {
      questionCount, correctCount, wrongCount, skippedCount,
      accuracy: Number.isFinite(acc) ? Math.round(acc) : null,
      xpEarned: asCount(session.xp_earned) ?? 0,
      totalTimeMs: typeof session.total_time_ms === "number" && session.total_time_ms > 0 ? session.total_time_ms : null,
      xpFromDb: true,
    };
  }

  const questionCount = asCount(overlay?.questionCount ?? session?.question_count) ?? 0;
  const correctCount = asCount(overlay?.correctCount ?? session?.correct_count) ?? 0;
  const skippedCount = asCount(overlay?.skippedCount ?? session?.skipped_count) ?? 0;
  const wrongCount =
    asCount(overlay?.wrongCount ?? session?.wrong_count) ??
    Math.max(0, questionCount - correctCount - skippedCount);
  const accuracy =
    overlay && overlay.accuracy !== undefined
      ? overlay.accuracy == null || !Number.isFinite(overlay.accuracy) ? null : Math.round(overlay.accuracy)
      : deriveSessionAccuracy(correctCount, wrongCount);
  // Unfinished: only the finish's reply can say XP was credited. The column's
  // DEFAULT 0 on an open row is not a credit.
  const overlayXp = asCount(overlay?.xpEarned);
  const totalTimeMs = overlay?.totalTimeMs ?? null;
  return {
    questionCount, correctCount, wrongCount, skippedCount, accuracy,
    xpEarned: overlayXp ?? 0,
    totalTimeMs: typeof totalTimeMs === "number" && totalTimeMs > 0 ? totalTimeMs : null,
    xpFromDb: overlayXp != null,
  };
}

/** XP for display — an em dash until the finish has credited it. */
export function formatSessionXp(xpEarned: number, xpFromDb: boolean): string {
  if (!xpFromDb && xpEarned <= 0) return "—";
  return String(xpEarned);
}

/** Accuracy for display — an em dash when nothing was answered. */
export function formatSessionAccuracy(accuracy: number | null): string {
  return accuracy == null ? "—" : `${accuracy}%`;
}

/**
 * A length of time on questions, for display — a session's (total_time_ms),
 * one question's (time_taken_ms), or a day's or month's study time. One
 * format for all of them, so a question's "1m 40s" and the session's total
 * read in the same units.
 *
 * Seconds under a minute — a floor of "1m" reported a seven-second session as
 * a minute. Minutes AND seconds under an hour: "2m" for 1m 40s rounded away
 * a third of the figure, and a list of per-question times would not have
 * added up to the total above it. An em dash when nothing carried a timing.
 */
export function formatSessionDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !(ms > 0)) return "—";
  const secs = Math.max(1, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const mins = Math.round(secs / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
