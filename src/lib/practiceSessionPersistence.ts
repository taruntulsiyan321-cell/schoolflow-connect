import { supabase } from "@/integrations/supabase/client";
import type { PracticeAttemptSnapshot, PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";
export type { PracticeAttemptSnapshot };
import { attemptsToFinishPayload, persistAndGoToPracticeResult } from "@/lib/practiceSessionSnapshot";

export type RecordPracticeAttemptOptions = {
  sessionId: string;
  templateId?: string | null;
  bankQuestionId?: string | null;
  subject: string;
  chapter: string;
  concept?: string;
  generatedQuestion: {
    question: string;
    options: string[];
    values?: Record<string, unknown>;
    session_seed?: number;
    explanation?: string;
  };
  correctIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
  score?: number;
  timeTakenMs?: number;
};

/** Go to results immediately; sync to Supabase in the background. */
export function completePracticeSession(
  nav: (path: string, opts?: { replace?: boolean; state?: PracticeSessionResultState }) => void,
  sessionId: string,
  state: PracticeSessionResultState,
) {
  persistAndGoToPracticeResult(nav, sessionId, state);
  void syncPracticeSessionToServer(sessionId, state);
}

async function syncPracticeSessionToServer(sessionId: string, state: PracticeSessionResultState) {
  const correct = state.attempts.filter((a) => a.isCorrect).length;

  try {
    const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
    const ctx = await resolveStudentServiceContext();
    await PracticeService.finish(ctx, {
      _session_id: sessionId,
      _attempts: attemptsToFinishPayload(state.attempts),
    });
  } catch {
    const { error: finErr } = await supabase.rpc("rpc_finish_practice_session", {
      _session_id: sessionId,
      _attempts: attemptsToFinishPayload(state.attempts),
    } as {
      _session_id: string;
      _attempts: ReturnType<typeof attemptsToFinishPayload>;
    });
    if (finErr) {
      console.error("practice finish failed", finErr.message ?? finErr);
    }
    await (supabase.rpc("emit_academic_event", {
      _event_type: "practice.session.completed",
      _entity_type: "practice",
      _entity_id: sessionId,
      _school_id: null,
      _student_id: null,
      _class_id: null,
      _teacher_id: null,
      _payload: { session_id: sessionId, correct },
    } as any) as unknown as Promise<unknown>).catch(() => undefined);
  }

  await (
    (supabase.rpc as any)(
      "rpc_post_assessment_concept_analysis",
      {
        _source_type: "practice_session",
        _source_id: sessionId,
      },
    ) as Promise<unknown>
  ).catch(() => undefined);
}

export async function recordPracticeAttemptBestEffort(opts: RecordPracticeAttemptOptions) {
  const correctText = opts.generatedQuestion.options[opts.correctIndex] ?? "";
  const selectedText = opts.generatedQuestion.options[opts.selectedIndex] ?? "";
  const correctAnswer = { index: opts.correctIndex, text: correctText };
  const selectedAnswer = { index: opts.selectedIndex, text: selectedText };
  const score = opts.score ?? (opts.isCorrect ? 1 : 0);
  const bankQuestionId = opts.bankQuestionId ?? null;
  const generatedQuestion = {
    ...opts.generatedQuestion,
    bank_question_id: bankQuestionId,
  };

  try {
    const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
    const ctx = await resolveStudentServiceContext();
    await PracticeService.recordAttempt(ctx, {
      sessionId: opts.sessionId,
      templateId: opts.templateId ?? null,
      bankQuestionId,
      generatedQuestion,
      selectedAnswer,
      correctAnswer,
      isCorrect: opts.isCorrect,
      score,
      timeTakenMs: opts.timeTakenMs ?? null,
      subject: opts.subject,
      chapter: opts.chapter,
      concept: opts.concept ?? opts.chapter,
      source: "practice",
    });
    return { ok: true as const };
  } catch {
    // fall through to direct RPC for older sessions / context bootstrap gaps
  }

  // Server grades when bank_question_id is set; never insert rows directly (RLS write denied).
  const currentRpc = await supabase.rpc("rpc_record_question_attempt", {
    _correct_answer: correctAnswer,
    _generated_question: generatedQuestion,
    _is_correct: opts.isCorrect,
    _selected_answer: selectedAnswer,
    _session_id: opts.sessionId,
    _score: score,
    _skipped: false,
    _template_id: opts.templateId ?? null,
    _time_taken_ms: opts.timeTakenMs ?? null,
    _bank_question_id: bankQuestionId,
  } as any);
  if (!currentRpc.error) return { ok: true as const };

  // Legacy migration signature (no bank_question_id arg) — still no client table insert.
  const legacyRpc = await supabase.rpc("rpc_record_question_attempt", {
    _session_id: opts.sessionId,
    _template_id: opts.templateId ?? null,
    _generated_question: generatedQuestion,
    _correct_answer: correctAnswer,
    _selected_answer: selectedAnswer,
    _is_correct: opts.isCorrect,
    _score: score,
  } as any);
  if (!legacyRpc.error) return { ok: true as const };

  return {
    ok: false as const,
    error: legacyRpc.error ?? currentRpc.error,
  };
}
