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
  targetStudentId?: string,
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
    // S-05 fix: a parent's session must not be bound to an arbitrary child's
    // school when they have more than one. If the request names a specific
    // child (target_refs.studentId), resolve the school from THAT child --
    // after verifying the parent is actually linked to them, via either
    // linking mechanism this schema uses (students.parent_user_id or the
    // parent_students join table; a parent record can exist under either).
    if (targetStudentId) {
      const { data: directChild } = await admin
        .from("students")
        .select("school_id, parent_user_id")
        .eq("id", targetStudentId)
        .maybeSingle();
      if (directChild?.parent_user_id === userId && directChild.school_id) {
        return { userId, role, schoolId: String(directChild.school_id), studentId: String(targetStudentId) };
      }
      const { data: linkedChild } = await admin
        .from("parent_students")
        .select("student_id, school_id, parents!inner(user_id)")
        .eq("student_id", targetStudentId)
        .eq("parents.user_id", userId)
        .maybeSingle();
      if (linkedChild?.school_id) {
        return { userId, role, schoolId: String(linkedChild.school_id), studentId: String(targetStudentId) };
      }
      // Named a child this parent isn't actually linked to -- do not fall
      // through to picking a different, unrelated child's school instead.
      return null;
    }

    // No specific child named: keep prior behavior for the common case (a
    // parent with exactly one child, or a general question not about any one
    // child in particular). A parent with multiple children across DIFFERENT
    // schools and no target specified remains an inherent ambiguity this
    // fallback can't resolve correctly either way -- fixing that properly
    // means requiring the client to always specify target_refs.studentId for
    // multi-child parents, which is a product decision, not a silent code
    // change made here.
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

  // admin / principal — require bound school_id (never fall back to an arbitrary school)
  const { data: profile } = await admin
    .from("profiles")
    .select("school_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.school_id) return null;
  return {
    userId,
    role,
    schoolId: String(profile.school_id),
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
    const body = await req.json().catch(() => ({}));
    // Parsed early (before resolveActor) so a parent's session can be bound to
    // the school of the specific child being asked about, rather than an
    // arbitrary one -- see resolveActor's parent branch below.
    const early_target_student_id =
      body.target_refs?.studentId ??
      body.target_refs?.student_id ??
      body.student_id ??
      undefined;
    const actor = await resolveActor(
      admin,
      userData.user.id,
      early_target_student_id ? String(early_target_student_id) : undefined,
    );
    if (!actor) {
      return json({ error: "Unable to resolve actor tenant/role", error_code: "actor_unresolved" }, 403);
    }

    const feature_id = String(body.feature_id ?? "").trim();
    if (!feature_id) {
      return json({ error: "feature_id is required", error_code: "invalid_envelope" }, 400);
    }

    // Embedding batch: honor gateway kill switch; tenant-scoped via worker filter.
    if (feature_id === "system.embedding.process_batch") {
      if (actor.role !== "admin" && actor.role !== "principal") {
        return json(
          { error: "Only admin/principal may process embedding jobs", error_code: "role_not_allowed" },
          403,
        );
      }
      const { data: gwFlag, error: gwFlagErr } = await admin
        .from("ai_feature_flags")
        .select("enabled")
        .eq("flag_key", "ai.gateway.enabled")
        .is("school_id", null)
        .maybeSingle();
      if (gwFlagErr || !gwFlag || gwFlag.enabled !== true) {
        return json(
          {
            error: "AI Gateway is temporarily disabled",
            error_code: "gateway_disabled",
            decision: "kill_switch",
          },
          503,
        );
      }
      const limit = Math.min(50, Math.max(1, Number(body.limit ?? body.input?.structured?.limit ?? 10)));
      const batch = await processEmbeddingJobsBatch(admin, limit, {
        schoolId: actor.schoolId,
      });
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
        // User JWT — never open as bare service_role (shared synthetic actor).
        const { data: opened, error: openErr } = await userClient.rpc(
          "ai_session_memory_open",
          {
            p_school_id: actor.schoolId,
            p_workflow_scope: scope,
            p_capability_id: feature_id,
            p_workflow_id: body.workflow_id ? String(body.workflow_id) : null,
            p_target_student_id: target_student_id ? String(target_student_id) : null,
            p_ttl_minutes: 120,
            p_summary: {},
          },
        );
        if (openErr) {
          console.error("ai_session_memory_open failed", openErr.message ?? openErr);
        } else if (opened?.session_id) {
          session_id = String(opened.session_id);
        }
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
      locale: body.locale ? String(body.locale) : undefined,
      actor,
    });

    // Prefer router session_patch (outline/marking flags); fall back to compact patch.
    let sessionPersistFailed = false;
    if (session_id && isSessionMemoryAllowed(feature_id) && result.decision !== "permission_denied") {
      const fromRouter =
        result.data &&
        typeof result.data === "object" &&
        "session_patch" in (result.data as object) &&
        typeof (result.data as { session_patch?: unknown }).session_patch === "object"
          ? ((result.data as { session_patch: Record<string, unknown> }).session_patch)
          : null;
      const patch =
        fromRouter ??
        buildSessionSummaryPatch({
          last_feature_id: feature_id,
          last_decision: result.decision,
          plan_hash:
            result.data &&
            typeof result.data === "object" &&
            "plan_hash" in (result.data as object)
              ? String((result.data as { plan_hash?: string }).plan_hash)
              : undefined,
        });
      const { error: appendErr } = await userClient.rpc("ai_session_memory_append", {
        p_session_id: session_id,
        p_summary_patch: patch,
        p_increment_turn: true,
      });
      if (appendErr) {
        sessionPersistFailed = true;
        console.error("ai_session_memory_append failed", appendErr.message ?? appendErr);
      }
    }

    const status =
      result.decision === "permission_denied"
        ? 403
        : result.decision === "rejected"
          ? 400
          : result.decision === "kill_switch"
            ? 503
            : 200;

    const payload =
      session_id || sessionPersistFailed
        ? {
            ...result,
            ...(session_id ? { session_id } : {}),
            ...(sessionPersistFailed ? { session_persist_failed: true } : {}),
          }
        : result;

    return json(payload, status);
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
