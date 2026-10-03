/**
 * One question of a finished session as the result screen holds it: a
 * question_attempts row, this device's own record of the session just played
 * (snapshotsToAttemptRows), or a saved snapshot's — the same shape for all three.
 */
export type AttemptRow = {
  id: string;
  /** What the question was, as the attempt froze it; the ids say which question, so it can be marked and reported. */
  generated_question: {
    question?: string;
    options?: string[];
    explanation?: string;
    bank_question_id?: string | null;
    upload_question_id?: string | null;
    capture_question_id?: string | null;
    subject?: string | null;
    chapter?: string | null;
    topic?: string | null;
  };
  bank_question_id?: string | null;
  subject?: string | null;
  chapter?: string | null;
  difficulty?: string | null;
  correct_answer: { index?: number; text?: string };
  selected_answer: { index?: number; text?: string } | null;
  is_correct: boolean | null;
  created_at: string;
  skipped?: boolean | null;
  timed_out?: boolean | null;
  /** Left out of accuracy by a won dispute or a corrected question. */
  excluded_from_accuracy?: boolean | null;
  /** Time on this question alone — question_attempts.time_taken_ms. */
  time_taken_ms?: number | null;
  /** The "I'm guessing" tap — question_attempts.confidence (metrics/answerConfidence.ts). */
  confidence?: number | string | null;
};
