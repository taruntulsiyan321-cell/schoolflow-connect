import { corsHeaders, jsonResponse } from "./gemini.ts";
import { handleRevisionAgentRequest } from "../_shared/revisionAgent.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    return await handleRevisionAgentRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
