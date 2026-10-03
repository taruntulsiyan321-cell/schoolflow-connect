/**
 * `question_attempts.confidence`, as the practice session writes it (owner,
 * 2026-10-03: the "I'm guessing" tap). The tap is offered on every question of
 * a practice session, before the answer; what an answer records is
 *
 *   MARKED_AS_GUESS     the student marked it as a guess
 *   ANSWERED_UNMARKED   the tap was there, and was not used
 *   null                no tap was offered (sessions before it, and skips)
 *
 * rpc_record_question_attempt takes it from `_meta.confidence`. Nothing else
 * reads or writes the column (measured 2026-10-03: 0 of 8,457 attempts had a
 * value, and the only other "confidence" the database reads is the AI
 * telemetry's, on another table).
 */
export const MARKED_AS_GUESS = 0;
export const ANSWERED_UNMARKED = 1;

/** What an answer records, from whether the tap was on when it was given. */
export function confidenceOf(guessing: boolean): number {
  return guessing ? MARKED_AS_GUESS : ANSWERED_UNMARKED;
}

/** true: marked as a guess; false: answered without marking one; null: not known. */
export function wasGuess(confidence: number | string | null | undefined): boolean | null {
  // numeric columns can arrive as strings from some readers.
  const c = typeof confidence === "string" ? Number(confidence) : confidence;
  if (c === MARKED_AS_GUESS) return true;
  if (c === ANSWERED_UNMARKED) return false;
  return null;
}
