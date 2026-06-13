import { corsHeaders, jsonResponse } from "./gemini.ts";
import { handleLearningPatternRequest } from "../_shared/learningPatternAgent.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    return await handleLearningPatternRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
