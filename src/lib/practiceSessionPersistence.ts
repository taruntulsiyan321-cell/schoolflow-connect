import { supabase } from "@/integrations/supabase/client";
import type { PracticeAttemptSnapshot, PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";
import { attemptsToFinishPayload, persistAndGoToPracticeResult } from "@/lib/practiceSessionSnapshot";

export type RecordPracticeAttemptOptions = {
  sessionId: string;
  templateId?: string | null;
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
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return;

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const { count: existing } = await supabase
    .from("question_attempts")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (!existing && state.attempts.length > 0) {
    const rows = state.attempts.map((a) => ({
      session_id: sessionId,
      user_id: userId,
      student_id: student?.id ?? null,
      template_id: null as string | null,
      generated_question: {
        question: a.question,
        options: a.options,
        explanation: a.explanation ?? "",
      },
      selected_answer: { index: a.selectedIndex, text: a.options[a.selectedIndex] ?? "" },
      correct_answer: { index: a.correctIndex, text: a.options[a.correctIndex] ?? "" },
      is_correct: a.isCorrect,
      score: a.isCorrect ? 1 : 0,
      subject: state.subject,
      chapter: state.chapter,
      concept: state.chapter,
    }));

    const { error: insErr } = await supabase.from("question_attempts").insert(rows);
    if (insErr) {
      await tryLegacyRecordRpc(sessionId, state.attempts);
    }

    const correct = state.attempts.filter((a) => a.isCorrect).length;
    await supabase
      .from("practice_sessions")
      .update({ correct_count: correct, score: correct })
      .eq("id", sessionId)
      .eq("user_id", userId);
  }

  const correct = state.attempts.filter((a) => a.isCorrect).length;

  try {
    const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
    const ctx = await resolveStudentServiceContext();
    try {
      await PracticeService.finish(ctx, { _session_id: sessionId });
    } catch {
      await PracticeService.finish(ctx, {
        _session_id: sessionId,
        _attempts: attemptsToFinishPayload(state.attempts),
      });
    }
  } catch {
    const { error: fin1 } = await supabase.rpc("rpc_finish_practice_session", {
      _session_id: sessionId,
    });
    if (fin1) {
      await supabase.rpc("rpc_finish_practice_session", {
        _session_id: sessionId,
        _attempts: attemptsToFinishPayload(state.attempts),
      } as { _session_id: string; _attempts: ReturnType<typeof attemptsToFinishPayload> });
    }
    await supabase.rpc("emit_academic_event", {
      _event_type: "practice.session.completed",
      _entity_type: "practice",
      _entity_id: sessionId,
      _school_id: null,
      _student_id: null,
      _class_id: null,
      _teacher_id: null,
      _payload: { session_id: sessionId, correct },
    }).catch(() => undefined);
  }

  await (supabase as any).rpc("rpc_post_assessment_concept_analysis", {
    _source_type: "practice_session",
    _source_id: sessionId,
  }).catch(() => undefined);

  void correct;
}

export async function recordPracticeAttemptBestEffort(opts: RecordPracticeAttemptOptions) {
  const correctText = opts.generatedQuestion.options[opts.correctIndex] ?? "";
  const selectedText = opts.generatedQuestion.options[opts.selectedIndex] ?? "";
  const correctAnswer = { index: opts.correctIndex, text: correctText };
  const selectedAnswer = { index: opts.selectedIndex, text: selectedText };
  const score = opts.score ?? (opts.isCorrect ? 1 : 0);

  // Current migration signature. Named args allow old clients to survive SQL param order changes.
  const currentRpc = await supabase.rpc("rpc_record_question_attempt", {
    _correct_answer: correctAnswer,
    _generated_question: opts.generatedQuestion,
    _is_correct: opts.isCorrect,
    _selected_answer: selectedAnswer,
    _session_id: opts.sessionId,
    _score: score,
    _skipped: false,
    _template_id: opts.templateId ?? null,
    _time_taken_ms: opts.timeTakenMs ?? null,
  } as {
    _correct_answer: object;
    _generated_question: object;
    _is_correct: boolean;
    _selected_answer: object;
    _session_id: string;
    _score: number;
    _skipped: boolean;
    _template_id: string | null;
    _time_taken_ms: number | null;
  });
  if (!currentRpc.error) return { ok: true as const };

  // Legacy migration signature used by older Supabase projects.
  const legacyRpc = await supabase.rpc("rpc_record_question_attempt", {
    _session_id: opts.sessionId,
    _template_id: opts.templateId ?? null,
    _generated_question: opts.generatedQuestion,
    _correct_answer: correctAnswer,
    _selected_answer: selectedAnswer,
    _is_correct: opts.isCorrect,
    _score: score,
  } as {
    _session_id: string;
    _template_id: string | null;
    _generated_question: object;
    _correct_answer: object;
    _selected_answer: object;
    _is_correct: boolean;
    _score: number;
  });
  if (!legacyRpc.error) return { ok: true as const };

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    return { ok: false as const, error: legacyRpc.error ?? currentRpc.error };
  }

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const direct = await supabase.from("question_attempts").insert({
    session_id: opts.sessionId,
    user_id: userId,
    student_id: student?.id ?? null,
    template_id: null,
    generated_question: opts.generatedQuestion,
    selected_answer: selectedAnswer,
    correct_answer: correctAnswer,
    is_correct: opts.isCorrect,
    score,
    time_taken_ms: opts.timeTakenMs ?? null,
    skipped: false,
    subject: opts.subject,
    chapter: opts.chapter,
    concept: opts.concept ?? opts.chapter,
    subconcept: opts.concept ?? opts.chapter,
    difficulty: "medium",
  } as {
    session_id: string;
    user_id: string;
    student_id: string | null;
    template_id: null;
    generated_question: object;
    selected_answer: object;
    correct_answer: object;
    is_correct: boolean;
    score: number;
    time_taken_ms: number | null;
    skipped: boolean;
    subject: string;
    chapter: string;
    concept: string;
    subconcept: string;
    difficulty: string;
  });

  if (!direct.error) return { ok: true as const };
  return { ok: false as const, error: direct.error };
}

async function tryLegacyRecordRpc(sessionId: string, attempts: PracticeAttemptSnapshot[]) {
  for (const a of attempts) {
    await supabase.rpc("rpc_record_question_attempt", {
      _session_id: sessionId,
      _template_id: null,
      _generated_question: {
        question: a.question,
        options: a.options,
        explanation: a.explanation ?? "",
      },
      _correct_answer: { index: a.correctIndex, text: a.options[a.correctIndex] ?? "" },
      _selected_answer: { index: a.selectedIndex, text: a.options[a.selectedIndex] ?? "" },
      _is_correct: a.isCorrect,
      _score: a.isCorrect ? 1 : 0,
    } as {
      _session_id: string;
      _template_id: null;
      _generated_question: object;
      _correct_answer: object;
      _selected_answer: object;
      _is_correct: boolean;
      _score: number;
    });
  }
}
