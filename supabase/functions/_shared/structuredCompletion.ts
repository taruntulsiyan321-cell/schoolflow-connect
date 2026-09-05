/**
 * Structured JSON completion — OpenRouter (Qwen) is the only LLM provider.
 * Replaces the old Gemini-backed gemini.ts with the identical public API
 * (StructuredAiRequest / GenerateStructuredOptions / AiResult /
 * generateStructured / generateJsonRelaxed / generateStructuredWithFallback /
 * corsHeaders / jsonResponse) so every existing caller needed zero changes
 * beyond its import path. The actual HTTP call, retry/backoff, and error
 * classification are all delegated to modelRouter.ts's completeWithQwen —
 * no second fetch-to-a-provider implementation, no duplicate retry logic.
 *
 * Gemini's native responseSchema enforcement has no OpenRouter/Qwen
 * equivalent, so the schema is folded into the prompt as an instruction and
 * the model's text output is parsed as JSON. generateStructuredWithFallback
 * keeps its two-attempt shape (strict instruction, then a more emphatic
 * "ONLY JSON" retry) for resilience against a model that ignores formatting
 * instructions once — not a multi-model cascade, since there is only one
 * provider now.
 */

import { completeWithQwen } from "./modelRouter.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export type StructuredAiRequest = {
  system: string;
  user: string;
  /** JSON Schema object (properties + required) — folded into the prompt as
   *  an instruction; OpenRouter/Qwen chat completions has no native
   *  responseSchema enforcement, so this is advisory, not enforced. */
  schema: Record<string, unknown>;
  /** Retained for caller-compatibility with the pre-migration signature; unused. */
  toolName?: string;
};

export type GenerateStructuredOptions = {
  /** Retained for caller-compatibility; ignored — OpenRouter/Qwen is the
   *  only provider now, so there is no model list to fall back across. */
  models?: string[];
  temperature?: number;
  max_tokens?: number;
};

export type AiResult<T> =
  | { ok: true; data: T; source: "openrouter_qwen" }
  | { ok: false; error: string; status: number };

const DEFAULT_MAX_TOKENS = 1200;

function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed) as T;
}

async function callStructured<T>(
  req: StructuredAiRequest,
  opts: GenerateStructuredOptions | undefined,
  jsonInstruction: string,
): Promise<AiResult<T>> {
  const system =
    `${req.system}\n\n${jsonInstruction}\n` +
    `Respond with ONLY a single JSON object matching this shape (no markdown fences, no commentary): ` +
    JSON.stringify(req.schema);

  const result = await completeWithQwen({
    system,
    user: req.user,
    temperature: opts?.temperature ?? 0.4,
    max_tokens: opts?.max_tokens ?? DEFAULT_MAX_TOKENS,
  });

  if (!result.ok) {
    const billing = /openrouter_billing|insufficient.?credits/i.test(result.error);
    return {
      ok: false,
      error: result.error,
      status: billing ? 503 : result.recovery_stage === "safe_fail" ? 503 : 502,
    };
  }

  try {
    return { ok: true, data: extractJson<T>(result.text), source: "openrouter_qwen" };
  } catch {
    return { ok: false, error: "Model returned invalid JSON", status: 502 };
  }
}

export async function generateStructured<T>(
  req: StructuredAiRequest,
  opts?: GenerateStructuredOptions,
): Promise<AiResult<T>> {
  return callStructured<T>(req, opts, "Return strict, schema-conformant JSON.");
}

export async function generateJsonRelaxed<T>(
  req: StructuredAiRequest,
  opts?: GenerateStructuredOptions,
): Promise<AiResult<T>> {
  return callStructured<T>(
    req,
    opts,
    "Respond with ONLY valid JSON matching the requested shape. No markdown fences, no commentary.",
  );
}

/** Strict attempt, then one relaxed retry if the model's output didn't parse. */
export async function generateStructuredWithFallback<T>(
  req: StructuredAiRequest,
  opts?: GenerateStructuredOptions,
): Promise<AiResult<T>> {
  const strict = await generateStructured<T>(req, opts);
  if (strict.ok) return strict;
  if (strict.error !== "Model returned invalid JSON") return strict;
  return generateJsonRelaxed<T>(req, opts);
}
