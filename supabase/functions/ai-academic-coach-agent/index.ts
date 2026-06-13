import { corsHeaders, jsonResponse } from "./gemini.ts";
import { handleAcademicCoachRequest } from "../_shared/academicCoachAgent.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    return await handleAcademicCoachRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
