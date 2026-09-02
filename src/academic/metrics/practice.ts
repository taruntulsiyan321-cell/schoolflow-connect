/**
 * CHUNK 10 — practice and session metrics.
 *
 * §10.8 permits the NUMBER and forbids the list: "Session totals are stored
 * (attempted, correct count) so accuracy can be shown", against "Strong areas
 * are never shown anywhere in the app."
 *
 * So this module computes accuracy and does not derive a single strength from
 * it. There is no `strongTopics`, no `masteredConcepts`, and no band whose top
 * rung names one — those live in bands.ts and stop at "On track".
 *
 * WHY THIS EXISTS AT ALL: five files computed the same expression —
 *
 *     const accuracy = total ? Math.round((correct / total) * 100) : 0;
 *
 * in practiceService, useRecoveryZone, practiceSessionSnapshot,
 * recoverySessionSnapshot and recoveryCompletionReport. Identical, including the
 * defect: `: 0`. A session with no attempts is not a session scored zero. A
 * student who opened a practice screen and answered nothing was shown 0%
 * accuracy, which is a mark, not an absence.
 */

import { type Metric, noData, pct } from "./types";

/**
 * Accuracy over one session: correct ÷ attempted.
 *
 * `no_data` when nothing was attempted — never 0%. Skipped questions count as
 * attempted (the student saw them and chose not to answer); unseen ones do not,
 * which is why the caller passes the counts rather than the question list.
 */
export function sessionAccuracy(correct: number, attempted: number): Metric<number> {
  if (!Number.isFinite(correct) || !Number.isFinite(attempted)) {
    return noData("accuracy: non-finite counts");
  }
  if (attempted <= 0) return noData("no question attempted in this session");
  return pct(correct, attempted, `${correct} of ${attempted} attempted`);
}

/**
 * Accuracy across several sessions, from summed totals.
 *
 * Not the mean of per-session accuracies — a 1-question session would weigh the
 * same as a 40-question one. The same fault the school attendance figure had.
 */
export function accuracyAcross(
  sessions: { correct: number; attempted: number }[],
): Metric<number> {
  if (sessions.length === 0) return noData("no sessions");

  let correct = 0;
  let attempted = 0;
  let counted = 0;
  for (const s of sessions) {
    if (!(s.attempted > 0)) continue;
    counted += 1;
    correct += s.correct;
    attempted += s.attempted;
  }
  if (attempted === 0) {
    return noData(`${sessions.length} session(s), none with an attempted question`);
  }
  return pct(
    correct,
    attempted,
    `${correct} of ${attempted} attempted across ${counted} of ${sessions.length} session(s)`,
  );
}
