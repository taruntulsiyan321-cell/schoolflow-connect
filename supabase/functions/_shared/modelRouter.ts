/**
 * Model Router — OpenRouter, Nemotron 3 Ultra (free, primary) → Qwen 3.7 Flash (paid, fallback).
 * Credentials live exclusively here (edge secrets). Never expose to clients.
 * Adaptive Reasoning Budget ceilings applied via max_tokens / temperature.
 * Prompt Library v1 supplies versioned system/user contracts when available.
 * Enterprise Failure Recovery wraps transient provider calls AND now drives the
 * primary→fallback model switch via its existing (previously unused) fallback stage —
 * no new retry/classification logic, just wiring a second model into what was already there.
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

/**
 * Primary: Nemotron 3 Ultra 550B (free) — used until its daily free-credit allowance runs out.
 * Fallback: Qwen 3.7 Flash (paid) — used for the rest of that day once Nemotron is exhausted.
 * Both configurable so a live account/provider change never needs a code deploy.
 */
const PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const FALLBACK_MODEL = "qwen/qwen3.7-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ModelRouterResult =
  | {
      ok: true;
      text: string;
      model_id: string;
      source: "openrouter_nemotron" | "openrouter_qwen";
      budget_tier?: ReasoningTier;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      recovery_attempts?: number;
      fallback_used?: boolean;
    }
  | {
      ok: false;
      error: string;
      degraded: true;
      budget_tier?: ReasoningTier;
      recovery_stage?: string;
      recovery_attempts?: number;
      fallback_used?: boolean;
    };

export function isOpenRouterConfigured(): boolean {
  const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  return key.trim().length > 0;
}

export function getPrimaryModelId(): string {
  return Deno.env.get("OPENROUTER_PRIMARY_MODEL")?.trim() || PRIMARY_MODEL;
}

/** Fallback model — used once the primary's daily allowance is exhausted for a given request. */
export function getConfiguredModelId(): string {
  return Deno.env.get("OPENROUTER_MODEL")?.trim() || FALLBACK_MODEL;
}

