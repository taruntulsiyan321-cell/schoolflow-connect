// Deep mistake analytics — analyses each wrong answer via Gemini.
import { corsHeaders, jsonResponse } from "./gemini.ts";
import { handleMistakeAnalyticsRequest } from "../_shared/mistakeAnalytics.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  try {
    const body = await req.json();
    return await handleMistakeAnalyticsRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
