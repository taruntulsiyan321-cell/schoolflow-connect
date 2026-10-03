/**
 * What a session's result screen needs beyond the session's own attempts
 * (rpc_session_analysis_context, 20261143000000): the CUET paper's shape, the
 * last session on the same chapter, and each question's earlier answer. The
 * arithmetic on them is src/academic/metrics/sessionAnalysis.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EarlierAnswer, PaperShape, PreviousSession } from "@/academic/metrics/sessionAnalysis";

export type SessionAnalysisContext = {
  paper: PaperShape;
  previous: PreviousSession | null;
  earlier: EarlierAnswer[];
};

type Raw = {
  paper?: Partial<PaperShape> | null;
  previous?: {
    finished_at?: string;
    attempts?: Array<{ topic?: string | null; is_correct?: boolean | null; skipped?: boolean; timed_out?: boolean; time_taken_ms?: number | null; excluded?: boolean }>;
  } | null;
  earlier?: Array<{ bank_question_id?: string; is_correct?: boolean | null; skipped?: boolean }>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Read the server's reply; null when it is not one (no paper, no comparison — the screen shows the session alone). */
export function readSessionAnalysisContext(raw: unknown): SessionAnalysisContext | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Raw | null;
  const p = r?.paper;
  const questions = num(p?.questions), minutes = num(p?.minutes), right = num(p?.marks_correct), wrong = num(p?.marks_wrong);
  if (!r || questions == null || questions <= 0 || minutes == null || right == null || wrong == null) return null;
  const prev = r.previous && r.previous.finished_at && Array.isArray(r.previous.attempts)
    ? {
        finishedAt: r.previous.finished_at,
        attempts: r.previous.attempts.map((a) => ({
          topic: a.topic ?? null,
          isCorrect: a.is_correct ?? null,
          skipped: Boolean(a.skipped),
          timedOut: Boolean(a.timed_out),
          timeMs: num(a.time_taken_ms),
          excluded: Boolean(a.excluded),
        })),
      }
    : null;
  const earlier = (Array.isArray(r.earlier) ? r.earlier : [])
    .filter((e) => typeof e.bank_question_id === "string")
    .map((e) => ({ bankQuestionId: e.bank_question_id!, isCorrect: e.is_correct ?? null, skipped: Boolean(e.skipped) }));
  return { paper: { questions, minutes, marks_correct: right, marks_wrong: wrong }, previous: prev, earlier };
}

export async function fetchSessionAnalysisContext(sessionId: string): Promise<SessionAnalysisContext | null> {
  const { data, error } = await supabase.rpc("rpc_session_analysis_context", { _session_id: sessionId });
  if (error) throw new Error(error.message);
  return readSessionAnalysisContext(data);
}
