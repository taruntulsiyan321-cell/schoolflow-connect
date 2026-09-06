// embed — turn one query string into one embedding vector. Nothing else.
//
// WHY THIS EXISTS. `match_question_bank` takes a PRE-COMPUTED vector
// (p_query_embedding). A browser cannot produce one: the embedding key is a
// server secret and `_shared/embeddingProvider.ts` was bundled only by
// `ai-gateway`. That is the whole of what blocked MCQ retrieval.
//
// WHY IT IS ITS OWN FUNCTION, and not a mode on `dpp-generate-questions`:
// adding a mode there changes that function's bundle and falsifies its
// README's byte-parity claim against deployed v12. And not an `ai-gateway`
// slice, because ai-gateway carries 49 undispositioned hunks and is frozen.
// Embedding is shared infrastructure — retrieval, duplicate detection and any
// future search all need it — so it earns a function.
//
// WHAT IT BUNDLES. `_shared/embeddingProvider.ts`, which has ZERO imports of
// its own, plus `_shared/requireRole.ts` -> `_shared/requireAuth.ts` for the
// standard auth posture. It deliberately does NOT import
// `_shared/structuredCompletion.ts` for `corsHeaders`/`jsonResponse`: that
// module is DRIFTED against production (repo d5fb667140a7 / prod d0fd90b22cb8)
// and pulling it in would ship drift into a brand-new function. Both helpers
// are eight lines, so they are inlined below.
//
// embeddingProvider.ts was confirmed byte-identical to the deployed copy
// (2026-09-06) before being bundled — compared against ai-gateway's deployment
// with newlines normalised, the same way `check:edge-drift` hashes.
//
// NEVER FAKES A VECTOR. Every failure path returns an error; none returns a
// zero vector or a random one. A caller that gets no embedding is expected to
// fall through to lexical retrieval, exactly as when none is supplied.
import { embedQueryText } from "../_shared/embeddingProvider.ts";
import { requireAnyRole, getCallerSchoolId } from "../_shared/requireRole.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Same posture as dpp-generate-questions. Students are NOT admitted here:
  // KNOWN_ISSUES 2 rules that students should reach question generation, but
  // that ruling is about generation and widening this gate is a separate
  // decision, not one to take in passing.
  const auth = await requireAnyRole(req, ["teacher", "admin", "principal"]);
  if (!auth.ok) return auth.response;

  const schoolId = await getCallerSchoolId(auth.value.user.id);
  if (!schoolId) return jsonResponse({ error: "No school context for caller" }, 403);

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? body?.query ?? "");
  } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400);
  }
  if (!text.trim()) return jsonResponse({ error: "Provide `text` to embed" }, 400);

  // An embedding is a paid provider call, so it is metered like one. Its own
  // feature_id keeps it separable from generation in `ai_budget_usage`; an
  // unconfigured feature_id falls back to the school's daily quota rather than
  // failing, so nothing needs seeding first. 1 unit, against generation's 2.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: budget, error: budgetErr } = await admin.rpc("ai_budget_check_and_reserve", {
    p_school_id: schoolId,
    p_feature_id: "staff.embed.query",
    p_units: 1,
  });
  // A budget that could not be READ is not a budget that was EXCEEDED. Saying
  // "you are out of budget" when the reservation call itself failed sends the
  // teacher to look at the wrong thing.
  if (budgetErr) {
    return jsonResponse(
      { error: "Could not check the AI budget", error_code: "budget_check_failed", detail: budgetErr.message },
      503,
    );
  }
  if (!budget || (budget as { ok?: boolean }).ok === false) {
    return jsonResponse(
      {
        error: "Daily AI budget for this school has been reached",
        error_code: (budget as { error_code?: string })?.error_code ?? "budget_exhausted",
      },
      429,
    );
  }

  const result = await embedQueryText(text, { env: Deno.env.toObject() });
  if (!result.ok) {
    // 502: the provider, not the caller, is what failed. `embedding_provider_unset`
    // is a deployment problem and must not read as a bad request.
    return jsonResponse({ error: result.error, error_code: "embedding_failed" }, 502);
  }

  return jsonResponse({
    ok: true,
    embedding: result.embedding,
    dims: result.embedding.length,
    model: result.model,
    provider: result.provider,
  });
});
