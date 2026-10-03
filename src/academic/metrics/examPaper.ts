/**
 * The CUET paper. Its one home is the database — public._mock_paper() — and
 * these are its numbers as the client reads them: through rpc_exam_paper
 * (20261144000000), rpc_session_analysis_context and rpc_mock_catalog.
 */
export type PaperShape = { questions: number; minutes: number; marks_correct: number; marks_wrong: number };

/** What the paper allows for one question, in seconds: 60 minutes over 50 questions is 72. */
export function secondsPerQuestion(paper: PaperShape): number {
  return (paper.minutes * 60) / paper.questions;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A server reply's paper, or null when it is not one — then nothing is read against the paper. */
export function readPaperShape(raw: unknown): PaperShape | null {
  const p = (raw && typeof raw === "object" ? raw : null) as Partial<Record<keyof PaperShape, unknown>> | null;
  const questions = num(p?.questions), minutes = num(p?.minutes);
  const right = num(p?.marks_correct), wrong = num(p?.marks_wrong);
  if (questions == null || questions <= 0 || minutes == null || minutes <= 0 || right == null || wrong == null) return null;
  return { questions, minutes, marks_correct: right, marks_wrong: wrong };
}
