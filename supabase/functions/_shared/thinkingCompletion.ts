/**
 * A completion that THINKS before it answers — for checking an answer, not for
 * talking to a student.
 *
 * modelRouter's completeWithQwen turns the model's reasoning OFF, rightly for
 * replies a student waits on. Checking a multiple-choice answer is the other
 * case: measured on the live rewrite 2026-10-02, the same Flash model with
 * reasoning off reached a wrong answer on correctly keyed Accountancy questions
 * it had to work through — a creditors' takeover, "overvalued by 25%", a
 * debenture discount write-off, goodwill with an abnormal loss, a takeover that
 * needs no entry. Here it thinks first, within a budget.
 *
 * Same model (getConfiguredModelId) and the same retry policy (withRetry) as
 * every other call. It lives apart from modelRouter so that changing how a
 * check is made does not redeploy every function that talks to students.
 * Used by the functions that check questions: question-explanations,
 * question-reports, and — through the quality gate (questionGate.ts) —
 * ai-practice and ai-recovery-variants.
 */
import { getConfiguredModelId } from "./modelRouter.ts";
import { DEFAULT_PROVIDER_RETRY, withRetry } from "./failureRecovery.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ThinkingResult =
  | { ok: true; text: string; finish_reason: string | null }
  | { ok: false; error: string };

export async function completeThinking(input: {
  system: string;
  user: string;
  /** Room for the thinking AND the answer. */
  max_tokens: number;
  /** The thinking's share of it. */
  reasoning_tokens: number;
  temperature?: number;
}): Promise<ThinkingResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not configured" };

  const once = async (): Promise<ThinkingResult> => {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL") ?? "https://gurukul.app",
        "X-Title": "Gurukul Answer Check",
      },
      body: JSON.stringify({
        model: getConfiguredModelId(),
        temperature: input.temperature ?? 0,
        max_tokens: input.max_tokens,
        reasoning: { max_tokens: input.reasoning_tokens },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    }).catch((e) => e as Error);
    if (res instanceof Error) return { ok: false, error: res.message };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `OpenRouter error ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = await res.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> }
      | null;
    const choice = json?.choices?.[0];
    const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    const text = choice?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, error: finish === "length" ? "cut off while thinking" : "empty model response" };
    }
    return { ok: true, text: text.trim(), finish_reason: finish };
  };

  const r = await withRetry(once, {
    policy: DEFAULT_PROVIDER_RETRY,
    isSuccess: (v) => v.ok,
    mapError: (v) => (v.ok ? "ok" : v.error),
  });
  return r.ok ? r.value : { ok: false, error: typeof r.error === "string" ? r.error : String(r.error) };
}
