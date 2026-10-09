/**
 * AI Practice from the app's side: ask the ai-practice function for a session
 * of what the student typed, and read back what they asked before.
 *
 * The function does the work (supabase/functions/ai-practice): the bank first,
 * then AI-written questions that pass the quality gate (an independent answer
 * check and a review against the rubric). A request that writes questions can
 * take most of a minute.
 */
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import type { PlanLimit } from "@/lib/premium";

/** The function's own limit (PROMPT_MAX_CHARS); aiPractice.client.test.ts pins the two. */
export const AI_PRACTICE_PROMPT_MAX = 500;
/** Long enough for the function's worst case: written, checked, stored. */
const REQUEST_TIMEOUT_MS = 150_000;

export type AIPracticeStatus = "ready" | "short" | "refused" | "failed";

export type AIPracticeResult = {
  status: AIPracticeStatus;
  requestId: string | null;
  questionIds: string[];
  fromBank: number;
  written: number;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  message: string | null;
};

type Wire = {
  status?: AIPracticeStatus;
  request_id?: string | null;
  question_ids?: string[];
  from_bank?: number;
  written?: number;
  subject?: string | null;
  chapter?: string | null;
  topic?: string | null;
  message?: string | null;
};

export async function requestAIPractice(prompt: string): Promise<
  { ok: true; result: AIPracticeResult } | { ok: false; error: string; planLimit: PlanLimit | null }
> {
  const { data, error, planLimit } = await invokeEdgeFunction<Wire>("ai-practice", { prompt }, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: "AI Practice took too long this time. Please try again.",
  });
  if (error || !data || !data.status) {
    return { ok: false, error: error ?? "AI Practice could not finish. Please try again.", planLimit: planLimit ?? null };
  }
  return {
    ok: true,
    result: {
      status: data.status,
      requestId: data.request_id ?? null,
      questionIds: Array.isArray(data.question_ids) ? data.question_ids.filter((id) => typeof id === "string") : [],
      fromBank: data.from_bank ?? 0,
      written: data.written ?? 0,
      subject: data.subject ?? null,
      chapter: data.chapter ?? null,
      topic: data.topic ?? null,
      message: data.message ?? null,
    },
  };
}

export type AIPracticeHistoryItem = { id: string; prompt: string; status: AIPracticeStatus; createdAt: string };

/** The student's own recent requests, newest first (RLS: theirs only). */
export async function listRecentAIPractice(userId: string, limit = 5): Promise<AIPracticeHistoryItem[]> {
  const { data, error } = await supabase
    .from("ai_practice_requests")
    .select("id, prompt, status, created_at")
    .eq("user_id", userId)
    .in("status", ["ready", "short"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({ id: r.id, prompt: r.prompt, status: r.status as AIPracticeStatus, createdAt: r.created_at }));
}
