/**
 * Model Router — OpenRouter → Qwen only.
 * Credentials live exclusively here (edge secrets). Never expose to clients.
 */

const DEFAULT_MODEL = "qwen/qwen-2.5-72b-instruct";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ModelRouterResult =
  | { ok: true; text: string; model_id: string; source: "openrouter_qwen" }
  | { ok: false; error: string; degraded: true };

export function isOpenRouterConfigured(): boolean {
  const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  return key.trim().length > 0;
}

export function getConfiguredModelId(): string {
  return Deno.env.get("OPENROUTER_MODEL")?.trim() || DEFAULT_MODEL;
}

/**
 * Bounded chat completion. Returns degraded error when key missing — callers must fail safe.
 */
export async function completeWithQwen(input: {
  system: string;
  user: string;
  max_tokens?: number;
  temperature?: number;
}): Promise<ModelRouterResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENROUTER_API_KEY not configured — generative path degraded",
      degraded: true,
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
        temperature: input.temperature ?? 0.2,
        max_tokens: input.max_tokens ?? 500,
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
      };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, error: "Empty model response", degraded: true };
    }

    return { ok: true, text: text.trim(), model_id: model, source: "openrouter_qwen" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Model router failure",
      degraded: true,
    };
  }
}
