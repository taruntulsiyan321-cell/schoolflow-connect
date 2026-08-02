/**
 * Gurukul AI Gateway — sole entry for student/parent academic AI Q&A.
 * Binds tenant + actor from session; delegates to AI Router.
 * Clients must never call OpenRouter/Qwen directly.
 *
 * Invoke:
 *   POST /functions/v1/ai-gateway
 *   Authorization: Bearer <user_jwt>
 *   Body: { feature_id, input?: { text }, target_refs?: { studentId }, intent_hint?, channel? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { routeAiRequest, type RouterActor } from "../_shared/aiRouter.ts";
import type { AiActorRole } from "../_shared/capabilityCatalog.ts";
import {
  isSessionMemoryAllowed,
  sessionScopeForCapability,
  buildSessionSummaryPatch,
} from "../_shared/sessionMemory.ts";
import { processEmbeddingJobsBatch } from "../_shared/embeddingWorker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveActor(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<RouterActor | null> {
  // Valid app_role only — never super_admin
  const roles = ["admin", "principal", "teacher", "student", "parent"] as const;
  let role: AiActorRole | null = null;
  for (const r of roles) {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: r });
    if (data) {
      role = r;
      break;
    }
  }
  if (!role) return null;

  if (role === "student") {
    const { data: student } = await admin
      .from("students")
      .select("id, school_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!student?.school_id) return null;
    return {
      userId,
      role,
      schoolId: String(student.school_id),
      studentId: String(student.id),
    };
  }

  if (role === "parent") {
    const { data: parent } = await admin
      .from("parents")
      .select("id, school_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent?.school_id) {
      return {
        userId,
        role,
        schoolId: String(parent.school_id),
        studentId: null,
      };
    }
    const { data: child } = await admin
      .from("students")
      .select("school_id")
      .eq("parent_user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!child?.school_id) return null;
    return {
      userId,
      role,
      schoolId: String(child.school_id),
      studentId: null,
    };
  }

  if (role === "teacher") {
    const { data: teacher } = await admin
      .from("teachers")
      .select("id, school_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!teacher?.school_id) return null;
    return {
      userId,
      role,
      schoolId: String(teacher.school_id),
      studentId: null,
    };
  }

  // admin / principal — school from profiles or first school membership
  const { data: profile } = await admin
    .from("profiles")
    .select("school_id")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.school_id) {
    return {
      userId,
      role,
      schoolId: String(profile.school_id),
      studentId: null,
    };
  }

  const { data: school } = await admin.from("schools").select("id").limit(1).maybeSingle();
  if (!school?.id) return null;
  return {
    userId,
    role,
    schoolId: String(school.id),
    studentId: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Not authenticated", error_code: "unauthenticated" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated", error_code: "unauthenticated" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const actor = await resolveActor(admin, userData.user.id);
    if (!actor) {
      return json({ error: "Unable to resolve actor tenant/role", error_code: "actor_unresolved" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const feature_id = String(body.feature_id ?? "").trim();
    if (!feature_id) {
      return json({ error: "feature_id is required", error_code: "invalid_envelope" }, 400);
    }

    // Cron / admin: process embedding jobs (never invents vectors when key unset)
    if (feature_id === "system.embedding.process_batch") {
      if (actor.role !== "admin" && actor.role !== "principal") {
        return json(
          { error: "Only admin/principal may process embedding jobs", error_code: "role_not_allowed" },
          403,
        );
      }
      const limit = Math.min(50, Math.max(1, Number(body.limit ?? body.input?.structured?.limit ?? 10)));
      const batch = await processEmbeddingJobsBatch(admin, limit);
      return json({
        request_id: crypto.randomUUID(),
        feature_id,
        decision: "answered_deterministic",
        route_class: "deterministic_insight",
        used_model: false,
        cache_hit: false,
        data: batch,
      });
    }

    // Clients must not override tenant/actor
    if (body.tenant_id != null && String(body.tenant_id) !== actor.schoolId) {
      return json({ error: "Clients may not override tenant_id", error_code: "tenant_forge" }, 400);
    }
    if (body.actor?.userId != null && String(body.actor.userId) !== actor.userId) {
      return json({ error: "Clients may not override actor identity", error_code: "actor_forge" }, 400);
    }

    const request_id =
      typeof body.request_id === "string" && body.request_id.trim()
        ? String(body.request_id)
        : crypto.randomUUID();

    const target_student_id =
      body.target_refs?.studentId ??
      body.target_refs?.student_id ??
      body.student_id ??
      undefined;

    let session_id =
      typeof body.session_id === "string" && body.session_id.trim()
        ? String(body.session_id).trim()
        : undefined;

    // Multi-turn: open short workflow session when requested and capability allows
    const want_session =
      body.open_session === true ||
      body.input?.structured?.open_session === true ||
      (typeof body.session_scope === "string" && body.session_scope.length > 0);

    if (!session_id && want_session && isSessionMemoryAllowed(feature_id)) {
      const scope =
        (typeof body.session_scope === "string" && body.session_scope) ||
        sessionScopeForCapability(feature_id);
      if (scope) {
        const { data: opened } = await admin.rpc("ai_session_memory_open", {
          p_school_id: actor.schoolId,
          p_workflow_scope: scope,
          p_capability_id: feature_id,
          p_workflow_id: body.workflow_id ? String(body.workflow_id) : null,
          p_target_student_id: target_student_id ? String(target_student_id) : null,
          p_ttl_minutes: 120,
          p_summary: {},
        });
        if (opened?.session_id) session_id = String(opened.session_id);
      }
    }

    const input_structured =
      body.input?.structured && typeof body.input.structured === "object"
        ? (body.input.structured as Record<string, unknown>)
        : undefined;

    const result = await routeAiRequest(userClient, admin, {
      request_id,
      feature_id,
      intent_hint: body.intent_hint ? String(body.intent_hint) : undefined,
      input_text: body.input?.text ? String(body.input.text) : undefined,
      input_structured,
      target_student_id: target_student_id ? String(target_student_id) : undefined,
      session_id,
      actor,
    });

    // Append compact session summary after multi-turn intents (never raw chat)
    if (session_id && isSessionMemoryAllowed(feature_id) && result.decision !== "permission_denied") {
      const patch = buildSessionSummaryPatch({
        last_feature_id: feature_id,
        last_decision: result.decision,
        plan_hash:
          result.data &&
          typeof result.data === "object" &&
          "plan_hash" in (result.data as object)
            ? String((result.data as { plan_hash?: string }).plan_hash)
            : undefined,
      });
      await admin
        .rpc("ai_session_memory_append", {
          p_session_id: session_id,
          p_summary_patch: patch,
          p_increment_turn: true,
        })
        .catch(() => undefined);
    }

    const status =
      result.decision === "permission_denied"
        ? 403
        : result.decision === "rejected"
          ? 400
          : result.decision === "kill_switch"
            ? 503
            : 200;

    return json(
      session_id ? { ...result, session_id } : result,
      status,
    );
  } catch (e) {
    return json(
      {
        error: e instanceof Error ? e.message : "Gateway failure",
        error_code: "gateway_failure",
      },
      500,
    );
  }
});
