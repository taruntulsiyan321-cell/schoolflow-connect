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
import { completeWithPromptLibrary, isOpenRouterConfigured } from "./modelRouter.ts";
import { buildEieProjection } from "./eieProjection.ts";
import { buildContextPack, packForModel } from "./contextBuilder.ts";
import {
  evidenceFromExplainFacts,
  validateModelResponse,
} from "./responseValidator.ts";
import { applyConfidencePolicy, scoreConfidence } from "./confidenceEngine.ts";
import { estimateUnitsForTier, type BudgetCheckResult } from "./budgetQuotas.ts";
import { buildParentScheduledNarrative } from "./parentNarrative.ts";
import { buildRecommendationPackage } from "./recommendationEngine.ts";
import type { ReasoningTier } from "./reasoningBudget.ts";
import {
  retrieveKmsChunks,
  buildEvidenceCitations,
  type RetrievalPack,
} from "./vectorRetrieval.ts";
import {
  isSessionMemoryAllowed,
  redactSessionForContext,
  buildSessionSummaryPatch,
  type SessionMemoryRecord,
} from "./sessionMemory.ts";
import { planQuestionPaper } from "./questionPaperPlan.ts";
import {
  buildQuestionPaperOutline,
  renderOutlinePrompt,
} from "./questionPaperOutline.ts";
import {
  buildQuestionPaperMarkingScheme,
  renderMarkingSchemePrompt,
} from "./questionPaperMarkingScheme.ts";
import { runImageDoubtSubmit } from "./multimodalPipeline.ts";
import {
  runImageDoubtSolve,
  renderImageDoubtSolvePrompt,
} from "./imageDoubtSolve.ts";
import { runVoiceDoubtSubmit } from "./voiceDoubtSubmit.ts";
import { buildSchoolHealthBrief } from "./schoolHealthBrief.ts";
import { buildSchoolRiskRollups } from "./schoolRollups.ts";
import { parseShadowPromptFlag } from "./promptEvaluation.ts";

