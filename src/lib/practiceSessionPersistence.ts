import { supabase } from "@/integrations/supabase/client";
import type { PracticeAttemptSnapshot, PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";
import { attemptsToFinishPayload, persistAndGoToPracticeResult } from "@/lib/practiceSessionSnapshot";

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

  const { error: fin1 } = await supabase.rpc("rpc_finish_practice_session", {
    _session_id: sessionId,
  });
  if (fin1) {
    await supabase.rpc("rpc_finish_practice_session", {
      _session_id: sessionId,
      _attempts: attemptsToFinishPayload(state.attempts),
    } as { _session_id: string; _attempts: ReturnType<typeof attemptsToFinishPayload> });
  }

  if (!fin1 && state.attempts.length > 0) {
    await (supabase as any).rpc("rpc_post_assessment_concept_analysis", {
      _source_type: "practice_session",
      _source_id: sessionId,
    });
  }

  void correct;
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
