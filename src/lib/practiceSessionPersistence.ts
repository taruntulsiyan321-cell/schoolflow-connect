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
  topic?: string;
  difficulty?: string;
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
  skipped?: boolean;
  score?: number;
  timeTakenMs?: number;
  hintUsed?: boolean;
  solutionViewed?: boolean;
  confidence?: number | null;
  attemptNumber?: number | null;
  timedOut?: boolean;
  practiceMode?: string;
  source?: string;
  sourceId?: string | null;
  classLevel?: number | null;
  board?: string | null;
  stream?: string | null;
  schoolId?: string | null;
  answeredAt?: string;
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

async function afterPracticeFinishFallback(sessionId: string, state: PracticeSessionResultState) {
  const correct = state.attempts.filter((a) => a.isCorrect).length;
  const skipped = state.attempts.filter((a) => a.skipped || a.timedOut).length;
  const wrong = state.attempts.filter((a) => !a.isCorrect && !a.skipped && !a.timedOut).length;
  const totalTimeMs = state.attempts.reduce((sum, a) => sum + (a.timeTakenMs ?? 0), 0);

  let schoolId: string | null = null;
  let studentId: string | null = null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (uid) {
      const { data: stu } = await supabase
        .from("students")
        .select("id, school_id")
        .eq("user_id", uid)
        .maybeSingle();
      schoolId = stu?.school_id ?? null;
      studentId = stu?.id ?? null;
    }
  } catch {
    /* best-effort identity for emit + bus */
  }

  await (supabase.rpc("emit_academic_event", {
    _event_type: "practice.session.completed",
    _entity_type: "practice",
    _entity_id: sessionId,
    _school_id: schoolId,
    _student_id: studentId,
    _class_id: null,
    _teacher_id: null,
    _payload: {
      session_id: sessionId,
      correct,
      skipped,
      wrong,
      total_time_ms: totalTimeMs,
      accuracy: state.attempts.length
        ? Math.round((correct / state.attempts.length) * 100)
        : 0,
      via: "practiceSessionPersistence.fallback",
    },
  } as never) as unknown as Promise<unknown>).catch(() => undefined);

  try {
    const { broadcastAcademicWrite } = await import("@/academic/live");
    const { notifyStudentXpUpdated } = await import("@/lib/studentXpNotify");
    broadcastAcademicWrite(schoolId, ["xp", "profile"], {
      studentId,
      source: "practiceSessionPersistence.fallback",
    });
    notifyStudentXpUpdated();
  } catch {
    /* live bus optional in non-browser contexts */
  }
}

async function syncPracticeSessionToServer(sessionId: string, state: PracticeSessionResultState) {
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
    } else {
      // RPC awarded progression; still emit + broadcast so panels refresh.
      await afterPracticeFinishFallback(sessionId, state);
    }
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
  const correctAnswer = { index: opts.correctIndex, correct_index: opts.correctIndex, text: correctText };
  const selectedAnswer = {
    index: opts.selectedIndex,
    selected_index: opts.selectedIndex,
    text: selectedText,
  };
  const skipped = Boolean(opts.skipped || opts.timedOut);
  const score = opts.score ?? (opts.isCorrect && !skipped ? 1 : 0);
  const bankQuestionId = opts.bankQuestionId ?? null;
  const generatedQuestion = {
    ...opts.generatedQuestion,
    bank_question_id: bankQuestionId,
    subject: opts.subject,
    chapter: opts.chapter,
    concept: opts.concept ?? opts.chapter,
    topic: opts.topic ?? opts.concept ?? opts.chapter,
    difficulty: opts.difficulty,
    practice_mode: opts.practiceMode ?? opts.source ?? "practice",
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
      skipped,
      subject: opts.subject,
      chapter: opts.chapter,
      concept: opts.concept ?? opts.chapter,
      topic: opts.topic ?? opts.concept ?? opts.chapter,
      difficulty: opts.difficulty,
      hintUsed: opts.hintUsed ?? false,
      solutionViewed: opts.solutionViewed ?? false,
      confidence: opts.confidence ?? null,
      attemptNumber: opts.attemptNumber ?? null,
      timedOut: opts.timedOut ?? false,
      practiceMode: opts.practiceMode ?? opts.source ?? "practice",
      source: opts.source ?? "practice",
      sourceId: opts.sourceId ?? opts.sessionId,
      classLevel: opts.classLevel ?? null,
      board: opts.board ?? null,
      stream: opts.stream ?? null,
      schoolId: opts.schoolId ?? null,
      answeredAt: opts.answeredAt ?? new Date().toISOString(),
    });
    return { ok: true as const };
  } catch {
    // fall through to direct RPC for older sessions / context bootstrap gaps
  }

  // Server grades when bank_question_id is set; never insert rows directly (RLS write denied).
  const meta = {
    solution_viewed: opts.solutionViewed ?? false,
    confidence: opts.confidence ?? null,
    attempt_number: opts.attemptNumber ?? null,
    timed_out: opts.timedOut ?? false,
    practice_mode: opts.practiceMode ?? opts.source ?? "practice",
    source_id: opts.sourceId ?? opts.sessionId,
    class_level: opts.classLevel ?? null,
    board: opts.board ?? null,
    stream: opts.stream ?? null,
    topic: opts.topic ?? opts.concept ?? opts.chapter ?? null,
    difficulty: opts.difficulty ?? null,
    school_id: opts.schoolId ?? null,
    answered_at: opts.answeredAt ?? new Date().toISOString(),
    hint_used: opts.hintUsed ?? false,
  };
  const currentRpc = await supabase.rpc("rpc_record_question_attempt", {
    _correct_answer: correctAnswer,
    _generated_question: generatedQuestion,
    _is_correct: skipped ? false : opts.isCorrect,
    _selected_answer: selectedAnswer,
    _session_id: opts.sessionId,
    _score: score,
    _skipped: skipped,
    _template_id: opts.templateId ?? null,
    _time_taken_ms: opts.timeTakenMs ?? null,
    _bank_question_id: bankQuestionId,
    _hint_used: opts.hintUsed ?? false,
    _source: opts.source ?? "practice",
    _meta: meta,
  } as any);
  if (!currentRpc.error) return { ok: true as const };

  const withHint = await supabase.rpc("rpc_record_question_attempt", {
    _correct_answer: correctAnswer,
    _generated_question: generatedQuestion,
    _is_correct: skipped ? false : opts.isCorrect,
    _selected_answer: selectedAnswer,
    _session_id: opts.sessionId,
    _score: score,
    _skipped: skipped,
    _template_id: opts.templateId ?? null,
    _time_taken_ms: opts.timeTakenMs ?? null,
    _bank_question_id: bankQuestionId,
    _hint_used: opts.hintUsed ?? false,
    _source: opts.source ?? "practice",
  } as any);
  if (!withHint.error) return { ok: true as const };

  // Legacy migration signature (no bank_question_id arg) — still no client table insert.
  const legacyRpc = await supabase.rpc("rpc_record_question_attempt", {
    _session_id: opts.sessionId,
    _template_id: opts.templateId ?? null,
    _generated_question: generatedQuestion,
    _correct_answer: correctAnswer,
    _selected_answer: selectedAnswer,
    _is_correct: skipped ? false : opts.isCorrect,
    _score: score,
  } as any);
  if (!legacyRpc.error) return { ok: true as const };

  return {
    ok: false as const,
    error: legacyRpc.error ?? withHint.error ?? currentRpc.error,
  };
}
