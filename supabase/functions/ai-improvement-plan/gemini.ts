/**
 * Google Gemini Flash — primary AI provider for all edge functions.
 * Deploy: GitHub Action deploy-edge-functions.yml (SUPABASE_ACCESS_TOKEN).
 * Requires GOOGLE_GEMINI_API_KEY (or GEMINI_API_KEY) in Edge Function secrets.
 */

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
  /** JSON Schema object (properties + required) for structured output */
  schema: Record<string, unknown>;
  /** Tool name retained for caller compatibility. */
  toolName: string;
};

type AiConfig = { provider: "google"; apiKey: string; models: string[] };

export function getAiConfig(): AiConfig | null {
  const googleKey =
    Deno.env.get("GOOGLE_GEMINI_API_KEY")?.trim() ||
    Deno.env.get("GEMINI_API_KEY")?.trim() ||
    "";
  const primaryModel = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.0-flash";
  const configuredFallbacks = (Deno.env.get("GEMINI_FALLBACK_MODELS") ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = Array.from(new Set([
    primaryModel,
    ...configuredFallbacks,
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
  ]));

  if (googleKey) return { provider: "google", apiKey: googleKey, models };
  return null;
}

export type AiResult<T> =
  | { ok: true; data: T; source: "gemini" }
  | { ok: false; error: string; status: number };

async function callGoogleGemini<T>(
  cfg: Extract<AiConfig, { provider: "google" }>,
  model: string,
  req: StructuredAiRequest,
): Promise<AiResult<T>> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: req.schema,
        temperature: 0.35,
      },
    }),
  });

  if (res.status === 429) {
    return { ok: false, error: "Gemini rate limit — try again in a moment.", status: 429 };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Gemini API ${res.status}: ${txt.slice(0, 300)}`, status: 502 };
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return { ok: false, error: "Gemini returned no content", status: 502 };
  }

  try {
    const parsed = JSON.parse(text) as T;
    return { ok: true, data: parsed, source: "gemini" };
  } catch {
    return { ok: false, error: "Gemini returned invalid JSON", status: 502 };
  }
}

export async function generateStructured<T>(req: StructuredAiRequest): Promise<AiResult<T>> {
  const cfg = getAiConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "AI not configured — add GOOGLE_GEMINI_API_KEY to Supabase Edge Function secrets (Google AI Studio).",
      status: 503,
    };
  }

  let lastRateLimit: AiResult<T> | null = null;
  for (const model of cfg.models) {
    const result = await callGoogleGemini<T>(cfg, model, req);
    if (result.ok) return result;
    if (result.status !== 429 && !result.error.includes("NOT_FOUND")) return result;
    lastRateLimit = result;
  }

  return lastRateLimit ?? { ok: false, error: "Gemini rate limit — try again in a moment.", status: 429 };
}
