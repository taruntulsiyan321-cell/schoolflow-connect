/**
 * Google Gemini Flash — primary AI provider for all edge functions.
 * Set GOOGLE_GEMINI_API_KEY (or GEMINI_API_KEY) in Supabase Edge Function secrets.
 * Falls back to Lovable AI Gateway if only LOVABLE_API_KEY is set.
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
  /** Tool name when using Lovable OpenAI-compatible gateway */
  toolName: string;
};

type AiConfig =
  | { provider: "google"; apiKey: string; model: string }
  | { provider: "lovable"; apiKey: string; model: string };

export function getAiConfig(): AiConfig | null {
  const googleKey =
    Deno.env.get("GOOGLE_GEMINI_API_KEY")?.trim() ||
    Deno.env.get("GEMINI_API_KEY")?.trim() ||
    "";
  const lovableKey = Deno.env.get("LOVABLE_API_KEY")?.trim() || "";
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.0-flash";

  if (googleKey) return { provider: "google", apiKey: googleKey, model };
  if (lovableKey) return { provider: "lovable", apiKey: lovableKey, model: "google/gemini-2.5-flash" };
  return null;
}

export type AiResult<T> =
  | { ok: true; data: T; source: "gemini" | "lovable" }
  | { ok: false; error: string; status: number };

async function callGoogleGemini<T>(
  cfg: Extract<AiConfig, { provider: "google" }>,
  req: StructuredAiRequest,
): Promise<AiResult<T>> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

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

async function callLovableGateway<T>(
  cfg: Extract<AiConfig, { provider: "lovable" }>,
  req: StructuredAiRequest,
): Promise<AiResult<T>> {
  const tool = {
    type: "function",
    function: {
      name: req.toolName,
      description: "Structured AI output",
      parameters: req.schema,
    },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: req.toolName } },
    }),
  });

  if (res.status === 429) {
    return { ok: false, error: "Rate limit — try again shortly.", status: 429 };
  }
  if (res.status === 402) {
    return { ok: false, error: "AI credits exhausted.", status: 402 };
  }
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `AI gateway error: ${txt.slice(0, 300)}`, status: 502 };
  }

  const data = await res.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments;
  if (!args) {
    return { ok: false, error: "AI returned no structured output", status: 502 };
  }

  const parsed = typeof args === "string" ? JSON.parse(args) : args;
  return { ok: true, data: parsed as T, source: "lovable" };
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

  if (cfg.provider === "google") {
    return callGoogleGemini<T>(cfg, req);
  }
  return callLovableGateway<T>(cfg, req);
}
