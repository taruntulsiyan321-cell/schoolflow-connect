/**
 * AI Router — deterministic → EIE → cache → model-last.
 * Never asks an LLM whether to use an LLM.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getCapability,
  isModelAllowed,
  type AiActorRole,
  type CapabilityDefinition,
} from "./capabilityCatalog.ts";
import { completeWithQwen, isOpenRouterConfigured } from "./modelRouter.ts";
import { buildEieProjection } from "./eieProjection.ts";
import { buildContextPack, packForModel } from "./contextBuilder.ts";
import {
  evidenceFromExplainFacts,
  validateModelResponse,
} from "./responseValidator.ts";
import { applyConfidencePolicy, scoreConfidence } from "./confidenceEngine.ts";
import { estimateUnitsForTier, type BudgetCheckResult } from "./budgetQuotas.ts";
import { buildParentScheduledNarrative } from "./parentNarrative.ts";
import type { ReasoningTier } from "./reasoningBudget.ts";

export type KillSwitches = {
  gatewayEnabled: boolean;
  deterministicEnabled: boolean;
  generativeEnabled: boolean;
};

export type RouterActor = {
  userId: string;
  role: AiActorRole;
  schoolId: string;
  studentId: string | null;
};

export type RouterRequest = {
  request_id: string;
  feature_id: string;
  intent_hint?: string;
  input_text?: string;
  target_student_id?: string;
  actor: RouterActor;
};

export type RouterResponse = {
  request_id: string;
  feature_id: string;
  decision: string;
  route_class: string;
  used_model: boolean;
  cache_hit: boolean;
  data: unknown;
  message?: string;
  provenance?: Record<string, unknown>;
  error_code?: string;
  model_id?: string;
  kill_switch_hit?: string;
  confidence?: number;
  budget_tier?: ReasoningTier;
};

const l1 = new Map<string, { value: unknown; expiresAt: number }>();

function l1Get(key: string): unknown | null {
  const hit = l1.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    l1.delete(key);
    return null;
  }
  return hit.value;
}

function l1Set(key: string, value: unknown, ttlMs = 60_000) {
  l1.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function loadKillSwitches(
  admin: SupabaseClient,
  schoolId: string | null,
): Promise<KillSwitches> {
  const { data } = await admin
    .from("ai_feature_flags")
    .select("flag_key, enabled, school_id")
    .in("flag_key", ["ai.gateway.enabled", "ai.deterministic.enabled", "ai.generative.enabled"]);

  const flags = data ?? [];
  const read = (key: string, fallback: boolean): boolean => {
    const schoolRow = schoolId
      ? flags.find((f) => f.flag_key === key && f.school_id === schoolId)
      : null;
    if (schoolRow) return !!schoolRow.enabled;
    const global = flags.find((f) => f.flag_key === key && f.school_id == null);
    return global ? !!global.enabled : fallback;
  };

  return {
    gatewayEnabled: read("ai.gateway.enabled", true),
    deterministicEnabled: read("ai.deterministic.enabled", true),
    generativeEnabled: read("ai.generative.enabled", true),
  };
}

export async function writeDecision(
  admin: SupabaseClient,
  row: {
    request_id: string;
    school_id: string | null;
    actor_user_id: string;
    actor_role: string;
    feature_id: string;
    route_class: string;
    decision: string;
    used_model: boolean;
    model_id?: string | null;
    cache_hit: boolean;
    kill_switch_hit?: string | null;
    latency_ms?: number;
    error_code?: string | null;
    evidence?: Record<string, unknown>;
    confidence?: number | null;
    budget_tier?: string | null;
    validation_ok?: boolean | null;
    estimated_cost_units?: number | null;
  },
): Promise<void> {
  await admin.from("ai_request_decisions").upsert(
    {
      request_id: row.request_id,
      school_id: row.school_id,
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      feature_id: row.feature_id,
      route_class: row.route_class,
      decision: row.decision,
      used_model: row.used_model,
      model_id: row.model_id ?? null,
      cache_hit: row.cache_hit,
      kill_switch_hit: row.kill_switch_hit ?? null,
      latency_ms: row.latency_ms ?? null,
      error_code: row.error_code ?? null,
      evidence: row.evidence ?? {},
      confidence: row.confidence ?? null,
      budget_tier: row.budget_tier ?? null,
      validation_ok: row.validation_ok ?? null,
      estimated_cost_units: row.estimated_cost_units ?? 0,
    },
    { onConflict: "request_id" },
  );
}

async function reserveBudget(
  admin: SupabaseClient,
  schoolId: string,
  featureId: string,
  units: number,
): Promise<BudgetCheckResult> {
  const { data, error } = await admin.rpc("ai_budget_check_and_reserve", {
    p_school_id: schoolId,
    p_feature_id: featureId,
    p_units: units,
  });
  if (error || !data) {
    // Stub-safe: if migration not applied yet, allow with soft_breach false
    return {
      ok: true,
      soft_breach: false,
      units_used: 0,
      soft_limit: 200,
      hard_limit: 400,
    };
  }
  const row = data as Record<string, unknown>;
  if (row.ok === false) {
    return {
      ok: false,
      soft_breach: true,
      hard_breach: true,
      units_used: Number(row.units_used ?? 0),
      soft_limit: Number(row.soft_limit ?? 200),
      hard_limit: Number(row.hard_limit ?? 400),
      error_code: "budget_exhausted",
    };
  }
  return {
    ok: true,
    soft_breach: !!row.soft_breach,
    units_used: Number(row.units_used ?? 0),
    soft_limit: Number(row.soft_limit ?? 200),
    hard_limit: Number(row.hard_limit ?? 400),
  };
}

async function assertMayAccessStudent(
  userClient: SupabaseClient,
  admin: SupabaseClient,
  actor: RouterActor,
  studentId: string,
): Promise<void> {
  if (actor.role === "admin" || actor.role === "principal" || actor.role === "super_admin") {
    const { data } = await admin
      .from("students")
      .select("id")
      .eq("id", studentId)
      .eq("school_id", actor.schoolId)
      .maybeSingle();
    if (!data) throw new Error("permission_denied");
    return;
  }

  if (actor.role === "student") {
    if (actor.studentId && actor.studentId !== studentId) throw new Error("permission_denied");
    const { data } = await userClient
      .from("students")
      .select("id")
      .eq("id", studentId)
      .eq("user_id", actor.userId)
      .eq("school_id", actor.schoolId)
      .maybeSingle();
    if (!data) throw new Error("permission_denied");
    return;
  }

  if (actor.role === "parent") {
    const { data: byParentUser } = await admin
      .from("students")
      .select("id")
      .eq("id", studentId)
      .eq("school_id", actor.schoolId)
      .eq("parent_user_id", actor.userId)
      .maybeSingle();
    if (byParentUser) return;

    const { data: parentRow } = await admin
      .from("parents")
      .select("id")
      .eq("school_id", actor.schoolId)
      .eq("user_id", actor.userId)
      .maybeSingle();
    if (!parentRow?.id) throw new Error("permission_denied");

    const { data: link } = await admin
      .from("parent_students")
      .select("id")
      .eq("student_id", studentId)
      .eq("school_id", actor.schoolId)
      .eq("parent_id", parentRow.id)
      .maybeSingle();
    if (!link) throw new Error("permission_denied");
    return;
  }

  if (actor.role === "teacher") {
    const { data: student } = await admin
      .from("students")
      .select("id, class_id")
      .eq("id", studentId)
      .eq("school_id", actor.schoolId)
      .maybeSingle();
    if (!student?.class_id) throw new Error("permission_denied");
    const { data: teaches } = await admin.rpc("teacher_teaches_class", {
      _user_id: actor.userId,
      _class_id: student.class_id,
    });
    if (!teaches) throw new Error("permission_denied");
    return;
  }

  throw new Error("permission_denied");
}

function resolveStudentTarget(actor: RouterActor, target?: string): string {
  if (actor.role === "student") {
    if (!actor.studentId) throw new Error("student_identity_missing");
    if (target && target !== actor.studentId) throw new Error("permission_denied");
    return actor.studentId;
  }
  if (!target) throw new Error("student_target_required");
  return target;
}

function weekdayKey(d = new Date()): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] ?? "Mon";
}

async function fetchAttendance(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: rows } = await admin
    .from("attendance")
    .select("date, status")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .order("date", { ascending: false })
    .limit(120);

  const list = rows ?? [];
  const counts = { present: 0, absent: 0, late: 0, leave: 0, half_day: 0 };
  for (const r of list) {
    const s = String(r.status);
    if (s in counts) (counts as Record<string, number>)[s] += 1;
  }
  const total = list.length;
  const attendance_pct = total
    ? Math.round(((counts.present + counts.late * 0.5 + counts.half_day * 0.5) / total) * 1000) / 10
    : 0;
  const latest = list[0]?.date ? String(list[0].date) : null;
  return {
    projection: "StudentAttendanceQuery",
    version: 1,
    studentId,
    schoolId,
    ...counts,
    total_marked: total,
    attendance_pct,
    recent: list.slice(0, 14).map((r) => ({ date: String(r.date), status: String(r.status) })),
    source_as_of: latest,
    data_version: `att:${studentId}:${total}:${latest ?? "none"}`,
    completeness: total > 0 ? 1 : 0,
  };
}

async function fetchHomeworkDue(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: student } = await admin
    .from("students")
    .select("class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (!student?.class_id) {
    return {
      projection: "StudentHomeworkDue",
      version: 1,
      studentId,
      schoolId,
      due_soon: [],
      pending_count: 0,
      overdue_count: 0,
      source_as_of: null,
      data_version: `hw:${studentId}:0`,
      completeness: 0,
    };
  }

  const { data: homework } = await admin
    .from("homework")
    .select("id, title, subject, due_date, due_time, status")
    .eq("school_id", schoolId)
    .eq("class_id", student.class_id)
    .in("status", ["published", "active"])
    .order("due_date", { ascending: true })
    .limit(50);

  const hwIds = (homework ?? []).map((h) => h.id);
  const { data: subs } = hwIds.length
    ? await admin
        .from("homework_submissions")
        .select("homework_id, status")
        .eq("student_id", studentId)
        .in("homework_id", hwIds)
    : { data: [] as { homework_id: string; status: string }[] };

  const subMap = new Map((subs ?? []).map((s) => [String(s.homework_id), String(s.status)]));
  const due_soon = (homework ?? [])
    .filter((h) => {
      const st = subMap.get(String(h.id));
      return !st || ["pending", "returned", "draft"].includes(st);
    })
    .slice(0, 20)
    .map((h) => ({
      id: String(h.id),
      title: String(h.title),
      subject: String(h.subject),
      due_date: h.due_date ? String(h.due_date) : null,
      due_time: h.due_time ? String(h.due_time) : null,
      display_status: subMap.get(String(h.id)) ?? "pending",
    }));

  return {
    projection: "StudentHomeworkDue",
    version: 1,
    studentId,
    schoolId,
    due_soon,
    pending_count: due_soon.length,
    overdue_count: 0,
    source_as_of: due_soon[0]?.due_date ?? null,
    data_version: `hw:${studentId}:${due_soon.length}`,
    completeness: (homework ?? []).length > 0 ? 1 : 0.2,
  };
}

async function fetchMarksSummary(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: marks } = await admin
    .from("marks")
    .select("exam_id, marks_obtained")
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(100);

  const examIds = [...new Set((marks ?? []).map((m) => String(m.exam_id)))];
  const { data: exams } = examIds.length
    ? await admin
        .from("exams")
        .select("id, subject, max_marks, results_published_at")
        .eq("school_id", schoolId)
        .in("id", examIds)
    : { data: [] as { id: string; subject: string; max_marks: number; results_published_at: string | null }[] };

  const published = new Map(
    (exams ?? [])
      .filter((e) => e.results_published_at != null)
      .map((e) => [String(e.id), e]),
  );

  const bySubject = new Map<string, { sum: number; count: number }>();
  const recent: {
    examId: string;
    subject: string;
    marksObtained: number;
    maxMarks: number;
    pct: number;
  }[] = [];

  let exams_count = 0;
  for (const row of marks ?? []) {
    const exam = published.get(String(row.exam_id));
    if (!exam) continue;
    exams_count += 1;
    const max = Number(exam.max_marks) || 100;
    const obtained = Number(row.marks_obtained) || 0;
    const pct = Math.round((obtained / max) * 1000) / 10;
    const subject = String(exam.subject || "Subject");
    const cur = bySubject.get(subject) ?? { sum: 0, count: 0 };
    cur.sum += pct;
    cur.count += 1;
    bySubject.set(subject, cur);
    if (recent.length < 10) {
      recent.push({
        examId: String(exam.id),
        subject,
        marksObtained: obtained,
        maxMarks: max,
        pct,
      });
    }
  }

  const subjects = [...bySubject.entries()].map(([subject, v]) => ({
    subject,
    average_pct: Math.round((v.sum / v.count) * 10) / 10,
    count: v.count,
  }));
  const average_pct = subjects.length
    ? Math.round((subjects.reduce((s, x) => s + x.average_pct, 0) / subjects.length) * 10) / 10
    : null;

  return {
    projection: "StudentMarksSummary",
    version: 1,
    studentId,
    schoolId,
    exams_count,
    average_pct,
    subjects,
    recent,
    source_as_of: null,
    data_version: `marks:${studentId}:${exams_count}:${average_pct ?? "na"}`,
    completeness: exams_count > 0 ? 1 : 0,
  };
}

async function fetchTimetableToday(admin: SupabaseClient, schoolId: string, studentId: string) {
  const day = weekdayKey();
  const { data: student } = await admin
    .from("students")
    .select("class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (!student?.class_id) {
    return {
      projection: "StudentTimetableToday",
      version: 1,
      studentId,
      schoolId,
      classId: null,
      day_key: day,
      periods: [],
      has_timetable: false,
      source_as_of: null,
      data_version: `tt:${studentId}:none`,
      completeness: 0,
    };
  }

  const { data: tt } = await admin
    .from("class_timetables")
    .select("grid, updated_at")
    .eq("class_id", student.class_id)
    .maybeSingle();

  const grid = (tt?.grid ?? {}) as Record<string, string>;
  const periods = Object.entries(grid)
    .filter(([k, v]) => k.startsWith(`${day}-`) && String(v ?? "").trim())
    .map(([k, v]) => ({ period: k.slice(day.length + 1), subject: String(v).trim() }));

  return {
    projection: "StudentTimetableToday",
    version: 1,
    studentId,
    schoolId,
    classId: student.class_id,
    day_key: day,
    periods,
    has_timetable: periods.length > 0,
    source_as_of: tt?.updated_at ? String(tt.updated_at) : null,
    data_version: `tt:${student.class_id}:${day}:${periods.length}`,
    completeness: periods.length > 0 ? 1 : 0.1,
  };
}

async function fetchEie(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const userId = student?.user_id ? String(student.user_id) : null;
  let mastery: {
    subject: string;
    chapter?: string | null;
    concept: string;
    mastery_score: number;
    mistake_count?: number;
    updated_at?: string | null;
  }[] = [];
  let revision: {
    subject: string;
    chapter?: string | null;
    topic?: string | null;
    reason?: string | null;
    priority: number;
    due_date?: string | null;
    completed?: boolean;
  }[] = [];

  if (userId) {
    const { data: masteryRows } = await admin
      .from("concept_mastery")
      .select("subject, chapter, concept, mastery_score, mistake_count, updated_at")
      .eq("user_id", userId)
      .limit(200);
    mastery = (masteryRows ?? []) as typeof mastery;

    const { data: revRows } = await admin
      .from("revision_queue")
      .select("subject, chapter, topic, reason, priority, due_date, completed")
      .eq("user_id", userId)
      .eq("completed", false)
      .order("priority", { ascending: false })
      .limit(40);
    revision = (revRows ?? []) as typeof revision;
  }

  return buildEieProjection({ studentId, schoolId, mastery, revisionQueue: revision });
}

async function fetchParentSummary(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: profile } = await admin
    .from("student_academic_profiles")
    .select(
      "attendance_pct, homework_completion_pct, tests_avg_pct, exams_avg_pct, metrics, refreshed_at",
    )
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const metrics = (profile?.metrics ?? {}) as Record<string, unknown>;
  const weak = Array.isArray(metrics.weakTopics) ? metrics.weakTopics.map(String) : [];
  const strong = Array.isArray(metrics.strongTopics) ? metrics.strongTopics.map(String) : [];

  return {
    projection: "ParentChildSummary",
    version: 1,
    studentId,
    schoolId,
    attendance_pct: Number(profile?.attendance_pct ?? 0),
    homework_completion_pct: Number(profile?.homework_completion_pct ?? 0),
    tests_avg_pct: Number(profile?.tests_avg_pct ?? 0),
    exams_avg_pct: Number(profile?.exams_avg_pct ?? 0),
    weak_topics: weak,
    strong_topics: strong,
    source_as_of: profile?.refreshed_at ? String(profile.refreshed_at) : null,
    data_version: `parent:${studentId}:${profile?.refreshed_at ?? "none"}`,
    completeness: profile ? 1 : 0.3,
  };
}

async function readL2Cache(
  admin: SupabaseClient,
  schoolId: string,
  cacheKey: string,
): Promise<unknown | null> {
  const { data } = await admin
    .from("ai_solution_cache")
    .select("payload, expires_at")
    .eq("school_id", schoolId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(String(data.expires_at)).getTime() < Date.now()) return null;
  return data.payload;
}

async function writeL2Cache(
  admin: SupabaseClient,
  input: {
    schoolId: string;
    cacheKey: string;
    featureId: string;
    studentId: string;
    dataVersion: string;
    payload: unknown;
  },
): Promise<void> {
  await admin.from("ai_solution_cache").upsert(
    {
      school_id: input.schoolId,
      cache_key: input.cacheKey,
      feature_id: input.featureId,
      student_id: input.studentId,
      data_version: input.dataVersion,
      payload: input.payload,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    { onConflict: "school_id,cache_key" },
  );
}

export async function routeAiRequest(
  userClient: SupabaseClient,
  admin: SupabaseClient,
  req: RouterRequest,
): Promise<RouterResponse> {
  const started = Date.now();
  const flags = await loadKillSwitches(admin, req.actor.schoolId);

  const fail = async (
    partial: Partial<RouterResponse> & { decision: string; error_code: string },
  ): Promise<RouterResponse> => {
    const response: RouterResponse = {
      request_id: req.request_id,
      feature_id: req.feature_id,
      route_class: partial.route_class ?? "unsupported",
      used_model: false,
      cache_hit: false,
      data: null,
      message: partial.message,
      decision: partial.decision,
      error_code: partial.error_code,
      kill_switch_hit: partial.kill_switch_hit,
    };
    await writeDecision(admin, {
      request_id: req.request_id,
      school_id: req.actor.schoolId,
      actor_user_id: req.actor.userId,
      actor_role: req.actor.role,
      feature_id: req.feature_id,
      route_class: response.route_class,
      decision: response.decision,
      used_model: false,
      cache_hit: false,
      kill_switch_hit: response.kill_switch_hit,
      latency_ms: Date.now() - started,
      error_code: response.error_code,
    });
    return response;
  };

  if (!flags.gatewayEnabled) {
    return fail({
      decision: "kill_switch",
      error_code: "gateway_disabled",
      message: "AI Gateway is temporarily disabled",
      kill_switch_hit: "ai.gateway.enabled",
    });
  }

  const cap = getCapability(req.feature_id);
  if (!cap) {
    return fail({
      decision: "rejected",
      error_code: "unknown_capability",
      message: `Unknown or unregistered AI capability: ${req.feature_id}`,
    });
  }

  if (!cap.allowed_roles.includes(req.actor.role)) {
    return fail({
      decision: "permission_denied",
      error_code: "role_not_allowed",
      message: `Role '${req.actor.role}' cannot use ${cap.feature_id}`,
      route_class: cap.route_class,
    });
  }

  let studentId: string;
  try {
    studentId = resolveStudentTarget(req.actor, req.target_student_id);
    await assertMayAccessStudent(userClient, admin, req.actor, studentId);
  } catch (e) {
    const code = e instanceof Error ? e.message : "permission_denied";
    return fail({
      decision: "permission_denied",
      error_code: code,
      message: "Not authorised for this student",
      route_class: cap.route_class,
    });
  }

  const isDeterministic =
    cap.route_class === "deterministic_record" ||
    cap.route_class === "deterministic_insight" ||
    cap.route_class === "eie_insight";

  if (isDeterministic && !flags.deterministicEnabled) {
    return fail({
      decision: "kill_switch",
      error_code: "deterministic_disabled",
      message: "Deterministic AI paths are temporarily disabled",
      kill_switch_hit: "ai.deterministic.enabled",
      route_class: cap.route_class,
    });
  }

  // Model must never be planned for attendance / other never-policy caps
  const mayCallModel =
    isModelAllowed(cap) && flags.generativeEnabled && isOpenRouterConfigured();

  try {
    let data: unknown = null;
    let cache_hit = false;
    let decision = "answered_deterministic";
    let used_model = false;
    let model_id: string | undefined;
    let provenance: Record<string, unknown> | undefined;

    const cacheKeyBase = `${cap.feature_id}:${studentId}`;

    const withCache = async (dataVersion: string, loader: () => Promise<unknown>) => {
      const l1Key = `l1:${req.actor.schoolId}:${cacheKeyBase}:${dataVersion}`;
      const l1Hit = l1Get(l1Key);
      if (l1Hit != null) {
        cache_hit = true;
        return l1Hit;
      }
      const l2Key = `${cacheKeyBase}:${dataVersion}`;
      const l2Hit = await readL2Cache(admin, req.actor.schoolId, l2Key);
      if (l2Hit != null) {
        cache_hit = true;
        l1Set(l1Key, l2Hit);
        return l2Hit;
      }
      const fresh = await loader();
      l1Set(l1Key, fresh);
      const ver =
        fresh && typeof fresh === "object" && "data_version" in (fresh as object)
          ? String((fresh as { data_version: string }).data_version)
          : dataVersion;
      // Write under lookup key (stable) and content version key for cross-isolate reuse
      await writeL2Cache(admin, {
        schoolId: req.actor.schoolId,
        cacheKey: l2Key,
        featureId: cap.feature_id,
        studentId,
        dataVersion: ver,
        payload: fresh,
      }).catch(() => undefined);
      if (ver !== dataVersion) {
        await writeL2Cache(admin, {
          schoolId: req.actor.schoolId,
          cacheKey: `${cacheKeyBase}:${ver}`,
          featureId: cap.feature_id,
          studentId,
          dataVersion: ver,
          payload: fresh,
        }).catch(() => undefined);
      }
      return fresh;
    };

    switch (cap.feature_id) {
      case "student.attendance.query": {
        // Explicit: never call model for attendance
        data = await withCache("pending", () =>
          fetchAttendance(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.homework.due": {
        data = await withCache("pending", () =>
          fetchHomeworkDue(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.marks.summary": {
        data = await withCache("pending", () =>
          fetchMarksSummary(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.timetable.today": {
        data = await withCache("pending", () =>
          fetchTimetableToday(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.eie.mastery_summary": {
        data = await withCache("pending", () => fetchEie(admin, req.actor.schoolId, studentId));
        decision = "answered_eie";
        provenance = {
          algorithm_id: (data as { algorithm_id?: string })?.algorithm_id,
          completeness: (data as { completeness?: number })?.completeness,
          data_version: (data as { source_data_version?: string })?.source_data_version,
        };
        break;
      }
      case "parent.child.summary": {
        data = await withCache("pending", () =>
          fetchParentSummary(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "parent.child.narrative": {
        const [parentSummary, eie] = await Promise.all([
          withCache("pending", () =>
            fetchParentSummary(admin, req.actor.schoolId, studentId),
          ) as Promise<Awaited<ReturnType<typeof fetchParentSummary>>>,
          withCache("pending", () => fetchEie(admin, req.actor.schoolId, studentId)),
        ]);
        const narrative = buildParentScheduledNarrative({
          attendance_pct: parentSummary.attendance_pct,
          homework_completion_pct: parentSummary.homework_completion_pct,
          tests_avg_pct: parentSummary.tests_avg_pct,
          exams_avg_pct: parentSummary.exams_avg_pct,
          weak_topics: parentSummary.weak_topics,
          strong_topics: parentSummary.strong_topics,
          avg_mastery: (eie as { avg_mastery?: number }).avg_mastery ?? null,
          revision_topics: ((eie as { revision_priority?: { topic?: string | null }[] })
            .revision_priority ?? [])
            .map((r) => r.topic)
            .filter((t): t is string => !!t),
          source_as_of: parentSummary.source_as_of,
          data_version: `narrative:${parentSummary.data_version}:${(eie as { data_version?: string }).data_version ?? "eie"}`,
        });
        data = narrative;
        decision = "answered_deterministic";
        provenance = {
          algorithm_id: (eie as { algorithm_id?: string }).algorithm_id,
          completeness: narrative.completeness,
          data_version: narrative.data_version,
          source_as_of: narrative.source_as_of,
        };
        break;
      }
      case "student.performance.explain": {
        const factsVersionSeed = `explain-facts:${studentId}`;
        const factsBundle = (await withCache(factsVersionSeed, async () => {
          const [attendance, homework, marks, eie] = await Promise.all([
            fetchAttendance(admin, req.actor.schoolId, studentId),
            fetchHomeworkDue(admin, req.actor.schoolId, studentId),
            fetchMarksSummary(admin, req.actor.schoolId, studentId),
            fetchEie(admin, req.actor.schoolId, studentId),
          ]);
          return {
            attendance,
            homework,
            marks,
            eie,
            data_version: `explain:${attendance.data_version}:${marks.data_version}:${eie.data_version}`,
            source_as_of: attendance.source_as_of,
            completeness:
              (attendance.completeness +
                homework.completeness +
                marks.completeness +
                eie.completeness) /
              4,
          };
        })) as {
          attendance: Awaited<ReturnType<typeof fetchAttendance>>;
          homework: Awaited<ReturnType<typeof fetchHomeworkDue>>;
          marks: Awaited<ReturnType<typeof fetchMarksSummary>>;
          eie: Awaited<ReturnType<typeof fetchEie>>;
          data_version: string;
          source_as_of: string | null;
          completeness: number;
        };

        const { attendance, homework, marks, eie } = factsBundle;
        const facts = { attendance, homework, marks, eie };

        const pack = buildContextPack({
          capability: cap.feature_id,
          request_text: req.input_text,
          ae: { attendance, homework, marks },
          eie,
          tier_signals: {
            facts_complete: true,
            budget_pressure: false,
          },
        });

        let budget_tier: ReasoningTier = pack.tier;
        let cost_units = estimateUnitsForTier(budget_tier);
        let validation_ok: boolean | null = null;
        let confidence_score: number | undefined;

        if (!mayCallModel) {
          const conf = scoreConfidence({
            used_model: false,
            cache_hit,
            completeness: pack.provenance.completeness || factsBundle.completeness,
            source_as_of: pack.provenance.source_as_of,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;
          data = {
            explanation: null,
            facts,
            context_provenance: pack.provenance,
            confidence: conf.confidence,
            confidence_action: conf.action,
            degraded_reason: !flags.generativeEnabled
              ? "generative_kill_switch"
              : "openrouter_not_configured",
          };
          decision = "answered_facts_only";
          provenance = {
            algorithm_id: eie.algorithm_id,
            completeness: eie.completeness,
            data_version: eie.source_data_version,
            budget_tier,
            context_versions: pack.provenance.data_versions,
          };
          await writeDecision(admin, {
            request_id: req.request_id,
            school_id: req.actor.schoolId,
            actor_user_id: req.actor.userId,
            actor_role: req.actor.role,
            feature_id: cap.feature_id,
            route_class: cap.route_class,
            decision,
            used_model: false,
            cache_hit,
            latency_ms: Date.now() - started,
            confidence: confidence_score,
            budget_tier,
            validation_ok: null,
            estimated_cost_units: 0,
            evidence: {
              student_id: studentId,
              cost_units: 0,
              confidence_factors: conf.factors,
            },
          });
          return {
            request_id: req.request_id,
            feature_id: cap.feature_id,
            decision,
            route_class: cap.route_class,
            used_model: false,
            cache_hit,
            data,
            provenance,
            confidence: confidence_score,
            budget_tier,
          };
        }

        const budget = await reserveBudget(
          admin,
          req.actor.schoolId,
          cap.feature_id,
          cost_units,
        );
        if (!budget.ok) {
          const conf = scoreConfidence({
            used_model: false,
            cache_hit,
            completeness: pack.provenance.completeness,
            source_as_of: pack.provenance.source_as_of,
            route_class: cap.route_class,
            budget_tier,
          });
          data = {
            explanation: null,
            facts,
            context_provenance: pack.provenance,
            confidence: conf.confidence,
            confidence_action: "facts_only",
            degraded_reason: "budget_exhausted",
          };
          decision = "answered_facts_only";
          confidence_score = conf.confidence;
          await writeDecision(admin, {
            request_id: req.request_id,
            school_id: req.actor.schoolId,
            actor_user_id: req.actor.userId,
            actor_role: req.actor.role,
            feature_id: cap.feature_id,
            route_class: cap.route_class,
            decision,
            used_model: false,
            cache_hit,
            latency_ms: Date.now() - started,
            error_code: "budget_exhausted",
            confidence: confidence_score,
            budget_tier,
            estimated_cost_units: 0,
            evidence: { student_id: studentId, budget },
          });
          return {
            request_id: req.request_id,
            feature_id: cap.feature_id,
            decision,
            route_class: cap.route_class,
            used_model: false,
            cache_hit,
            data,
            provenance: {
              algorithm_id: eie.algorithm_id,
              budget_tier,
            },
            confidence: confidence_score,
            budget_tier,
            error_code: "budget_exhausted",
          };
        }

        if (budget.soft_breach && budget_tier !== "simple") {
          budget_tier = "simple";
          cost_units = estimateUnitsForTier(budget_tier);
        }

        const system = pack.system_rules.join(" ") + " Keep under 120 words.";
        const user = `Facts JSON:\n${packForModel(pack)}\n\nWrite a short plain-language performance summary.`;
        const modelResult = await completeWithQwen({
          system,
          user,
          budget_tier,
        });

        if (!modelResult.ok) {
          const conf = scoreConfidence({
            used_model: false,
            cache_hit,
            completeness: pack.provenance.completeness,
            source_as_of: pack.provenance.source_as_of,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;
          data = {
            explanation: null,
            facts,
            context_provenance: pack.provenance,
            confidence: conf.confidence,
            confidence_action: conf.action,
            degraded_reason: modelResult.error,
          };
          decision = "answered_facts_only";
        } else {
          const evidence = evidenceFromExplainFacts(facts);
          const validation = validateModelResponse(modelResult.text, evidence, {
            max_chars: pack.token_budget.output * 6,
          });
          validation_ok = validation.ok && !validation.material_failure;

          const conf = scoreConfidence({
            used_model: true,
            cache_hit,
            completeness: pack.provenance.completeness,
            source_as_of: pack.provenance.source_as_of,
            validation,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;

          const payload = applyConfidencePolicy(
            {
              explanation: validation.material_failure ? null : modelResult.text,
              facts,
              context_provenance: pack.provenance,
              validation_codes: validation.codes,
            },
            conf,
          );

          if (conf.action === "facts_only" || validation.material_failure) {
            data = {
              ...payload,
              explanation: null,
              degraded_reason: validation.material_failure
                ? "validation_failed"
                : "low_confidence_or_validation",
            };
            decision = "answered_facts_only";
            used_model = true; // model was called but not trusted
            model_id = modelResult.model_id;
          } else {
            data = payload;
            decision = "answered_model";
            used_model = true;
            model_id = modelResult.model_id;
          }
        }

        provenance = {
          algorithm_id: eie.algorithm_id,
          completeness: eie.completeness,
          data_version: eie.source_data_version,
          budget_tier,
          context_versions: pack.provenance.data_versions,
          source_as_of: pack.provenance.source_as_of,
        };

        await writeDecision(admin, {
          request_id: req.request_id,
          school_id: req.actor.schoolId,
          actor_user_id: req.actor.userId,
          actor_role: req.actor.role,
          feature_id: cap.feature_id,
          route_class: cap.route_class,
          decision,
          used_model,
          model_id: model_id ?? null,
          cache_hit,
          latency_ms: Date.now() - started,
          confidence: confidence_score ?? null,
          budget_tier,
          validation_ok,
          estimated_cost_units: used_model ? cost_units : 0,
          evidence: {
            student_id: studentId,
            cost_units: used_model ? cost_units : 0,
            soft_breach: budget.soft_breach,
          },
        });

        return {
          request_id: req.request_id,
          feature_id: cap.feature_id,
          decision,
          route_class: cap.route_class,
          used_model,
          cache_hit,
          data,
          provenance,
          model_id,
          confidence: confidence_score,
          budget_tier,
        };
      }
      default:
        return fail({
          decision: "rejected",
          error_code: "unhandled_capability",
          message: "Capability registered but not implemented",
          route_class: cap.route_class,
        });
    }

    if (data && typeof data === "object") {
      const d = data as {
        source_as_of?: string;
        data_version?: string;
        source_data_version?: string;
        completeness?: number;
      };
      provenance = {
        ...(provenance ?? {}),
        source_as_of: d.source_as_of ?? provenance?.source_as_of,
        data_version: d.data_version ?? d.source_data_version ?? provenance?.data_version,
        completeness: d.completeness ?? provenance?.completeness,
      };
    }

    const conf = scoreConfidence({
      used_model,
      cache_hit,
      completeness: Number(provenance?.completeness ?? 0.5),
      source_as_of: (provenance?.source_as_of as string | null) ?? null,
      route_class: cap.route_class,
    });

    const response: RouterResponse = {
      request_id: req.request_id,
      feature_id: cap.feature_id,
      decision,
      route_class: cap.route_class,
      used_model,
      cache_hit,
      data,
      provenance,
      model_id,
      confidence: conf.confidence,
    };

    await writeDecision(admin, {
      request_id: req.request_id,
      school_id: req.actor.schoolId,
      actor_user_id: req.actor.userId,
      actor_role: req.actor.role,
      feature_id: cap.feature_id,
      route_class: cap.route_class,
      decision,
      used_model,
      model_id: model_id ?? null,
      cache_hit,
      latency_ms: Date.now() - started,
      confidence: conf.confidence,
      estimated_cost_units: 0,
      evidence: { student_id: studentId, confidence_factors: conf.factors },
    });

    return response;
  } catch (e) {
    return fail({
      decision: "degraded",
      error_code: "router_failure",
      message: e instanceof Error ? e.message : "Router failure",
      route_class: cap.route_class,
    });
  }
}

/** Test helper export — attendance capability must never allow model. */
export function capabilityAllowsModel(featureId: string): boolean {
  const cap = getCapability(featureId);
  if (!cap) return false;
  return isModelAllowed(cap);
}

export type { CapabilityDefinition };
