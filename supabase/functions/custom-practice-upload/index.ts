/**
 * custom-practice-upload — classify + extract a student's private upload.
 *
 * Binding: docs/custom-practice-upload-spec.md §4–§7
 *
 * WHY NOT ai-gateway: production holds two _shared modules that exist in no
 * branch (KNOWN_ISSUES edge-drift). A new function avoids that blocker (§13).
 *
 * §4.1 The refusal is the feature. This stub NEVER invents questions. Until
 * the classifier model path is measured (§13), an upload is marked failed
 * with an honest reason — not unusable-with-fake-confidence.
 */
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth.response;

  let uploadId = "";
  try {
    const body = await req.json();
    uploadId = typeof body?.upload_id === "string" ? body.upload_id.trim() : "";
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!uploadId) return jsonResponse({ error: "upload_id_required" }, 400);

  const userClient = auth.value.userClient;
  const uid = auth.value.user.id;

  const { data: upload, error: loadErr } = await userClient
    .from("student_uploads")
    .select("id, owner_id, school_id, status")
    .eq("id", uploadId)
    .eq("owner_id", uid)
    .maybeSingle();

  if (loadErr) return jsonResponse({ error: loadErr.message }, 500);
  if (!upload) return jsonResponse({ error: "not_found" }, 404);

  // Individuals only (§11). School kind is on schools.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: school } = await admin
    .from("schools")
    .select("kind")
    .eq("id", upload.school_id)
    .maybeSingle();
  if (school?.kind !== "individual") {
    return jsonResponse({ error: "individual_accounts_only" }, 403);
  }

  await userClient
    .from("student_uploads")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", uploadId)
    .eq("owner_id", uid);

  // §13 — model path not yet measured. Fail honestly; do not invent questions (§4.1).
  const reason =
    "The upload classifier is not configured in this environment yet. Your file is saved; try again when classification is live.";

  const { error: updErr } = await userClient
    .from("student_uploads")
    .update({
      status: "failed",
      refusal_reason: reason,
      verdict: null,
      confidence: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId)
    .eq("owner_id", uid);

  if (updErr) return jsonResponse({ error: updErr.message }, 500);

  return jsonResponse({
    ok: false,
    upload_id: uploadId,
    status: "failed",
    error: reason,
    // Positive control for clients: no questions were written.
    questions_written: 0,
    notes_written: 0,
  });
});
