/**
 * Connection-only OpenRouter ping — no product AI features.
 * Staff-only (admin | principal) to prevent JWT-any credit burn.
 *
 * Secrets: OPENROUTER_API_KEY (required), OPENROUTER_MODEL (optional).
 */
import { corsHeaders, jsonResponse } from "../_shared/gemini.ts";
import { requireAnyRole } from "../_shared/requireRole.ts";
import {
  completeWithQwen,
  getConfiguredModelId,
  isOpenRouterConfigured,
} from "../_shared/modelRouter.ts";

const PING_USER = "Reply with exactly: pong";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const __auth = await requireAnyRole(req, ["admin", "principal"]);
  if (!__auth.ok) return __auth.response;

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (!isOpenRouterConfigured()) {
    return jsonResponse(
      {
        ok: false,
        error: "OPENROUTER_API_KEY not configured",
        model_id: getConfiguredModelId(),
      },
      503,
    );
  }

  const result = await completeWithQwen({
    system: "You are a connectivity probe. Obey the user literally.",
    user: PING_USER,
    max_tokens: 16,
    temperature: 0,
  });

  if (!result.ok) {
    return jsonResponse(
      {
        ok: false,
        error: result.error,
        model_id: getConfiguredModelId(),
        degraded: true,
      },
      502,
    );
  }

  return jsonResponse({
    ok: true,
    text: result.text,
    model_id: result.model_id,
    source: result.source,
    usage: result.usage ?? null,
  });
});