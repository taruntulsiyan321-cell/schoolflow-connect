/**
 * Model Router — OpenRouter → Qwen only.
 * Credentials live exclusively here (edge secrets). Never expose to clients.
 * Adaptive Reasoning Budget ceilings applied via max_tokens / temperature.
 * Prompt Library v1 supplies versioned system/user contracts when available.
 * Enterprise Failure Recovery wraps transient provider calls.
 */

import {
  modelCallOptionsForTier,
  type ReasoningTier,
} from "./reasoningBudget.ts";
import {
  loadProductionPrompt,
  loadShadowPrompt,
  renderPromptTemplate,
  type PromptRecord,
} from "./promptLibrary.ts";
import {
  withRetry,
  planFailureRecovery,
  DEFAULT_PROVIDER_RETRY,
} from "./failureRecovery.ts";
import { selectPromptWithShadow } from "./promptEvaluation.ts";

const DEFAULT_MODEL = "qwen/qwen-2.5-72b-instruct";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ModelRouterResult =
  | {
      ok: true;
      text: string;
      model_id: string;
      source: "openrouter_qwen";
      budget_tier?: ReasoningTier;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      recovery_attempts?: number;
    }
  | {
      ok: false;
      error: string;
      degraded: true;
      budget_tier?: ReasoningTier;
      recovery_stage?: string;
      recovery_attempts?: number;
    };

export function isOpenRouterConfigured(): boolean {
  const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  return key.trim().length > 0;
}

export function getConfiguredModelId(): string {
  return Deno.env.get("OPENROUTER_MODEL")?.trim() || DEFAULT_MODEL;
}

async function invokeOpenRouterOnce(input: {
  system: string;
  user: string;
  max_tokens: number;
  temperature: number;
  budget_tier?: ReasoningTier;
}): Promise<ModelRouterResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENROUTER_API_KEY not configured — generative path degraded",
      degraded: true,
      budget_tier: input.budget_tier,
      recovery_stage: "safe_fail",
    };
  }

  const model = getConfiguredModelId();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL") ?? "https://gurukul.app",
        "X-Title": "Gurukul AI Gateway",
      },
      body: JSON.stringify({
        model,
        temperature: input.temperature,
        max_tokens: input.max_tokens,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `OpenRouter error ${res.status}: ${body.slice(0, 200)}`,
        degraded: true,
        budget_tier: input.budget_tier,
      };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return {
        ok: false,
        error: "Empty model response",
        degraded: true,
        budget_tier: input.budget_tier,
      };
    }

    return {
      ok: true,
      text: text.trim(),
      model_id: model,
      source: "openrouter_qwen",
      budget_tier: input.budget_tier,
      usage: json?.usage
        ? {
            prompt_tokens: json.usage.prompt_tokens,
            completion_tokens: json.usage.completion_tokens,
          }
        : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Model router failure",
      degraded: true,
      budget_tier: input.budget_tier,
    };
  }
}

/**
 * Bounded chat completion. Returns degraded error when key missing — callers must fail safe.
 * Transient provider errors retry with jitter via Failure Recovery.
 */
export async function completeWithQwen(input: {
  system: string;
  user: string;
  max_tokens?: number;
  temperature?: number;
  /** Adaptive Reasoning Budget tier — caps tokens/temperature when set. */
  budget_tier?: ReasoningTier;
}): Promise<ModelRouterResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENROUTER_API_KEY not configured — generative path degraded",
      degraded: true,
      budget_tier: input.budget_tier,
      recovery_stage: "safe_fail",
    };
  }

  const tierOpts = input.budget_tier ? modelCallOptionsForTier(input.budget_tier) : null;
  const max_tokens = input.max_tokens ?? tierOpts?.max_tokens ?? 500;
  const temperature = input.temperature ?? tierOpts?.temperature ?? 0.2;

  const retried = await withRetry(
    () =>
      invokeOpenRouterOnce({
        system: input.system,
        user: input.user,
        max_tokens,
        temperature,
        budget_tier: input.budget_tier,
      }),
    {
      policy: DEFAULT_PROVIDER_RETRY,
      isSuccess: (r) => r.ok === true,
      mapError: (r) => (r.ok ? "ok" : r.error),
      // Permanent config / auth errors should not burn retries
      has_approved_fallback: false,
      queue_eligible: false,
    },
  );

  if (retried.ok) {
    return { ...retried.value, recovery_attempts: retried.attempts };
  }

  const plan = retried.plan ?? planFailureRecovery({
    error: retried.error,
    attempt: retried.attempts,
  });
  const errMsg =
    typeof retried.error === "string"
      ? retried.error
      : retried.error instanceof Error
      ? retried.error.message
      : "Model router failure";

  return {
    ok: false,
    error: errMsg,
    degraded: true,
    budget_tier: input.budget_tier,
    recovery_stage: plan.next_stage,
    recovery_attempts: retried.attempts,
  };
}

/**
 * Complete using Prompt Library production (or shadow % traffic) contract.
 * Falls back to builtin templates when DB row is missing.
 */
export async function completeWithPromptLibrary(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  capability_id: string;
  vars: Record<string, string>;
  budget_tier?: ReasoningTier;
  max_tokens?: number;
  temperature?: number;
  request_id?: string | null;
  /** 0–100 from ai.prompt.shadow_traffic feature flag metadata. */
  shadow_percent?: number;
}): Promise<
  ModelRouterResult & {
    prompt?: PromptRecord;
    prompt_selected_status?: "production" | "shadow" | "builtin";
    shadow_sampled?: boolean;
  }
> {
  const production = await loadProductionPrompt(input.admin, input.capability_id);
  let shadow: PromptRecord | null = null;
  const shadowPct = input.shadow_percent ?? 0;
  if (shadowPct > 0) {
    shadow = await loadShadowPrompt(input.admin, input.capability_id);
  }
  const selected = selectPromptWithShadow({
    production,
    shadow,
    request_id: input.request_id,
    shadow_percent: shadowPct,
  });
  const prompt = selected.prompt;
  if (!prompt) {
    return {
      ok: false,
      error: "prompt_missing",
      degraded: true,
      budget_tier: input.budget_tier,
      prompt_selected_status: selected.selected_status,
      shadow_sampled: selected.shadow_sampled,
    };
  }
  const system = renderPromptTemplate(prompt.system_template, input.vars);
  const user = renderPromptTemplate(prompt.user_template, input.vars);
  const result = await completeWithQwen({
    system,
    user,
    budget_tier: input.budget_tier,
    max_tokens: input.max_tokens ?? prompt.max_output_tokens,
    temperature: input.temperature ?? prompt.temperature,
  });
  return {
    ...result,
    prompt,
    prompt_selected_status: selected.selected_status,
    shadow_sampled: selected.shadow_sampled,
  };
}