export type KillSwitches = {
  gatewayEnabled: boolean;
  deterministicEnabled: boolean;
  generativeEnabled: boolean;
  /** Prompt Evaluation shadow traffic % (0–100). */
  shadowPromptPercent: number;
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
  /** Structured client input (e.g. paper plan chapters). */
  input_structured?: Record<string, unknown>;
  target_student_id?: string;
  /** Optional workflow-scoped session memory id. */
  session_id?: string;
  /** BCP-47 / display language from envelope (e.g. en, hi). */
  locale?: string;
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
  const { data, error } = await admin
    .from("ai_feature_flags")
    .select("flag_key, enabled, school_id, metadata")
    .in("flag_key", [
      "ai.gateway.enabled",
      "ai.deterministic.enabled",
      "ai.generative.enabled",
      "ai.prompt.shadow_traffic",
    ]);

  // Fail-closed: if flags cannot be read, treat gateway as disabled.
  if (error) {
    console.error("ai_feature_flags read failed — fail-closed", error.message ?? error);
    return {
      gatewayEnabled: false,
      deterministicEnabled: false,
      generativeEnabled: false,
      shadowPromptPercent: 0,
    };
  }

  const flags = data ?? [];
  // Fail-closed when master gateway seed row is missing (mis-migrated / empty DB).
  const gatewaySeed = flags.find(
    (f) => f.flag_key === "ai.gateway.enabled" && f.school_id == null,
  );
  if (!gatewaySeed) {
    console.error("ai.gateway.enabled global seed missing — fail-closed");
    return {
      gatewayEnabled: false,
      deterministicEnabled: false,
      generativeEnabled: false,
      shadowPromptPercent: 0,
    };
  }

  const read = (key: string, fallback: boolean): boolean => {
    const schoolRow = schoolId
      ? flags.find((f) => f.flag_key === key && f.school_id === schoolId)
      : null;
    if (schoolRow) return !!schoolRow.enabled;
    const global = flags.find((f) => f.flag_key === key && f.school_id == null);
    return global ? !!global.enabled : fallback;
  };

  const shadowRow =
    (schoolId
      ? flags.find((f) => f.flag_key === "ai.prompt.shadow_traffic" && f.school_id === schoolId)
      : null) ??
    flags.find((f) => f.flag_key === "ai.prompt.shadow_traffic" && f.school_id == null);

  const shadowParsed = parseShadowPromptFlag(
    !!shadowRow?.enabled,
    (shadowRow?.metadata as Record<string, unknown> | null) ?? null,
  );

  // Fail-closed: missing global flag rows disable that path (do not default-on).
  return {
    gatewayEnabled: read("ai.gateway.enabled", false),
    deterministicEnabled: read("ai.deterministic.enabled", false),
    generativeEnabled: read("ai.generative.enabled", false),
    shadowPromptPercent: shadowParsed.percent,
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
  const { error } = await admin.from("ai_request_decisions").upsert(
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
  if (error) {
    console.error("ai_request_decisions upsert failed", error.message ?? error);
  }
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
    // Fail-closed: never spend generative budget when reserve RPC is unavailable.
    console.error("ai_budget_check_and_reserve failed — fail-closed", error?.message ?? error);
    return {
      ok: false,
      soft_breach: true,
      hard_breach: true,
      units_used: 0,
      soft_limit: 0,
      hard_limit: 0,
      error_code: "budget_check_unavailable",
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
  if (actor.role === "admin" || actor.role === "principal") {
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

/** Progression Engine facts for Nova context (never invent XP/streak). */
async function fetchProgression(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) {
    return {
      projection: "StudentProgression",
      version: 1,
      studentId,
      schoolId,
      xp: 0,
      level: 1,
      study_streak: 0,
      battleground_wins: 0,
      practice_sessions: 0,
      total_battles: 0,
      source_as_of: null as string | null,
      data_version: `prog:${studentId}:none`,
      completeness: 0,
    };
  }

  const [{ data: xp }, { count: practiceCount }] = await Promise.all([
    admin
      .from("student_xp")
      .select(
        "xp, level, current_streak, wins, total_battles, updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("practice_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const hasRow = !!xp;
  const xpVal = Number(xp?.xp ?? 0);
  const level = Number(xp?.level ?? 1);
  const streak = Number(xp?.current_streak ?? 0);
  const wins = Number(xp?.wins ?? 0);
  const battles = Number(xp?.total_battles ?? 0);
  const practice = practiceCount ?? 0;
  const asOf = xp?.updated_at ? String(xp.updated_at) : null;
  const hasData = hasRow && (xpVal > 0 || practice > 0 || battles > 0 || streak > 0);

  return {
    projection: "StudentProgression",
    version: 1,
    studentId,
    schoolId,
    xp: xpVal,
    level,
    study_streak: streak,
    battleground_wins: wins,
    practice_sessions: practice,
    total_battles: battles,
    source_as_of: asOf,
    data_version: `prog:${studentId}:${xpVal}:${level}:${streak}`,
    completeness: hasData ? 1 : hasRow ? 0.4 : 0,
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

  const { data: profile } = await admin
    .from("student_academic_profiles")
    .select("attendance_pct, homework_completion_pct")
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  return buildEieProjection({
    studentId,
    schoolId,
    mastery,
    revisionQueue: revision,
    attendance_pct: profile?.attendance_pct != null ? Number(profile.attendance_pct) : null,
    homework_completion_pct:
      profile?.homework_completion_pct != null
        ? Number(profile.homework_completion_pct)
        : null,
  });
}

function pickConceptFromEie(
  eie: Awaited<ReturnType<typeof fetchEie>>,
  inputText?: string,
): {
  name: string;
  subject: string;
  chapter: string | null;
  mastery_score: number;
  band: string;
  mistake_count: number;
} | null {
  const text = (inputText ?? "").toLowerCase();
  const all = [
    ...(eie.weak_concepts ?? []),
    ...(eie.strong_concepts ?? []),
  ];
  const hit = all.find((c) => text.includes(String(c.concept).toLowerCase()));
  const chosen = hit ?? eie.weak_concepts?.[0] ?? all[0];
  if (!chosen) return null;
  return {
    name: chosen.concept,
    subject: chosen.subject,
    chapter: chosen.chapter ?? null,
    mastery_score: chosen.mastery_score,
    band: chosen.band,
    mistake_count: chosen.mistake_count ?? 0,
  };
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

  const pctOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    projection: "ParentChildSummary",
    version: 1,
    studentId,
    schoolId,
    attendance_pct: pctOrNull(profile?.attendance_pct),
    homework_completion_pct: pctOrNull(profile?.homework_completion_pct),
    tests_avg_pct: pctOrNull(profile?.tests_avg_pct),
    exams_avg_pct: pctOrNull(profile?.exams_avg_pct),
    weak_topics: weak,
    strong_topics: strong,
    source_as_of: profile?.refreshed_at ? String(profile.refreshed_at) : null,
    data_version: `parent:${studentId}:${profile?.refreshed_at ?? "none"}`,
    completeness: profile
      ? profile.attendance_pct != null ||
        profile.homework_completion_pct != null ||
        profile.tests_avg_pct != null ||
        profile.exams_avg_pct != null
        ? 1
        : 0.4
      : 0.3,
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

  let studentId: string | null = null;
  if (cap.requires_student_target) {
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
  } else if (req.target_student_id) {
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
  }

  let sessionMemory: SessionMemoryRecord | null = null;
  if (req.session_id && isSessionMemoryAllowed(cap.feature_id)) {
    const { data: sess } = await admin.rpc("ai_session_memory_read", {
      p_session_id: req.session_id,
    });
    if (sess && typeof sess === "object") {
      const raw = sess as SessionMemoryRecord & {
        school_id?: string;
        actor_user_id?: string;
      };
      const sessSchool = raw.school_id ? String(raw.school_id) : null;
      const sessActor = raw.actor_user_id ? String(raw.actor_user_id) : null;
      const staff =
        req.actor.role === "admin" || req.actor.role === "principal";
      const schoolOk = !sessSchool || sessSchool === req.actor.schoolId;
      const actorOk =
        !sessActor || sessActor === req.actor.userId || staff;
      if (!schoolOk || !actorOk) {
        return fail({
          decision: "permission_denied",
          error_code: "session_forbidden",
          message: "Session does not belong to this actor/school",
          route_class: cap.route_class,
        });
      }
      sessionMemory = raw;
    }
  }
  const sessionForContext = redactSessionForContext(sessionMemory);

  const isDeterministic =
    cap.route_class === "deterministic_record" ||
    cap.route_class === "deterministic_insight" ||
    cap.route_class === "eie_insight" ||
    cap.route_class === "recommendation" ||
    cap.route_class === "grounded_retrieval" ||
    (cap.route_class === "content_generation" && !isModelAllowed(cap)) ||
    (cap.route_class === "multimodal" && !isModelAllowed(cap));

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

    const cacheKeyBase = `${cap.feature_id}:${studentId ?? "school"}`;

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
        studentId: studentId ?? "school",
        dataVersion: ver,
        payload: fresh,
      }).catch((err) => {
        console.error("ai L2 cache write failed", err);
      });
      if (ver !== dataVersion) {
        await writeL2Cache(admin, {
          schoolId: req.actor.schoolId,
          cacheKey: `${cacheKeyBase}:${ver}`,
          featureId: cap.feature_id,
          studentId: studentId ?? "school",
          dataVersion: ver,
          payload: fresh,
        }).catch((err) => {
          console.error("ai L2 cache write failed", err);
        });
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

        const factsJson = packForModel(pack);
        const modelResult = await completeWithPromptLibrary({
          admin,
          capability_id: cap.feature_id,
          vars: { facts: factsJson, question: req.input_text ?? "" },
          budget_tier,
          request_id: req.request_id,
          shadow_percent: flags.shadowPromptPercent,
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
          prompt_version: modelResult.ok ? modelResult.prompt?.version : undefined,
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
            prompt_version: modelResult.prompt?.version ?? null,
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
      case "student.recommendation.next": {
        if (!studentId) {
          return fail({
            decision: "permission_denied",
            error_code: "student_required",
            message: "Student target required",
            route_class: cap.route_class,
          });
        }
        const eie = (await withCache("pending", () =>
          fetchEie(admin, req.actor.schoolId, studentId),
        )) as Awaited<ReturnType<typeof fetchEie>>;
        const parentLike = await fetchParentSummary(admin, req.actor.schoolId, studentId);
        data = buildRecommendationPackage({
          studentId,
          schoolId: req.actor.schoolId,
          intelligence_version: eie.source_data_version ?? eie.data_version,
          completeness: eie.completeness,
          weak_concepts: eie.weak_concepts ?? [],
          revision_priority: eie.revision_priority ?? [],
          attendance_pct: parentLike.attendance_pct,
          homework_completion_pct: parentLike.homework_completion_pct,
          source_as_of: parentLike.source_as_of ?? eie.computed_at,
        });
        decision = "answered_eie";
        provenance = {
          algorithm_id: eie.algorithm_id,
          completeness: eie.completeness,
          data_version: (data as { data_version?: string }).data_version,
          intelligence_version: eie.source_data_version,
        };
        break;
      }
      case "student.knowledge.retrieve": {
        const query = (req.input_text ?? req.intent_hint ?? "").trim();
        if (!query) {
          return fail({
            decision: "rejected",
            error_code: "query_required",
            message: "Retrieval requires input.text query",
            route_class: cap.route_class,
          });
        }
        const role = req.actor.role as
          | "admin"
          | "teacher"
          | "student"
          | "parent"
          | "principal";
        const pack: RetrievalPack = await retrieveKmsChunks(admin, {
          school_id: req.actor.schoolId,
          query,
          role,
          limit: 5,
          min_score: 0.12,
          subject:
            typeof req.input_structured?.subject === "string"
              ? req.input_structured.subject
              : null,
          grade:
            typeof req.input_structured?.grade === "string" ? req.input_structured.grade : null,
        });
        const citations = buildEvidenceCitations(pack.hits);
        data = {
          ...pack,
          citations,
          session_memory: sessionForContext,
          evidence_sufficient: pack.sufficient,
        };
        decision = pack.sufficient ? "answered_retrieval" : "answered_facts_only";
        provenance = {
          retrieval_mode: pack.mode,
          hit_count: pack.hit_count,
          approved_only: true,
          completeness: pack.sufficient ? 0.7 : 0.15,
          data_version: `kms:${pack.mode}:${pack.hit_count}`,
        };
        break;
      }
      case "teacher.question_paper.plan": {
        const structured = req.input_structured ?? {};
        const chaptersRaw = Array.isArray(structured.chapters) ? structured.chapters : [];
        const chapters = chaptersRaw.map((c) => {
          if (typeof c === "string") return { name: c };
          const row = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          return {
            name: String(row.name ?? row.chapter ?? ""),
            weight_hint: typeof row.weight_hint === "number" ? row.weight_hint : undefined,
          };
        });
        const plan = planQuestionPaper({
          subject: String(structured.subject ?? req.input_text ?? "General"),
          grade: structured.grade != null ? String(structured.grade) : null,
          board: structured.board != null ? String(structured.board) : null,
          total_marks: Number(structured.total_marks ?? 100),
          chapters,
          difficulty_mix:
            structured.difficulty_mix && typeof structured.difficulty_mix === "object"
              ? (structured.difficulty_mix as { easy?: number; medium?: number; hard?: number })
              : undefined,
          duration_minutes:
            structured.duration_minutes != null ? Number(structured.duration_minutes) : null,
        });
        data = {
          ...plan,
          session_memory: sessionForContext,
          workflow_id: "teacher.question_paper.plan.v1",
        };
        decision = "answered_deterministic";
        provenance = {
          dry_run: true,
          generates_questions: false,
          plan_hash: plan.plan_hash,
          completeness: plan.chapters.length ? 0.9 : 0.3,
          data_version: plan.plan_hash,
        };
        break;
      }
      case "teacher.question_paper.generate_outline": {
        const structured = req.input_structured ?? {};
        const chaptersRaw = Array.isArray(structured.chapters) ? structured.chapters : [];
        const chapters = chaptersRaw.map((c) => {
          if (typeof c === "string") return { name: c };
          const row = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          return {
            name: String(row.name ?? row.chapter ?? ""),
            weight_hint: typeof row.weight_hint === "number" ? row.weight_hint : undefined,
          };
        });
        const planInput = {
          subject: String(structured.subject ?? req.input_text ?? "General"),
          grade: structured.grade != null ? String(structured.grade) : null,
          board: structured.board != null ? String(structured.board) : null,
          total_marks: Number(structured.total_marks ?? 100),
          chapters,
          difficulty_mix:
            structured.difficulty_mix && typeof structured.difficulty_mix === "object"
              ? (structured.difficulty_mix as { easy?: number; medium?: number; hard?: number })
              : undefined,
          duration_minutes:
            structured.duration_minutes != null ? Number(structured.duration_minutes) : null,
          teacher_notes:
            structured.teacher_notes != null
              ? String(structured.teacher_notes)
              : req.input_text ?? null,
          may_call_model: mayCallModel,
        };

        let modelText: string | null = null;
        let modelError: string | null = null;
        let outlineUsedModel = false;
        let outlineModelId: string | undefined;

        if (mayCallModel) {
          const planPreview = planQuestionPaper(planInput);
          const rendered = renderOutlinePrompt(planPreview, planInput.teacher_notes);
          const modelResult = await completeWithPromptLibrary({
            admin,
            capability_id: "teacher.question_paper.generate_outline",
            vars: {
              facts: rendered.facts_json,
              question: planInput.teacher_notes?.trim() || "Generate a section outline only.",
            },
            budget_tier: "medium",
            request_id: req.request_id,
            shadow_percent: flags.shadowPromptPercent,
          });
          if (modelResult.ok) {
            modelText = modelResult.text;
            outlineUsedModel = true;
            outlineModelId = modelResult.model_id;
          } else {
            modelError = modelResult.error;
          }
        } else {
          modelError = !flags.generativeEnabled
            ? "generative_kill_switch"
            : "openrouter_not_configured";
        }

        const outline = buildQuestionPaperOutline({
          planInput,
          model_text: modelText,
          may_call_model: mayCallModel,
          model_error: modelError,
        });
        data = {
          ...outline,
          session_memory: sessionForContext,
          workflow_id: "teacher.question_paper.outline.v1",
          session_patch: buildSessionSummaryPatch({
            last_feature_id: cap.feature_id,
            last_decision:
              outline.mode === "outline_with_model" ? "answered_model" : "answered_facts_only",
            plan_hash: outline.plan_hash,
            flags: {
              outline_ready: Boolean(outline.outline_text || outline.mode === "plan_only"),
              outline_text: outline.outline_text,
              plan_hash: outline.plan_hash,
            },
          }),
        };
        used_model = outlineUsedModel;
        model_id = outlineModelId;
        decision =
          outline.mode === "outline_with_model" ? "answered_model" : "answered_facts_only";
        provenance = {
          dry_run: false,
          generates_full_paper: false,
          generates_marking_scheme: false,
          plan_hash: outline.plan_hash,
          mode: outline.mode,
          completeness: outline.plan.chapters.length ? 0.8 : 0.25,
          data_version: outline.plan_hash,
          degraded_reason: outline.degraded_reason,
        };
        break;
      }
      case "student.image_doubt": {
        // Full OCR→tutor reserved (workflow disabled). Route clients to submit → solve.
        data = {
          status: "clarify",
          workflow_id: "student.image_doubt.v1",
          workflow_enabled: false,
          next_capabilities: ["student.image_doubt.submit", "student.image_doubt.solve"],
          message:
            "Full image-doubt pipeline is reserved. Submit media via student.image_doubt.submit, then tutor via student.image_doubt.solve after OCR text is available.",
          session_memory: sessionForContext,
        };
        decision = "degraded";
        provenance = {
          invented_problem_text: false,
          stop_reason: "workflow_disabled",
          completeness: 0.1,
          data_version: "image_doubt:reserved",
          needs_clarification: true,
        };
        break;
      }
      case "student.image_doubt.submit": {
        const structured = req.input_structured ?? {};
        const imageRaw =
          structured.image && typeof structured.image === "object"
            ? (structured.image as Record<string, unknown>)
            : structured;
        const meta = {
          mime: String(imageRaw.mime ?? imageRaw.content_type ?? ""),
          bytes: Number(imageRaw.bytes ?? imageRaw.size ?? 0),
          width: imageRaw.width != null ? Number(imageRaw.width) : null,
          height: imageRaw.height != null ? Number(imageRaw.height) : null,
          sha256: imageRaw.sha256 != null ? String(imageRaw.sha256) : null,
          media_ref: imageRaw.media_ref != null ? String(imageRaw.media_ref) : null,
          malware_scan_status:
            imageRaw.malware_scan_status === "stub_flagged" ||
            imageRaw.malware_scan_status === "stub_pass" ||
            imageRaw.malware_scan_status === "unchecked"
              ? imageRaw.malware_scan_status
              : null,
          filename: imageRaw.filename != null ? String(imageRaw.filename) : null,
        };
        const submit = runImageDoubtSubmit(meta, {
          env: {
            OCR_PROVIDER_API_KEY: Deno.env.get("OCR_PROVIDER_API_KEY") ?? undefined,
            GURUKUL_OCR_API_KEY: Deno.env.get("GURUKUL_OCR_API_KEY") ?? undefined,
          },
        });
        data = {
          ...submit,
          session_memory: sessionForContext,
        };
        decision =
          submit.status === "rejected"
            ? "rejected"
            : submit.status === "clarify"
              ? "degraded"
              : "answered_deterministic";
        provenance = {
          invented_problem_text: false,
          stop_reason: submit.stop_reason,
          workflow_id: submit.workflow_id,
          completeness: submit.status === "ocr_ready" ? 0.6 : 0.2,
          data_version: `image_submit:${submit.stop_reason}`,
          needs_clarification: submit.status === "clarify",
        };
        break;
      }
      case "student.image_doubt.solve": {
        if (!studentId) {
          return fail({
            decision: "permission_denied",
            error_code: "student_required",
            message: "Student target required",
            route_class: cap.route_class,
          });
        }
        const structured = req.input_structured ?? {};
        const reconstructed =
          structured.reconstructed_question != null
            ? String(structured.reconstructed_question)
            : req.input_text;
        const extractionConfidence =
          structured.extraction_confidence != null
            ? Number(structured.extraction_confidence)
            : null;

        const cacheKeySolve = `${cap.feature_id}:${studentId}:${String(reconstructed ?? "").slice(0, 80)}`;
        let cachedExplanation: string | null = null;
        const cachedPayload = await readL2Cache(admin, req.actor.schoolId, cacheKeySolve);
        if (cachedPayload && typeof cachedPayload === "object") {
          const exp = (cachedPayload as { explanation?: unknown }).explanation;
          if (typeof exp === "string" && exp.trim()) {
            cachedExplanation = exp.trim();
            cache_hit = true;
          }
        }

        let snippets: string[] = [];
        const retrieveQuery = String(reconstructed ?? "").trim();
        if (retrieveQuery && !cachedExplanation) {
          const retrievalPack = await retrieveKmsChunks(admin, {
            school_id: req.actor.schoolId,
            query: retrieveQuery,
            role: req.actor.role as
              | "admin"
              | "teacher"
              | "student"
              | "parent"
              | "principal",
            limit: 5,
          });
          snippets = (retrievalPack?.hits ?? [])
            .map((h) => String(h.chunk_text ?? "").trim())
            .filter(Boolean);
        }

        let modelText: string | null = null;
        let modelError: string | null = null;
        if (mayCallModel && !cachedExplanation) {
          const rendered = renderImageDoubtSolvePrompt({
            question: String(reconstructed ?? ""),
            retrieval_snippets: snippets,
          });
          const modelResult = await completeWithPromptLibrary({
            admin,
            capability_id: "student.image_doubt.solve",
            vars: {
              facts: rendered.facts_json,
              question: String(reconstructed ?? ""),
            },
            budget_tier: "medium",
            request_id: req.request_id,
            shadow_percent: flags.shadowPromptPercent,
          });
          if (modelResult.ok) {
            modelText = modelResult.text;
            used_model = true;
            model_id = modelResult.model_id;
          } else {
            modelError = modelResult.error;
          }
        } else if (!mayCallModel) {
          modelError = !flags.generativeEnabled
            ? "generative_kill_switch"
            : "openrouter_not_configured";
        }

        const solve = runImageDoubtSolve({
          reconstructed_question: reconstructed,
          extraction_confidence: extractionConfidence,
          cached_explanation: cachedExplanation,
          retrieval_snippets: snippets,
          model_text: modelText,
          may_call_model: mayCallModel,
          model_error: modelError,
        });
        if (solve.status === "model" && solve.explanation) {
          await writeL2Cache(admin, {
            schoolId: req.actor.schoolId,
            cacheKey: cacheKeySolve,
            featureId: cap.feature_id,
            studentId,
            dataVersion: `img_solve:${solve.extraction_confidence}`,
            payload: { explanation: solve.explanation },
          });
        }
        data = {
          ...solve,
          session_memory: sessionForContext,
        };
        used_model = solve.used_model;
        decision =
          solve.status === "clarify"
            ? "degraded"
            : solve.status === "cache_hit"
              ? "answered_cache"
              : solve.status === "model"
                ? "answered_model"
                : solve.status === "retrieval"
                  ? "answered_retrieval"
                  : "answered_facts_only";
        provenance = {
          invented_problem_text: false,
          stop_reason: solve.stop_reason,
          workflow_id: solve.workflow_id,
          completeness: solve.status === "clarify" ? 0.2 : 0.75,
          data_version: `image_solve:${solve.stop_reason}`,
          needs_clarification: solve.status === "clarify",
          confidence: solve.confidence,
        };
        break;
      }
      case "student.voice_doubt.submit": {
        const structured = req.input_structured ?? {};
        const audioRaw =
          structured.audio && typeof structured.audio === "object"
            ? (structured.audio as Record<string, unknown>)
            : structured;
        const meta = {
          mime: String(audioRaw.mime ?? audioRaw.content_type ?? ""),
          bytes: Number(audioRaw.bytes ?? audioRaw.size ?? 0),
          duration_ms: audioRaw.duration_ms != null ? Number(audioRaw.duration_ms) : null,
          sha256: audioRaw.sha256 != null ? String(audioRaw.sha256) : null,
          media_ref: audioRaw.media_ref != null ? String(audioRaw.media_ref) : null,
          malware_scan_status:
            audioRaw.malware_scan_status === "stub_flagged" ||
            audioRaw.malware_scan_status === "stub_pass" ||
            audioRaw.malware_scan_status === "unchecked"
              ? audioRaw.malware_scan_status
              : null,
          filename: audioRaw.filename != null ? String(audioRaw.filename) : null,
        };
        const submit = runVoiceDoubtSubmit(meta, {
          env: {
            STT_PROVIDER_API_KEY: Deno.env.get("STT_PROVIDER_API_KEY") ?? undefined,
            GURUKUL_STT_API_KEY: Deno.env.get("GURUKUL_STT_API_KEY") ?? undefined,
          },
        });
        data = {
          ...submit,
          session_memory: sessionForContext,
        };
        decision =
          submit.status === "rejected"
            ? "rejected"
            : submit.status === "clarify"
              ? "degraded"
              : "answered_deterministic";
        provenance = {
          invented_transcript: false,
          stop_reason: submit.stop_reason,
          workflow_id: submit.workflow_id,
          completeness: submit.status === "stt_ready" ? 0.6 : 0.2,
          data_version: `voice_submit:${submit.stop_reason}`,
          needs_clarification: submit.status === "clarify",
        };
        break;
      }
      case "teacher.question_paper.marking_scheme": {
        const structured = req.input_structured ?? {};
        // Use raw session summary for control-plane (outline_text is stripped from
        // sessionForContext before model packs — must not use redacted view here).
        const rawSummary =
          sessionMemory?.summary && typeof sessionMemory.summary === "object"
            ? sessionMemory.summary
            : {};
        const flagsObj =
          rawSummary.flags && typeof rawSummary.flags === "object"
            ? (rawSummary.flags as Record<string, unknown>)
            : {};
        const outlineFromSession =
          (typeof flagsObj.outline_text === "string" && flagsObj.outline_text.trim()
            ? flagsObj.outline_text
            : null) ??
          (typeof structured.outline_text === "string" ? structured.outline_text : null) ??
          (typeof rawSummary.outline_text === "string" ? rawSummary.outline_text : null);
        const planHash =
          (typeof flagsObj.plan_hash === "string" ? flagsObj.plan_hash : null) ??
          (typeof rawSummary.plan_hash === "string" ? rawSummary.plan_hash : null) ??
          (typeof structured.plan_hash === "string" ? structured.plan_hash : null);
        const outlineInSession = Boolean(
          flagsObj.outline_ready === true ||
            (outlineFromSession && outlineFromSession.trim().length > 0),
        );

        let modelText: string | null = null;
        let modelError: string | null = null;
        let schemeUsedModel = false;
        let schemeModelId: string | undefined;

        if (mayCallModel && outlineInSession && outlineFromSession) {
          const rendered = renderMarkingSchemePrompt({
            outline_text: outlineFromSession,
            plan_hash: planHash,
            subject: structured.subject != null ? String(structured.subject) : null,
            total_marks:
              structured.total_marks != null ? Number(structured.total_marks) : null,
            teacher_notes:
              structured.teacher_notes != null
                ? String(structured.teacher_notes)
                : req.input_text ?? null,
          });
          const modelResult = await completeWithPromptLibrary({
            admin,
            capability_id: "teacher.question_paper.marking_scheme",
            vars: {
              facts: rendered.facts_json,
              question:
                structured.teacher_notes != null
                  ? String(structured.teacher_notes)
                  : req.input_text?.trim() || "Draft marking scheme for this outline.",
            },
            budget_tier: "medium",
            request_id: req.request_id,
            shadow_percent: flags.shadowPromptPercent,
          });
          if (modelResult.ok) {
            modelText = modelResult.text;
            schemeUsedModel = true;
            schemeModelId = modelResult.model_id;
          } else {
            modelError = modelResult.error;
          }
        } else if (!mayCallModel) {
          modelError = !flags.generativeEnabled
            ? "generative_kill_switch"
            : "openrouter_not_configured";
        }

        const scheme = buildQuestionPaperMarkingScheme({
          outline_in_session: outlineInSession,
          plan_hash: planHash,
          outline_text: outlineFromSession,
          subject: structured.subject != null ? String(structured.subject) : null,
          total_marks: structured.total_marks != null ? Number(structured.total_marks) : null,
          may_call_model: mayCallModel,
          model_text: modelText,
          model_error: modelError,
          teacher_notes:
            structured.teacher_notes != null
              ? String(structured.teacher_notes)
              : req.input_text ?? null,
        });
        data = {
          ...scheme,
          session_memory: sessionForContext,
          workflow_id: "teacher.question_paper.marking_scheme.v1",
        };
        used_model = schemeUsedModel;
        model_id = schemeModelId;
        decision =
          scheme.mode === "scheme_with_model"
            ? "answered_model"
            : scheme.mode === "outline_required"
              ? "degraded"
              : "answered_facts_only";
        provenance = {
          dry_run: false,
          generates_full_paper: false,
          generates_marking_scheme: true,
          plan_hash: scheme.plan_hash,
          mode: scheme.mode,
          completeness: scheme.mode === "scheme_with_model" ? 0.85 : 0.4,
          data_version: scheme.plan_hash ?? "marking_scheme:empty",
          degraded_reason: scheme.degraded_reason,
        };
        break;
      }
      case "principal.school.health_brief": {
        const schoolId = req.actor.schoolId;
        const [classes, students, teachers, profiles] = await Promise.all([
          admin
            .from("classes")
            .select("id", { count: "exact", head: true })
            .eq("school_id", schoolId),
          admin
            .from("students")
            .select("id", { count: "exact", head: true })
            .eq("school_id", schoolId),
          admin
            .from("teachers")
            .select("id", { count: "exact", head: true })
            .eq("school_id", schoolId),
          admin
            .from("student_academic_profiles")
            .select(
              "student_id, attendance_pct, exams_avg_pct, homework_completion_pct, tests_avg_pct, refreshed_at",
            )
            .eq("school_id", schoolId)
            .limit(5000),
        ]);
        const rows = profiles.data ?? [];
        const n = rows.length || 0;
        // Average only non-null metrics — never coerce missing to 0 (skews school health).
        const avg = (key: string) => {
          let sum = 0;
          let count = 0;
          for (const r of rows) {
            const raw = (r as Record<string, unknown>)[key];
            if (raw == null) continue;
            const v = Number(raw);
            if (!Number.isFinite(v)) continue;
            sum += v;
            count += 1;
          }
          if (!count) return null;
          return Math.round((sum / count) * 10) / 10;
        };
        let avgMastery: number | null = null;
        let weakConceptCount: number | null = null;
        const { data: schoolStudents } = await admin
          .from("students")
          .select("id, class_id, user_id")
          .eq("school_id", schoolId)
          .limit(2000);
        const userIds = (schoolStudents ?? [])
          .map((s) => (s as { user_id?: string | null }).user_id)
          .filter((u): u is string => !!u)
          .map(String);
        const classByStudent = new Map(
          (schoolStudents ?? []).map((s) => [String(s.id), s.class_id ? String(s.class_id) : null]),
        );
        if (userIds.length) {
          const { data: masteryAgg } = await admin
            .from("concept_mastery")
            .select("mastery_score")
            .in("user_id", userIds.slice(0, 500))
            .limit(5000);
          if (masteryAgg && masteryAgg.length) {
            const scores = masteryAgg.map((r) => Number(r.mastery_score) || 0);
            avgMastery = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
            weakConceptCount = scores.filter((s) => s < 60).length;
          }
        }
        const latestRefresh = rows
          .map((r) => (r as { refreshed_at?: string }).refreshed_at)
          .filter(Boolean)
          .sort()
          .at(-1) as string | undefined;

        const pctOrNull = (v: unknown): number | null => {
          if (v == null) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const rollupRows = rows.map((r) => {
          const sid = String((r as { student_id?: string }).student_id ?? "");
          return {
            student_id: sid || null,
            class_id: classByStudent.get(sid) ?? null,
            attendance_pct: pctOrNull((r as { attendance_pct?: number | null }).attendance_pct),
            homework_completion_pct: pctOrNull(
              (r as { homework_completion_pct?: number | null }).homework_completion_pct,
            ),
          };
        });
        const riskRollup = buildSchoolRiskRollups(rollupRows);

        const brief = buildSchoolHealthBrief({
          school_id: schoolId,
          class_count: classes.count ?? 0,
          student_count: students.count ?? 0,
          teacher_count: teachers.count ?? 0,
          avg_attendance_pct: avg("attendance_pct"),
          avg_homework_completion_pct: avg("homework_completion_pct"),
          avg_tests_pct: avg("tests_avg_pct"),
          avg_exams_pct: avg("exams_avg_pct"),
          avg_mastery: avgMastery,
          attendance_risk_band: riskRollup.attendance_risk_band,
          homework_consistency_band: riskRollup.homework_consistency_band,
          attendance_band_counts: riskRollup.attendance_band_counts,
          homework_band_counts: riskRollup.homework_band_counts,
          at_risk_class_count: riskRollup.at_risk_class_ids.length,
          weak_concept_count: weakConceptCount,
          source_as_of: latestRefresh ?? null,
          data_version: `school_health:${n}:${avgMastery ?? "na"}:${riskRollup.data_version}`,
          eie_algorithm_id:
            riskRollup.student_count > 0
              ? riskRollup.algorithm_id
              : avgMastery != null
                ? "eie.mastery.v1"
                : null,
        });
        data = {
          ...brief,
          eie_school_rollups: riskRollup,
          session_memory: sessionForContext,
          workflow_id: "principal.school.health_brief.v1",
        };
        decision = "answered_deterministic";
        provenance = {
          used_model: false,
          completeness: brief.completeness,
          data_version: brief.data_version,
          status: brief.status,
          attendance_risk_band: riskRollup.attendance_risk_band,
          homework_consistency_band: riskRollup.homework_consistency_band,
        };
        break;
      }
      case "student.concept.explain": {
        if (!studentId) {
          return fail({
            decision: "permission_denied",
            error_code: "student_required",
            message: "Student target required",
            route_class: cap.route_class,
          });
        }
        const eie = (await withCache("pending", () =>
          fetchEie(admin, req.actor.schoolId, studentId),
        )) as Awaited<ReturnType<typeof fetchEie>>;
        const concept = pickConceptFromEie(eie, req.input_text);

        // Retrieve-before-model: KMS-approved chunks when present
        const retrieveQuery = (req.input_text ?? concept?.name ?? "").trim();
        let retrievalPack: RetrievalPack | null = null;
        if (retrieveQuery) {
          retrievalPack = await retrieveKmsChunks(admin, {
            school_id: req.actor.schoolId,
            query: retrieveQuery,
            role: req.actor.role as
              | "admin"
              | "teacher"
              | "student"
              | "parent"
              | "principal",
            limit: 4,
            min_score: 0.15,
            subject: concept?.subject ?? null,
          });
        }
        const retrievalEvidence =
          retrievalPack && retrievalPack.sufficient
            ? {
                mode: retrievalPack.mode,
                hit_count: retrievalPack.hit_count,
                citations: buildEvidenceCitations(retrievalPack.hits),
                approved_only: true,
              }
            : null;

        const conceptFacts = {
          concept: concept
            ? {
                name: concept.name,
                subject: concept.subject,
                chapter: concept.chapter,
                mastery_score: concept.mastery_score,
                band: concept.band,
                mistake_count: concept.mistake_count,
              }
            : null,
          attendance_risk: eie.attendance_risk,
          homework_consistency: eie.homework_consistency,
          avg_mastery: eie.avg_mastery,
          data_version: `concept:${eie.data_version}:${concept?.name ?? "none"}:${retrievalPack?.mode ?? "no_kms"}`,
          source_as_of: eie.computed_at,
          completeness: concept
            ? Math.max(0.4, eie.completeness)
            : retrievalPack?.sufficient
              ? 0.55
              : 0.1,
          retrieval_hit_count: retrievalPack?.hit_count ?? 0,
        };

        // If KMS evidence is sufficient and no generative path needed, answer from retrieval + EIE facts
        if (retrievalPack?.sufficient && (!mayCallModel || !concept)) {
          const conf = scoreConfidence({
            used_model: false,
            cache_hit,
            completeness: Math.max(conceptFacts.completeness, 0.55),
            source_as_of: conceptFacts.source_as_of,
            route_class: "grounded_retrieval",
            budget_tier: "simple",
          });
          data = {
            explanation: null,
            grounded_excerpts: buildEvidenceCitations(retrievalPack.hits),
            concept: conceptFacts.concept,
            facts: conceptFacts,
            retrieval: retrievalEvidence,
            session_memory: sessionForContext,
            confidence: conf.confidence,
            confidence_action: conf.action,
            source: "kms_retrieval",
          };
          decision = "answered_retrieval";
          provenance = {
            algorithm_id: eie.algorithm_id,
            completeness: conceptFacts.completeness,
            data_version: conceptFacts.data_version,
            retrieval_mode: retrievalPack.mode,
            budget_tier: "simple",
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
            confidence: conf.confidence,
            budget_tier: "simple",
            estimated_cost_units: 0,
            evidence: {
              student_id: studentId,
              concept: concept?.name ?? null,
              retrieval_hits: retrievalPack.hit_count,
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
            confidence: conf.confidence,
            budget_tier: "simple",
          };
        }

        const pack = buildContextPack({
          capability: cap.feature_id,
          request_text: req.input_text,
          ae: {},
          eie: {
            concept: conceptFacts.concept,
            avg_mastery: eie.avg_mastery,
            weak_concepts: eie.weak_concepts?.slice(0, 3),
            attendance_risk: eie.attendance_risk,
            data_version: conceptFacts.data_version,
            completeness: conceptFacts.completeness,
            algorithm_id: eie.algorithm_id,
            source_as_of: eie.computed_at,
          },
          retrieval: retrievalEvidence,
          session_memory: sessionForContext,
          tier_signals: {
            facts_complete: !!concept || !!retrievalPack?.sufficient,
            budget_pressure: false,
          },
        });

        let budget_tier: ReasoningTier = pack.tier;
        let cost_units = estimateUnitsForTier(budget_tier);
        let validation_ok: boolean | null = null;
        let confidence_score: number | undefined;

        if (!mayCallModel || !concept) {
          const conf = scoreConfidence({
            used_model: false,
            cache_hit,
            completeness: conceptFacts.completeness,
            source_as_of: conceptFacts.source_as_of,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;
          data = {
            explanation: null,
            concept: conceptFacts.concept,
            facts: conceptFacts,
            retrieval: retrievalEvidence,
            session_memory: sessionForContext,
            context_provenance: pack.provenance,
            confidence: conf.confidence,
            confidence_action: conf.action,
            degraded_reason: !concept
              ? retrievalPack?.sufficient
                ? null
                : "no_concept_seed"
              : !flags.generativeEnabled
                ? "generative_kill_switch"
                : "openrouter_not_configured",
            grounded_excerpts: retrievalPack?.sufficient
              ? buildEvidenceCitations(retrievalPack.hits)
              : [],
          };
          decision = retrievalPack?.sufficient ? "answered_retrieval" : "answered_facts_only";
          provenance = {
            algorithm_id: eie.algorithm_id,
            completeness: conceptFacts.completeness,
            data_version: conceptFacts.data_version,
            budget_tier,
            retrieval_mode: retrievalPack?.mode ?? null,
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
            estimated_cost_units: 0,
            evidence: {
              student_id: studentId,
              concept: concept?.name ?? null,
              retrieval_hits: retrievalPack?.hit_count ?? 0,
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
          data = {
            explanation: null,
            concept: conceptFacts.concept,
            facts: conceptFacts,
            retrieval: retrievalEvidence,
            degraded_reason: "budget_exhausted",
          };
          decision = "answered_facts_only";
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
            budget_tier,
            error_code: "budget_exhausted",
          };
        }

        if (budget.soft_breach && budget_tier !== "simple") {
          budget_tier = "simple";
          cost_units = estimateUnitsForTier(budget_tier);
        }

        const modelResult = await completeWithPromptLibrary({
          admin,
          capability_id: cap.feature_id,
          vars: {
            facts: JSON.stringify({
              ...conceptFacts,
              retrieval: retrievalEvidence,
              session: sessionForContext,
            }),
            question: req.input_text ?? `Explain ${concept.name}`,
          },
          budget_tier,
          request_id: req.request_id,
          shadow_percent: flags.shadowPromptPercent,
        });

        if (!modelResult.ok) {
          data = {
            explanation: null,
            concept: conceptFacts.concept,
            facts: conceptFacts,
            retrieval: retrievalEvidence,
            degraded_reason: modelResult.error,
          };
          decision = retrievalPack?.sufficient ? "answered_retrieval" : "answered_facts_only";
        } else {
          const evidence = {
            avg_mastery: concept.mastery_score,
            allowed_pcts: [concept.mastery_score, eie.avg_mastery],
          };
          const validation = validateModelResponse(modelResult.text, evidence, {
            max_chars: pack.token_budget.output * 6,
          });
          validation_ok = validation.ok && !validation.material_failure;
          const conf = scoreConfidence({
            used_model: true,
            cache_hit,
            completeness: conceptFacts.completeness,
            source_as_of: conceptFacts.source_as_of,
            validation,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;
          const payload = applyConfidencePolicy(
            {
              explanation: validation.material_failure ? null : modelResult.text,
              concept: conceptFacts.concept,
              facts: conceptFacts,
              retrieval: retrievalEvidence,
              session_memory: sessionForContext,
              validation_codes: validation.codes,
            },
            conf,
          );
          if (conf.action === "facts_only" || validation.material_failure) {
            data = {
              ...payload,
              explanation: null,
              grounded_excerpts: retrievalPack?.sufficient
                ? buildEvidenceCitations(retrievalPack.hits)
                : [],
              degraded_reason: validation.material_failure
                ? "validation_failed"
                : "low_confidence_or_validation",
            };
            decision = retrievalPack?.sufficient ? "answered_retrieval" : "answered_facts_only";
            used_model = true;
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
          completeness: conceptFacts.completeness,
          data_version: conceptFacts.data_version,
          budget_tier,
          prompt_version: modelResult.prompt?.version,
          retrieval_mode: retrievalPack?.mode ?? null,
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
            concept: concept.name,
            prompt_version: modelResult.prompt?.version ?? null,
            retrieval_hits: retrievalPack?.hit_count ?? 0,
            cost_units: used_model ? cost_units : 0,
            session_patch: buildSessionSummaryPatch({
              last_feature_id: cap.feature_id,
              last_decision: decision,
              concepts_touched: concept?.name ? [concept.name] : [],
            }),
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
      case "student.nova.chat": {
        const question = (req.input_text ?? req.intent_hint ?? "").trim();
        if (!question) {
          return fail({
            decision: "rejected",
            error_code: "empty_input",
            message: "Please type a question for Nova.",
            route_class: cap.route_class,
          });
        }
        if (!studentId) {
          return fail({
            decision: "permission_denied",
            error_code: "student_required",
            message: "Student target required",
            route_class: cap.route_class,
          });
        }

        const language =
          (req.locale && String(req.locale).trim()) ||
          (typeof req.input_structured?.language === "string"
            ? String(req.input_structured.language).trim()
            : "") ||
          "en";

        const factsVersionSeed = `nova-facts:${studentId}`;
        const factsBundle = (await withCache(factsVersionSeed, async () => {
          const [attendance, homework, marks, eie, profile, progression] = await Promise.all([
            fetchAttendance(admin, req.actor.schoolId, studentId),
            fetchHomeworkDue(admin, req.actor.schoolId, studentId),
            fetchMarksSummary(admin, req.actor.schoolId, studentId),
            fetchEie(admin, req.actor.schoolId, studentId),
            fetchParentSummary(admin, req.actor.schoolId, studentId),
            fetchProgression(admin, req.actor.schoolId, studentId),
          ]);
          return {
            attendance,
            homework,
            marks,
            eie,
            profile,
            progression,
            data_version: `nova:${attendance.data_version}:${homework.data_version}:${marks.data_version}:${eie.data_version}:${profile.data_version}:${progression.data_version}`,
            source_as_of: (() => {
              const stamps = [
                attendance.source_as_of,
                homework.source_as_of,
                marks.source_as_of,
                eie.computed_at,
                profile.source_as_of,
                progression.source_as_of,
              ].filter((v): v is string => typeof v === "string" && v.length > 0);
              stamps.sort();
              return stamps.length ? stamps[stamps.length - 1] : null;
            })(),
            completeness:
              (attendance.completeness +
                homework.completeness +
                marks.completeness +
                eie.completeness +
                profile.completeness +
                progression.completeness) /
              6,
          };
        })) as {
          attendance: Awaited<ReturnType<typeof fetchAttendance>>;
          homework: Awaited<ReturnType<typeof fetchHomeworkDue>>;
          marks: Awaited<ReturnType<typeof fetchMarksSummary>>;
          eie: Awaited<ReturnType<typeof fetchEie>>;
          profile: Awaited<ReturnType<typeof fetchParentSummary>>;
          progression: Awaited<ReturnType<typeof fetchProgression>>;
          data_version: string;
          source_as_of: string | null;
          completeness: number;
        };

        const { attendance, homework, marks, eie, profile, progression } = factsBundle;
        const facts = { attendance, homework, marks, eie, profile, progression };
        const factsEmpty =
          factsBundle.completeness < 0.25 &&
          !(eie.weak_concepts?.length || eie.strong_concepts?.length) &&
          !(profile.weak_topics?.length || profile.strong_topics?.length) &&
          !(progression.xp > 0 || progression.practice_sessions > 0 || progression.total_battles > 0);

        const pack = buildContextPack({
          capability: cap.feature_id,
          request_text: question,
          ae: { attendance, homework, marks, profile, progression },
          eie,
          session_memory: sessionForContext,
          tier_signals: {
            facts_complete: !factsEmpty,
            budget_pressure: false,
            input_text_length: question.length,
          },
        });

        let budget_tier: ReasoningTier = pack.tier;
        let cost_units = estimateUnitsForTier(budget_tier);
        let validation_ok: boolean | null = null;
        let confidence_score: number | undefined;

        const billingUnavailableMsg =
          "AI temporarily unavailable (billing/credits). Deterministic help still works.";
        const factsJson = packForModel(pack);
        const honestEmptyMsg =
          "I do not have enough Academic Engine / mastery records for you yet, so I cannot cite personal attendance, marks, or mastery. Ask about a study concept, or check attendance / homework / marks once your school data is synced.";

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
          const reason = !flags.generativeEnabled
            ? "generative_kill_switch"
            : "openrouter_not_configured";
          decision = factsEmpty ? "degraded" : "answered_facts_only";
          data = {
            reply: null,
            explanation: null,
            facts,
            context_provenance: pack.provenance,
            language,
            confidence: conf.confidence,
            confidence_action: conf.action,
            degraded_reason: reason,
            facts_empty: factsEmpty,
          };
          provenance = {
            algorithm_id: eie.algorithm_id,
            completeness: pack.provenance.completeness || factsBundle.completeness,
            data_version: factsBundle.data_version,
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
            used_model: false,
            cache_hit,
            latency_ms: Date.now() - started,
            error_code: reason,
            confidence: confidence_score,
            budget_tier,
            validation_ok: null,
            estimated_cost_units: 0,
            evidence: {
              student_id: studentId,
              language,
              facts_empty: factsEmpty,
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
            message: factsEmpty ? honestEmptyMsg : billingUnavailableMsg,
            error_code: reason === "generative_kill_switch"
              ? "generative_disabled"
              : "openrouter_not_configured",
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
            completeness: pack.provenance.completeness || factsBundle.completeness,
            source_as_of: pack.provenance.source_as_of,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;
          await writeDecision(admin, {
            request_id: req.request_id,
            school_id: req.actor.schoolId,
            actor_user_id: req.actor.userId,
            actor_role: req.actor.role,
            feature_id: cap.feature_id,
            route_class: cap.route_class,
            decision: "degraded",
            used_model: false,
            cache_hit,
            latency_ms: Date.now() - started,
            error_code: "budget_exhausted",
            confidence: confidence_score,
            budget_tier,
            estimated_cost_units: 0,
            evidence: { student_id: studentId, budget, language, facts_empty: factsEmpty },
          });
          return {
            request_id: req.request_id,
            feature_id: cap.feature_id,
            decision: "degraded",
            route_class: cap.route_class,
            used_model: false,
            cache_hit,
            data: {
              reply: null,
              facts,
              context_provenance: pack.provenance,
              degraded_reason: "budget_exhausted",
              language,
              facts_empty: factsEmpty,
            },
            message: billingUnavailableMsg,
            error_code: "budget_exhausted",
            provenance: {
              algorithm_id: eie.algorithm_id,
              budget_tier,
              context_versions: pack.provenance.data_versions,
            },
            confidence: confidence_score,
            budget_tier,
          };
        }

        if (budget.soft_breach && budget_tier !== "simple") {
          budget_tier = "simple";
          cost_units = estimateUnitsForTier(budget_tier);
        }

        const modelResult = await completeWithPromptLibrary({
          admin,
          capability_id: cap.feature_id,
          vars: { question, language, facts: factsJson },
          budget_tier,
          request_id: req.request_id,
          shadow_percent: flags.shadowPromptPercent,
        });

        if (!modelResult.ok) {
          const billing =
            /openrouter_billing|402|credits|billing/i.test(modelResult.error);
          const conf = scoreConfidence({
            used_model: false,
            cache_hit,
            completeness: pack.provenance.completeness || factsBundle.completeness,
            source_as_of: pack.provenance.source_as_of,
            route_class: cap.route_class,
            budget_tier,
          });
          confidence_score = conf.confidence;
          decision = factsEmpty ? "degraded" : "answered_facts_only";
          data = {
            reply: null,
            explanation: null,
            facts,
            context_provenance: pack.provenance,
            language,
            confidence: conf.confidence,
            confidence_action: conf.action,
            degraded_reason: modelResult.error,
            facts_empty: factsEmpty,
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
            error_code: billing ? "openrouter_billing" : "model_degraded",
            confidence: conf.confidence,
            budget_tier,
            estimated_cost_units: 0,
            evidence: {
              student_id: studentId,
              model_error: modelResult.error,
              language,
              facts_empty: factsEmpty,
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
            message: billing
              ? billingUnavailableMsg
              : factsEmpty
              ? honestEmptyMsg
              : "Nova could not reach the AI model right now. Try attendance, homework, marks, timetable, or mastery — those still work without generative credits.",
            error_code: billing ? "openrouter_billing" : "model_degraded",
            provenance: {
              algorithm_id: eie.algorithm_id,
              completeness: pack.provenance.completeness,
              data_version: factsBundle.data_version,
              budget_tier,
              context_versions: pack.provenance.data_versions,
              source_as_of: pack.provenance.source_as_of,
            },
            confidence: conf.confidence,
            budget_tier,
          };
        }

        const evidence = evidenceFromExplainFacts(facts);
        const validation = validateModelResponse(modelResult.text, evidence, {
          max_chars: pack.token_budget.output * 6,
        });
        validation_ok = validation.ok && !validation.material_failure;

        const conf = scoreConfidence({
          used_model: true,
          cache_hit,
          completeness: pack.provenance.completeness || factsBundle.completeness,
          source_as_of: pack.provenance.source_as_of,
          route_class: cap.route_class,
          budget_tier,
          validation,
        });
        confidence_score = conf.confidence;

        if (!validation_ok || conf.action === "facts_only") {
          const payload = applyConfidencePolicy(
            {
              reply: null,
              explanation: null,
              facts,
              context_provenance: pack.provenance,
              validation_codes: validation.codes,
              language,
              facts_empty: factsEmpty,
            },
            conf,
          );
          decision = factsEmpty ? "degraded" : "answered_facts_only";
          used_model = true;
          model_id = modelResult.model_id;
          data = {
            ...payload,
            reply: null,
            explanation: null,
            degraded_reason: validation.material_failure
              ? "validation_failed"
              : "low_confidence_or_validation",
          };
          await writeDecision(admin, {
            request_id: req.request_id,
            school_id: req.actor.schoolId,
            actor_user_id: req.actor.userId,
            actor_role: req.actor.role,
            feature_id: cap.feature_id,
            route_class: cap.route_class,
            decision,
            used_model: true,
            model_id: modelResult.model_id,
            cache_hit,
            latency_ms: Date.now() - started,
            error_code: validation.material_failure ? "validation_failed" : null,
            confidence: conf.confidence,
            budget_tier,
            validation_ok: false,
            estimated_cost_units: cost_units,
            evidence: {
              student_id: studentId,
              validation_codes: validation.codes,
              language,
              facts_empty: factsEmpty,
              prompt_version: modelResult.prompt?.version ?? null,
              cost_units,
            },
          });
          return {
            request_id: req.request_id,
            feature_id: cap.feature_id,
            decision,
            route_class: cap.route_class,
            used_model: true,
            cache_hit,
            data,
            message: validation.material_failure
              ? "Nova drafted a reply that looked unreliable (possible invented scores). Please rephrase, or ask about attendance / homework / marks for live school records."
              : factsEmpty
              ? honestEmptyMsg
              : undefined,
            error_code: validation.material_failure ? "validation_failed" : undefined,
            provenance: {
              algorithm_id: eie.algorithm_id,
              completeness: pack.provenance.completeness,
              data_version: factsBundle.data_version,
              budget_tier,
              context_versions: pack.provenance.data_versions,
              source_as_of: pack.provenance.source_as_of,
              prompt_version: modelResult.prompt?.version,
            },
            model_id,
            confidence: conf.confidence,
            budget_tier,
          };
        }

        used_model = true;
        model_id = modelResult.model_id;
        decision = "answered_model";
        data = applyConfidencePolicy(
          {
            reply: modelResult.text,
            explanation: modelResult.text,
            facts,
            context_provenance: pack.provenance,
            language,
            facts_empty: factsEmpty,
            session_patch: buildSessionSummaryPatch({
              last_feature_id: cap.feature_id,
              last_decision: decision,
            }),
          },
          conf,
        );
        provenance = {
          algorithm_id: eie.algorithm_id,
          completeness: pack.provenance.completeness || factsBundle.completeness,
          data_version: factsBundle.data_version,
          budget_tier,
          context_versions: pack.provenance.data_versions,
          source_as_of: pack.provenance.source_as_of,
          prompt_version: modelResult.prompt?.version,
          language,
        };

        await writeDecision(admin, {
          request_id: req.request_id,
          school_id: req.actor.schoolId,
          actor_user_id: req.actor.userId,
          actor_role: req.actor.role,
          feature_id: cap.feature_id,
          route_class: cap.route_class,
          decision,
          used_model: true,
          model_id: model_id ?? null,
          cache_hit,
          latency_ms: Date.now() - started,
          confidence: confidence_score,
          budget_tier,
          validation_ok: true,
          estimated_cost_units: cost_units,
          evidence: {
            student_id: studentId,
            language,
            facts_empty: factsEmpty,
            prompt_version: modelResult.prompt?.version ?? null,
            cost_units,
            soft_breach: budget.soft_breach,
          },
        });

        return {
          request_id: req.request_id,
          feature_id: cap.feature_id,
          decision,
          route_class: cap.route_class,
          used_model: true,
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
