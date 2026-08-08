import { corsHeaders, jsonResponse } from "../_shared/structuredCompletion.ts";
import { handleRevisionAgentRequest } from "../_shared/revisionAgent.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;
  try {
    const body = await req.json();
    return await handleRevisionAgentRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
