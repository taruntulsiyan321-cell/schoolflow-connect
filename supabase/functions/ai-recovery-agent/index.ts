import { corsHeaders, jsonResponse } from "./gemini.ts";
import { handleRecoveryAgentRequest } from "../_shared/recoveryAgent.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    return await handleRecoveryAgentRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
