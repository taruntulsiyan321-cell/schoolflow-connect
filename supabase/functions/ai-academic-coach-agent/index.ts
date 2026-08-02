import { corsHeaders, jsonResponse } from "./gemini.ts";
import { handleAcademicCoachRequest } from "../_shared/academicCoachAgent.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;
  try {
    const body = await req.json();
    return await handleAcademicCoachRequest(body ?? {});
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