async function invokeOpenRouterOnce(input: {
  model: string;
  is_primary: boolean;
  system: string;
  user: string;
  /** Data-URI images (never a stored/public URL — kept ephemeral, sent inline only). */
  images?: string[];
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

  const userContent = input.images?.length
    ? [
        { type: "text", text: input.user },
        ...input.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ]
    : input.user;

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
        model: input.model,
        temperature: input.temperature,
        max_tokens: input.max_tokens,
        // Both configured models are reasoning-capable and can burn their whole max_tokens
        // budget on internal "thinking" before ever writing to `content` if left enabled —
        // verified live per-model: with reasoning on, a 250-token budget produced content:null
        // (finish_reason "length", tokens spent entirely on the reasoning trace); disabled, the
        // same prompt returned real content, at a fraction of the cost for Qwen specifically.
        // App-facing replies never need the reasoning trace, only the final answer.
        reasoning: { enabled: false },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const billing =
        res.status === 402 ||
        /insufficient.?credits|payment.?required|billing/i.test(body);
      return {
        ok: false,
        error: billing
          ? `openrouter_billing: OpenRouter ${res.status} (credits/billing) on ${input.model}`
          : `OpenRouter error ${res.status} on ${input.model}: ${body.slice(0, 200)}`,
        degraded: true,
        budget_tier: input.budget_tier,
        recovery_stage: billing ? "safe_fail" : undefined,
      };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return {
        ok: false,
        error: `Empty model response from ${input.model}`,
        degraded: true,
        budget_tier: input.budget_tier,
      };
    }

    return {
      ok: true,
      text: text.trim(),
      model_id: input.model,
      source: input.is_primary ? "openrouter_nemotron" : "openrouter_qwen",
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
 * Tries the primary model (Nemotron) first, with the existing bounded/jittered transient-retry
 * policy; if it's still failing once retries are exhausted AND the failure is quota/availability
 * shaped (429/5xx/timeout — never a plain 400 from our own malformed request, which retrying
 * against a different model would not fix), falls back to Qwen exactly once. No further fallback
 * beyond that — a straight two-step chain, never a retry loop between the two models.
 */
export async function completeWithQwen(input: {
  system: string;
  user: string;
  /** Data-URI images — routes straight to Qwen; Nemotron 3 Ultra is text-only (verified against
   * OpenRouter's /models: input_modalities: ["text"]), so trying it first would just waste a
   * round-trip and always fail. */
  images?: string[];
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

  if (input.images?.length) {
    const visionModel = getConfiguredModelId();
    const visionAttempt = await withRetry(
      () =>
        invokeOpenRouterOnce({
          model: visionModel,
          is_primary: false,
          system: input.system,
          user: input.user,
          images: input.images,
          max_tokens,
          temperature,
          budget_tier: input.budget_tier,
        }),
      {
        policy: DEFAULT_PROVIDER_RETRY,
        isSuccess: (r) => r.ok === true,
        mapError: (r) => (r.ok ? "ok" : r.error),
        has_approved_fallback: false,
        queue_eligible: false,
      },
    );
    if (visionAttempt.ok) {
      return { ...visionAttempt.value, recovery_attempts: visionAttempt.attempts, fallback_used: true };
    }
    const plan =
      visionAttempt.plan ?? planFailureRecovery({ error: visionAttempt.error, attempt: visionAttempt.attempts });
    const errMsg =
      typeof visionAttempt.error === "string"
        ? visionAttempt.error
        : visionAttempt.error instanceof Error
        ? visionAttempt.error.message
        : "Model router failure";
    return {
      ok: false,
      error: errMsg,
      degraded: true,
      budget_tier: input.budget_tier,
      recovery_stage: plan.next_stage,
      recovery_attempts: visionAttempt.attempts,
      fallback_used: true,
    };
  }

  const primaryModel = getPrimaryModelId();
  const primaryAttempt = await withRetry(
    () =>
      invokeOpenRouterOnce({
        model: primaryModel,
        is_primary: true,
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
      // A real fallback model now exists — let a transient/quota-exhausted primary hand off.
      has_approved_fallback: true,
      queue_eligible: false,
    },
  );

  if (primaryAttempt.ok) {
    return { ...primaryAttempt.value, recovery_attempts: primaryAttempt.attempts, fallback_used: false };
  }

  const primaryPlan =
    primaryAttempt.plan ??
    planFailureRecovery({
      error: primaryAttempt.error,
      attempt: primaryAttempt.attempts,
      has_approved_fallback: true,
    });

  const primaryErrMsg =
    typeof primaryAttempt.error === "string"
      ? primaryAttempt.error
      : primaryAttempt.error instanceof Error
      ? primaryAttempt.error.message
      : "Model router failure";

  if (primaryPlan.next_stage !== "fallback") {
    // Not a quota/availability issue with the primary specifically (e.g. a malformed request
    // or a permanently invalid key) — switching models on the same account would not fix this.
    return {
      ok: false,
      error: primaryErrMsg,
      degraded: true,
      budget_tier: input.budget_tier,
      recovery_stage: primaryPlan.next_stage,
      recovery_attempts: primaryAttempt.attempts,
      fallback_used: false,
    };
  }

  const fallbackModel = getConfiguredModelId();
  const fallbackAttempt = await withRetry(
    () =>
      invokeOpenRouterOnce({
        model: fallbackModel,
        is_primary: false,
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
      // No further fallback beyond Qwen — prevents a primary<->fallback ping-pong loop.
      has_approved_fallback: false,
      queue_eligible: false,
    },
  );

  if (fallbackAttempt.ok) {
    return {
      ...fallbackAttempt.value,
      recovery_attempts: primaryAttempt.attempts + fallbackAttempt.attempts,
      fallback_used: true,
    };
  }

  const fallbackPlan =
    fallbackAttempt.plan ??
    planFailureRecovery({ error: fallbackAttempt.error, attempt: fallbackAttempt.attempts });
  const fallbackErrMsg =
    typeof fallbackAttempt.error === "string"
      ? fallbackAttempt.error
      : fallbackAttempt.error instanceof Error
      ? fallbackAttempt.error.message
      : "Model router failure";

  return {
    ok: false,
    error: `primary(${primaryModel}): ${primaryErrMsg}; fallback(${fallbackModel}): ${fallbackErrMsg}`,
    degraded: true,
    budget_tier: input.budget_tier,
    recovery_stage: fallbackPlan.next_stage,
    recovery_attempts: primaryAttempt.attempts + fallbackAttempt.attempts,
    fallback_used: true,
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
  /** Data-URI images — forces routing to the vision-capable model regardless of primary/fallback. */
  images?: string[];
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
    images: input.images,
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
