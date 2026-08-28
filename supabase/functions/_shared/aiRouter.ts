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
import { dedupeSubjects, isPlaceholderLabel } from "./novaContextBuilder.ts";
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
import { embedQueryText } from "./embeddingProvider.ts";
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

/** Env keys embedQueryText's provider resolution understands, read fresh per call. */
function embeddingEnvFromDeno(): Record<string, string | undefined> {
  return {
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY"),
    AI_EMBEDDING_API_KEY: Deno.env.get("AI_EMBEDDING_API_KEY"),
    EMBEDDING_API_KEY: Deno.env.get("EMBEDDING_API_KEY"),
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    AI_EMBEDDING_ENDPOINT: Deno.env.get("AI_EMBEDDING_ENDPOINT"),
    AI_EMBEDDING_MODEL: Deno.env.get("AI_EMBEDDING_MODEL"),
    OPENROUTER_EMBEDDING_MODEL: Deno.env.get("OPENROUTER_EMBEDDING_MODEL"),
    OPENROUTER_SITE_URL: Deno.env.get("OPENROUTER_SITE_URL"),
  };
}

/**
 * Embed a retrieval query before calling retrieveKmsChunks. Never throws and
 * never blocks the request — a failed/unset embed just yields null, and
 * retrieveKmsChunks (and the ai_kms_retrieve_chunks RPC underneath it)
 * already fall back to lexical overlap when query_embedding is null.
 */
async function resolveQueryEmbedding(query: string): Promise<number[] | null> {
  const result = await embedQueryText(query, { env: embeddingEnvFromDeno() });
  return result.ok ? result.embedding : null;
}

/**
 * Extract every numeric token from a question's text, normalized (commas/currency stripped)
 * and sorted for order-independent comparison.
 */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return matches
    .map((m) => parseFloat(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * True only when two questions carry the EXACT same numeric values (or neither has any —
 * a purely conceptual question). This is the real safety gate for "same question" vs "same
 * template, different values": embedding similarity alone cannot tell them apart reliably —
 * verified empirically, a same-template-different-values pair can score HIGHER (0.94) than a
 * genuine same-question paraphrase (0.79). Reusing a cached answer when the numbers differ
 * would silently hand a student the wrong result for their own values.
 */
function numbersMatch(a: string, b: string): boolean {
  const na = extractNumbers(a);
  const nb = extractNumbers(b);
  if (na.length !== nb.length) return false;
  return na.every((n, i) => Math.abs(n - nb[i]) < 0.005);
}

async function fetchAttendance(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: rows } = await admin
    .from("attendance_current")
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
  // Matches refresh_student_academic_profile's definition exactly (present-only
  // over total marked days) -- this used to give late/half_day half credit,
  // a different formula from the one that actually populates
  // student_academic_profiles.attendance_pct (what the student/parent/
  // principal dashboards and the risk-band alerting both read). Nova would
  // report a different attendance % than every other surface in the app for
  // the same student whenever a late/half_day row existed. Aligned to the
  // authoritative source rather than inventing a third definition.
  const attendance_pct = total ? Math.round((counts.present / total) * 1000) / 10 : 0;
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

  const bySubject = new Map<string, { subject: string; sum: number; count: number }>();
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
    const subjectRaw = String(exam.subject || "").trim();
    if (isPlaceholderLabel(subjectRaw)) continue;
    const subjectKey = subjectRaw.toLowerCase();
    const cur = bySubject.get(subjectKey) ?? { subject: subjectRaw, sum: 0, count: 0 };
    cur.sum += pct;
    cur.count += 1;
    bySubject.set(subjectKey, cur);
    if (recent.length < 10) {
      recent.push({
        examId: String(exam.id),
        subject: subjectRaw,
        marksObtained: obtained,
        maxMarks: max,
        pct,
      });
    }
  }

  const subjects = [...bySubject.values()].map((v) => ({
    subject: v.subject,
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

/**
 * Progression Engine facts for Nova context (never invent XP/streak/league).
 * SSOT: study_streak + practice_sessions_count + league_code (ProgressionService parity).
 */
async function fetchProgression(admin: SupabaseClient, schoolId: string, studentId: string, actorRole: string) {
  const empty = {
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
    league: null as string | null,
    league_label: null as string | null,
    weak_concepts: [] as string[],
    source_as_of: null as string | null,
    data_version: `prog:${studentId}:none`,
    completeness: 0,
  };
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) return empty;

  let xp: {
    xp?: number | null; level?: number | null; study_streak?: number | null;
    current_streak?: number | null; wins?: number | null; total_battles?: number | null;
    practice_sessions_count?: number | null; league_code?: string | null; updated_at?: string | null;
  } | null = null;

  const progressive = await admin
    .from("student_xp")
    .select("xp, level, study_streak, current_streak, wins, total_battles, practice_sessions_count, league_code, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!progressive.error) {
    xp = progressive.data;
  } else {
    const legacy = await admin
      .from("student_xp")
      .select("xp, level, current_streak, wins, total_battles, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    xp = legacy.data;
  }

  const { data: masteryRows } = await admin
    .from("concept_mastery")
    .select("subject, concept, mastery_score, mistake_count")
    .eq("user_id", userId)
    .order("mastery_score", { ascending: true })
    .limit(40);

  const hasRow = !!xp;
  const xpVal = Number(xp?.xp ?? 0);
  const level = Number(xp?.level ?? 1);
  // Study streak SSOT only — never fall back to battle current_streak.
  const streak = Number(xp?.study_streak ?? 0);
  const wins = Number(xp?.wins ?? 0);
  const battles = Number(xp?.total_battles ?? 0);
  const practice = Number(xp?.practice_sessions_count ?? 0);
  const leagueCode = typeof xp?.league_code === "string" && xp.league_code.trim() ? String(xp.league_code) : null;
  const asOf = xp?.updated_at ? String(xp.updated_at) : null;
  const hasData = hasRow && (xpVal > 0 || practice > 0 || battles > 0 || streak > 0);
  const weak_concepts = dedupeSubjects(
    (masteryRows ?? [])
      .filter((r) => Number(r.mastery_score ?? 100) < 60 || Number(r.mistake_count ?? 0) >= 2)
      .map((r) => {
        const subject = String(r.subject ?? "").trim();
        const concept = String(r.concept ?? "").trim();
        if (isPlaceholderLabel(concept)) return null;
        if (isPlaceholderLabel(subject)) return concept;
        return `${subject}: ${concept}`;
      }),
    8,
  );

  let leagueLabel: string | null = null;
  if (leagueCode) {
    const { data: leagueRow, error: leagueErr } = await admin
      .from("progression_leagues")
      .select("label")
      .eq("code", leagueCode)
      .maybeSingle();
    leagueLabel = !leagueErr && leagueRow?.label ? String(leagueRow.label) : leagueCode;
  }

  // 10.16 splits this row in half. Public: xp, level, league, streak, battles.
  // Private: practice session counts and practice-derived weak concepts. The
  // private half is omitted entirely rather than zeroed — a 0 would tell the
  // model the student had done no practice, which is a different and false
  // statement than "not yours to see" (G4).
  const selfOnly = actorRole === "student"
    ? { practice_sessions: practice, weak_concepts }
    : {};
  return {
    projection: "StudentProgression", version: 1, studentId, schoolId,
    xp: xpVal, level, study_streak: streak, battleground_wins: wins,
    total_battles: battles, league: leagueCode, league_label: leagueLabel,
    ...selfOnly, source_as_of: asOf,
    data_version: `prog:${studentId}:${xpVal}:${level}:${streak}:${leagueCode ?? "none"}:${actorRole === "student" ? weak_concepts.length : "p"}`,
    completeness: hasData ? 1 : hasRow ? 0.4 : 0,
  };
}
/**
 * Chunk 7B. `actorRole` is REQUIRED, and the reason it is required is the whole
 * point of the chunk.
 *
 * concept_mastery is practice data — private to the student under 10.8. Chunk
 * 1.6 removed the parent and teacher SELECT policies from it. But this function
 * reads it on `admin`, the service-role client, so RLS never runs, and
 * `case "parent.child.narrative"` called it. A parent asking for their child's
 * narrative was getting weak AND strong concepts derived from the child's
 * practice mastery — the same table and the same role 1.6 closed, reopened
 * through the door policy-level auditing cannot see. 10.8 also says strong
 * areas are never surfaced anywhere at all.
 *
 * fetchPracticeHistory, fetchMistakesBook and fetchRecoveryQueue already carry
 * this gate. This one was missed.
 */
async function fetchEie(
  admin: SupabaseClient,
  schoolId: string,
  studentId: string,
  actorRole: string,
) {
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

  // Practice mastery reaches the student and nobody else. A non-student gets
  // the empty shape, not a reduced one — an absent weak-concept list must not
  // be distinguishable from a list that happens to be empty.
  if (userId && actorRole === "student") {
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

/**
 * Chunk 7B batch 2d. `actorRole` is REQUIRED here for the same reason it is
 * required in fetchEie.
 *
 * student_academic_profiles.metrics.weakTopics / .strongTopics were written
 * from public.concept_mastery by the old refresh_student_academic_profile
 * (weak = mastery_score < 50, strong = mastery_score >= 75). That write path
 * is gone, but the rows it wrote survived, and this function handed them
 * straight back — with no role gate at all, while every other practice
 * fetcher in this file (fetchEie, fetchPracticeHistory, fetchMistakesBook,
 * fetchRecoveryQueue, fetchProgression, probeEie) carries one.
 *
 * Reachable as parent, principal or admin via parent.child.summary and
 * parent.child.narrative, and as teacher, principal or admin via
 * student.nova.chat, where the result is returned to the client as
 * data.facts.profile AND fed to the model.
 *
 * The residual metrics are purged by migration 20260828220000; this is the
 * read side, so that a profile written by any future path cannot leak the
 * same way.
 */
async function fetchParentSummary(
  admin: SupabaseClient,
  schoolId: string,
  studentId: string,
  actorRole: string,
) {
  const { data: profile } = await admin
    .from("student_academic_profiles")
    .select(
      "attendance_pct, homework_completion_pct, tests_avg_pct, exams_avg_pct, metrics, refreshed_at",
    )
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const metrics = (profile?.metrics ?? {}) as Record<string, unknown>;
  const weak = dedupeSubjects(
    Array.isArray(metrics.weakTopics) ? metrics.weakTopics.map(String) : [],
    8,
  );
  // strongTopics is deliberately NOT read into a binding any more. See the
  // payload block below: it is not withheld conditionally, it is never sent.

  const pctOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // student_academic_profiles.exams_avg_pct is computed across ALL marks,
  // published or not (intentional: staff pre-publish visibility). A student
  // or parent must only ever see the published-results average -- same gate
  // fetchMarksSummary already applies to the dedicated marks-summary
  // capability. Recompute via that same function (not a second
  // reimplementation) whenever the caller isn't staff, so this bundle can
  // never hand the model a number that contradicts the marks bundle sitting
  // next to it in the same facts object.
  let examsAvgPct = pctOrNull(profile?.exams_avg_pct);
  if (actorRole === "student" || actorRole === "parent") {
    const marksSummary = await fetchMarksSummary(admin, schoolId, studentId);
    examsAvgPct = marksSummary.average_pct;
  }

  return {
    projection: "ParentChildSummary",
    version: 1,
    studentId,
    schoolId,
    attendance_pct: pctOrNull(profile?.attendance_pct),
    homework_completion_pct: pctOrNull(profile?.homework_completion_pct),
    tests_avg_pct: pctOrNull(profile?.tests_avg_pct),
    exams_avg_pct: examsAvgPct,
    // 10.8: practice is the student's. Omitted, not emptied — an empty array
    // would assert "no weak areas", which is a different and false claim (G4).
    ...(actorRole === "student" ? { weak_topics: weak } : {}),
    // strong_topics is not gated, it is gone: "strong areas are never
    // surfaced anywhere in the app", including to the student.
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

/** Profile + class + enrolled subjects for Nova (deduped, no placeholders). */
async function fetchStudentProfileContext(admin: SupabaseClient, schoolId: string, studentId: string) {
  const empty = {
    projection: "StudentProfileContext",
    version: 1,
    studentId,
    schoolId,
    full_name: null as string | null,
    roll_number: null as string | null,
    class_id: null as string | null,
    class_name: null as string | null,
    section: null as string | null,
    class_label: null as string | null,
    subjects: [] as string[],
    source_as_of: null as string | null,
    data_version: `profilectx:${studentId}:none`,
    completeness: 0,
  };

  const { data: student } = await admin
    .from("students_current")
    .select("full_name, roll_number, class_id, classes(name, section)")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (!student) return empty;

  const rawClasses = student.classes as
    | { name?: string; section?: string }
    | { name?: string; section?: string }[]
    | null
    | undefined;
  const clsObj = Array.isArray(rawClasses) ? rawClasses[0] : rawClasses;
  const class_name = clsObj?.name ? String(clsObj.name).trim() : null;
  const section = clsObj?.section ? String(clsObj.section).trim() : null;
  const class_label =
    class_name || section
      ? `${class_name ?? ""}${class_name && section ? "-" : ""}${section ?? ""}`.replace(/^-|-$/g, "") ||
        null
      : null;

  let subjects: string[] = [];
  if (student.class_id) {
    const { data: tc } = await admin
      .from("teacher_classes")
      .select("subject")
      .eq("class_id", student.class_id)
      .eq("school_id", schoolId);
    subjects = dedupeSubjects((tc ?? []).map((r) => r.subject));
  }

  const hasIdentity = !!(student.full_name || class_label || subjects.length);
  return {
    projection: "StudentProfileContext",
    version: 1,
    studentId,
    schoolId,
    full_name: student.full_name ? String(student.full_name) : null,
    roll_number: student.roll_number ? String(student.roll_number) : null,
    class_id: student.class_id ? String(student.class_id) : null,
    class_name,
    section,
    class_label,
    subjects,
    source_as_of: null,
    data_version: `profilectx:${studentId}:${class_label ?? "none"}:${subjects.length}`,
    completeness: hasIdentity ? 1 : 0.2,
  };
}

/** Recent practice history for Nova. */
async function fetchPracticeHistory(admin: SupabaseClient, schoolId: string, studentId: string, actorRole: string) {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  // Practice is private to the student (locked decision 10.8/10.16). Nova runs
  // on the service role, so RLS never applies here — the gate has to be explicit.
  if (!userId || actorRole !== "student") {
    return {
      projection: "StudentPracticeHistory",
      version: 1,
      studentId,
      schoolId,
      sessions_completed: 0,
      subjects: [] as string[],
      recent: [] as { subject: string; chapter: string; accuracy: number | null; finished_at: string }[],
      source_as_of: null as string | null,
      data_version: `practice:${studentId}:0`,
      completeness: 0,
    };
  }

  const { data: rows } = await admin
    .from("practice_sessions")
    .select("subject, chapter, accuracy, correct_count, question_count, finished_at, saved_at")
    .eq("user_id", userId)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(30);

  const list = rows ?? [];
  const subjects = dedupeSubjects(list.map((r) => r.subject));
  const recent = list.slice(0, 8).map((r) => {
    const acc =
      r.accuracy != null
        ? Number(r.accuracy)
        : r.question_count
          ? Math.round((1000 * Number(r.correct_count ?? 0)) / Number(r.question_count)) / 10
          : null;
    return {
      subject: String(r.subject ?? ""),
      chapter: String(r.chapter ?? ""),
      accuracy: acc,
      finished_at: String(r.finished_at ?? r.saved_at ?? ""),
    };
  }).filter((r) => !isPlaceholderLabel(r.subject));

  const latest = recent[0]?.finished_at || null;
  return {
    projection: "StudentPracticeHistory",
    version: 1,
    studentId,
    schoolId,
    sessions_completed: list.length,
    subjects,
    recent,
    source_as_of: latest,
    data_version: `practice:${studentId}:${list.length}:${latest ?? "none"}`,
    completeness: list.length > 0 ? 1 : 0.1,
  };
}

/** Mistake Book summary for Nova. */
async function fetchMistakesBook(admin: SupabaseClient, schoolId: string, studentId: string, actorRole: string) {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  // The mistake book is the single most private object in the product.
  // 10.23: a practice mistake is never school data. Service role bypasses RLS.
  if (!userId || actorRole !== "student") {
    return {
      projection: "StudentMistakesBook",
      version: 1,
      studentId,
      schoolId,
      open_count: 0,
      subjects: [] as string[],
      recent_concepts: [] as string[],
      source_as_of: null as string | null,
      data_version: `mistakes:${studentId}:0`,
      completeness: 0,
    };
  }

  const { data: rows } = await admin
    .from("student_mistakes")
    .select("subject, concept, topic, times_wrong, last_wrong_at, mastered")
    .eq("user_id", userId)
    .eq("mastered", false)
    .order("last_wrong_at", { ascending: false })
    .limit(40);

  const list = rows ?? [];
  const subjects = dedupeSubjects(list.map((r) => r.subject));
  const recent_concepts = dedupeSubjects(
    list.map((r) => {
      const c = String(r.concept ?? r.topic ?? "").trim();
      return isPlaceholderLabel(c) ? null : c;
    }),
    8,
  );
  const latest = list[0]?.last_wrong_at ? String(list[0].last_wrong_at) : null;
  return {
    projection: "StudentMistakesBook",
    version: 1,
    studentId,
    schoolId,
    open_count: list.length,
    subjects,
    recent_concepts,
    source_as_of: latest,
    data_version: `mistakes:${studentId}:${list.length}:${latest ?? "none"}`,
    completeness: list.length > 0 ? 1 : 0.1,
  };
}

/** Recovery queue summary for Nova. */
async function fetchRecoveryQueue(admin: SupabaseClient, schoolId: string, studentId: string, actorRole: string) {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  // Recovery derives entirely from practice mistakes — private (10.8).
  if (!userId || actorRole !== "student") {
    return {
      projection: "StudentRecoveryQueue",
      version: 1,
      studentId,
      schoolId,
      pending_count: 0,
      subjects: [] as string[],
      open_concepts: [] as string[],
      source_as_of: null as string | null,
      data_version: `recovery:${studentId}:0`,
      completeness: 0,
    };
  }

  const { data: rows } = await admin
    .from("recovery_assignments")
    .select("subject, concept, status, created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(30);

  const list = rows ?? [];
  const subjects = dedupeSubjects(list.map((r) => r.subject));
  const open_concepts = dedupeSubjects(
    list.map((r) => (isPlaceholderLabel(r.concept) ? null : String(r.concept))),
    8,
  );
  const latest = list[0]?.created_at ? String(list[0].created_at) : null;
  return {
    projection: "StudentRecoveryQueue",
    version: 1,
    studentId,
    schoolId,
    pending_count: list.length,
    subjects,
    open_concepts,
    source_as_of: latest,
    data_version: `recovery:${studentId}:${list.length}:${latest ?? "none"}`,
    completeness: list.length > 0 ? 1 : 0.1,
  };
}

/**
 * Upcoming school-wide academic calendar events (holidays, exams, meetings, sports,
 * cultural, deadlines) for Nova. Admin/principal/teacher manage `school_calendar_events`
 * via the app; this is read-only. School-wide events (audience 'all'/'students') plus
 * the student's own class events are included; past events are excluded.
 */
async function fetchUpcomingEvents(admin: SupabaseClient, schoolId: string, studentId: string) {
  const { data: student } = await admin
    .from("students")
    .select("class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const classId = student?.class_id ? String(student.class_id) : null;
  const nowIso = new Date().toISOString();

  let query = admin
    .from("school_calendar_events")
    .select("id, title, description, event_type, audience, class_id, starts_at, ends_at, all_day")
    .eq("school_id", schoolId)
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(15);
  query = classId
    ? query.or(`audience.in.(all,students),class_id.eq.${classId}`)
    : query.in("audience", ["all", "students"]);

  const { data: rows } = await query;
  const list = (rows ?? []).map((r) => ({
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    event_type: String(r.event_type),
    starts_at: String(r.starts_at),
    ends_at: r.ends_at ? String(r.ends_at) : null,
    all_day: !!r.all_day,
  }));
  const latest = list[0]?.starts_at ?? null;

  return {
    projection: "StudentUpcomingEvents",
    version: 1,
    studentId,
    schoolId,
    events: list,
    upcoming_count: list.length,
    source_as_of: latest,
    data_version: `events:${studentId}:${list.length}:${latest ?? "none"}`,
    completeness: list.length > 0 ? 1 : 0.3,
  };
}

// ── Cache version probes ─────────────────────────────────────────────────────
// withCache's lookup key used to be a hardcoded literal ("pending", or a static
// per-student string) — meaning a cache hit returned whatever was cached last,
// for up to the L1/L2 TTL, REGARDLESS of whether the underlying attendance/
// homework/marks/timetable/mastery data had since changed. A teacher correcting
// today's attendance, or publishing an exam's results, would not be reflected
// for up to 10 minutes.
//
// Fix: each probe below mirrors the PRIMARY (and, where the fetch function joins
// a second table, secondary) query of its corresponding fetch* function — same
// table, same filters, same order/limit — but selects only the columns that can
// change the fetched result, and folds them into a content hash. That hash IS
// the cache lookup key. A real edit changes the hash, which changes the key,
// which is a guaranteed cache miss on the next read — no TTL wait, no polling,
// no new cache table/mechanism (still the same L1 map + `ai_solution_cache`
// L2 table). The 60s/10min TTLs stay as pure garbage-collection bounds, not the
// correctness mechanism — see withCache below.
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Order-independent content fingerprint of a narrow row-set. Truncated to 64 bits — this is a cache key, not a security boundary, so collision risk is negligible at realistic per-student row counts. */
async function hashRows(rows: unknown[] | null | undefined): Promise<string> {
  const list = rows ?? [];
  if (!list.length) return "0:empty";
  const encoded = list.map((r) => JSON.stringify(r)).sort().join("|");
  return `${list.length}:${(await sha256Hex(encoded)).slice(0, 16)}`;
}

async function probeAttendance(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data } = await admin
    .from("attendance_current")
    .select("date, status")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .order("date", { ascending: false })
    .limit(120);
  return `att:${await hashRows(data)}`;
}

async function probeHomework(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (!student?.class_id) return "hw:noclass";
  const [{ data: hw }, { data: subs }] = await Promise.all([
    admin
      .from("homework")
      .select("id, title, subject, due_date, due_time, status")
      .eq("school_id", schoolId)
      .eq("class_id", student.class_id)
      .in("status", ["published", "active"])
      .order("due_date", { ascending: true })
      .limit(50),
    admin
      .from("homework_submissions")
      .select("homework_id, status")
      .eq("student_id", studentId)
      .limit(200),
  ]);
  return `hw:${await hashRows(hw)}:${await hashRows(subs)}`;
}

async function probeMarks(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: marks } = await admin
    .from("marks")
    .select("exam_id, marks_obtained")
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(100);
  const examIds = [...new Set((marks ?? []).map((m) => String(m.exam_id)))];
  const { data: exams } = examIds.length
    ? await admin.from("exams").select("id, results_published_at").in("id", examIds)
    : { data: [] as unknown[] };
  // marks_obtained corrections and homework/attendance status corrections are written via
  // upsert (see attendanceRepository.ts / marksRepository.ts) which does not bump created_at,
  // so the hash MUST cover marks_obtained itself, not just row identity/count.
  return `marks:${await hashRows(marks)}:${await hashRows(exams)}`;
}

async function probeEie(
  admin: SupabaseClient,
  schoolId: string,
  studentId: string,
  actorRole: string,
): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) return "eie:nouser";
  // Same gate as fetchEie. The probe builds the cache key, so without it a
  // student's EIE version string could be computed — and cached — for a parent.
  if (actorRole !== "student") return `eie:notstudent:${studentId}`;
  const [{ data: mastery }, { data: revision }, { data: profile }] = await Promise.all([
    admin
      .from("concept_mastery")
      .select("subject, chapter, concept, mastery_score, mistake_count, updated_at")
      .eq("user_id", userId)
      .limit(200),
    admin
      .from("revision_queue")
      .select("subject, chapter, topic, reason, priority, due_date, completed")
      .eq("user_id", userId)
      .eq("completed", false)
      .order("priority", { ascending: false })
      .limit(40),
    admin
      .from("student_academic_profiles")
      .select("attendance_pct, homework_completion_pct")
      .eq("student_id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle(),
  ]);
  return `eie:${await hashRows(mastery)}:${await hashRows(revision)}:${profile?.attendance_pct ?? "na"}:${profile?.homework_completion_pct ?? "na"}`;
}

async function probeProgression(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) return "prog:nouser";
  const [{ data: xp }, { data: mastery }] = await Promise.all([
    admin
      .from("student_xp")
      .select("xp, level, study_streak, current_streak, wins, total_battles, practice_sessions_count, league_code, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("concept_mastery")
      .select("subject, concept, mastery_score, mistake_count")
      .eq("user_id", userId)
      .order("mastery_score", { ascending: true })
      .limit(40),
  ]);
  return `prog:${xp?.updated_at ?? "none"}:${xp?.xp ?? 0}:${xp?.level ?? 0}:${xp?.study_streak ?? 0}:${await hashRows(mastery)}`;
}

async function probeParentSummary(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data } = await admin
    .from("student_academic_profiles")
    .select("refreshed_at")
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  return `parent:${data?.refreshed_at ?? "none"}`;
}

async function probeStudentProfile(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students_current")
    .select("full_name, roll_number, class_id, classes(name, section)")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (!student) return "profilectx:none";
  let subjHash = "0:none";
  if (student.class_id) {
    const { data: tc } = await admin
      .from("teacher_classes")
      .select("subject")
      .eq("class_id", student.class_id)
      .eq("school_id", schoolId);
    subjHash = await hashRows(tc);
  }
  return `profilectx:${student.full_name ?? ""}:${student.class_id ?? "none"}:${subjHash}`;
}

async function probePracticeHistory(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) return "practice:nouser";
  const { data } = await admin
    .from("practice_sessions")
    .select("subject, chapter, accuracy, correct_count, question_count, finished_at, saved_at")
    .eq("user_id", userId)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(30);
  return `practice:${await hashRows(data)}`;
}

async function probeMistakesBook(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) return "mistakes:nouser";
  const { data } = await admin
    .from("student_mistakes")
    .select("subject, concept, topic, times_wrong, last_wrong_at, mastered")
    .eq("user_id", userId)
    .eq("mastered", false)
    .order("last_wrong_at", { ascending: false })
    .limit(40);
  return `mistakes:${await hashRows(data)}`;
}

async function probeRecoveryQueue(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const userId = student?.user_id ? String(student.user_id) : null;
  if (!userId) return "recovery:nouser";
  const { data } = await admin
    .from("recovery_assignments")
    .select("subject, concept, status, created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(30);
  return `recovery:${await hashRows(data)}`;
}

async function probeUpcomingEvents(admin: SupabaseClient, schoolId: string, studentId: string): Promise<string> {
  const { data: student } = await admin
    .from("students")
    .select("class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  const classId = student?.class_id ? String(student.class_id) : null;
  const nowIso = new Date().toISOString();
  let query = admin
    .from("school_calendar_events")
    .select("id, title, description, event_type, audience, class_id, starts_at, ends_at, all_day, updated_at")
    .eq("school_id", schoolId)
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(15);
  query = classId
    ? query.or(`audience.in.(all,students),class_id.eq.${classId}`)
    : query.in("audience", ["all", "students"]);
  const { data } = await query;
  return `events:${await hashRows(data)}`;
}

/** Joins several independent probes into one composite cache-version string for a multi-fact bundle. */
async function combineProbes(probes: Promise<string>[]): Promise<string> {
  const parts = await Promise.all(probes);
  return `combo:${(await sha256Hex(parts.join("|"))).slice(0, 20)}`;
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
    // fetchParentSummary's exams_avg_pct depends on the ACTOR's role (staff see
    // pre-publish figures, student/parent don't) -- cacheKeyBase alone has no
    // actor component, so without this suffix a capability reachable by both
    // tiers for the same studentId (e.g. student.nova.chat) could serve a
    // staff-scoped cache entry to a student/parent request within the TTL
    // window, silently defeating the role filter in fetchParentSummary.
    const examsVisibilityTier =
      req.actor.role === "student" || req.actor.role === "parent" ? "self" : "staff";

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
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        // Explicit: never call model for attendance
        data = await withCache(await probeAttendance(admin, req.actor.schoolId, studentId), () =>
          fetchAttendance(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.homework.due": {
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        data = await withCache(await probeHomework(admin, req.actor.schoolId, studentId), () =>
          fetchHomeworkDue(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.marks.summary": {
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        data = await withCache(await probeMarks(admin, req.actor.schoolId, studentId), () =>
          fetchMarksSummary(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.calendar.upcoming": {
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        data = await withCache(await probeUpcomingEvents(admin, req.actor.schoolId, studentId), () =>
          fetchUpcomingEvents(admin, req.actor.schoolId, studentId),
        );
        decision = "answered_deterministic";
        break;
      }
      case "student.eie.mastery_summary": {
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        data = await withCache(await probeEie(admin, req.actor.schoolId, studentId, req.actor.role), () =>
          fetchEie(admin, req.actor.schoolId, studentId, req.actor.role),
        );
        decision = "answered_eie";
        provenance = {
          algorithm_id: (data as { algorithm_id?: string })?.algorithm_id,
          completeness: (data as { completeness?: number })?.completeness,
          data_version: (data as { source_data_version?: string })?.source_data_version,
        };
        break;
      }
      case "parent.child.summary": {
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        data = await withCache(
          `${await probeParentSummary(admin, req.actor.schoolId, studentId)}:${examsVisibilityTier}`,
          () => fetchParentSummary(admin, req.actor.schoolId, studentId, req.actor.role),
        );
        decision = "answered_deterministic";
        break;
      }
      case "parent.child.narrative": {
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        const [parentSummary, eie] = await Promise.all([
          withCache(
            `${await probeParentSummary(admin, req.actor.schoolId, studentId)}:${examsVisibilityTier}`,
            () => fetchParentSummary(admin, req.actor.schoolId, studentId, req.actor.role),
          ) as Promise<Awaited<ReturnType<typeof fetchParentSummary>>>,
          withCache(await probeEie(admin, req.actor.schoolId, studentId, req.actor.role), () =>
            fetchEie(admin, req.actor.schoolId, studentId, req.actor.role),
          ),
        ]);
        const narrative = buildParentScheduledNarrative({
          attendance_pct: parentSummary.attendance_pct,
          homework_completion_pct: parentSummary.homework_completion_pct,
          tests_avg_pct: parentSummary.tests_avg_pct,
          exams_avg_pct: parentSummary.exams_avg_pct,
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
        if (!studentId) {
          return fail({
            decision: "permission_denied", error_code: "student_required",
            message: "Student target required", route_class: cap.route_class,
          });
        }
        const factsVersionSeed = await combineProbes([
          probeAttendance(admin, req.actor.schoolId, studentId),
          probeHomework(admin, req.actor.schoolId, studentId),
          probeMarks(admin, req.actor.schoolId, studentId),
          probeEie(admin, req.actor.schoolId, studentId, req.actor.role),
        ]);
        const factsBundle = (await withCache(factsVersionSeed, async () => {
          const [attendance, homework, marks, eie] = await Promise.all([
            fetchAttendance(admin, req.actor.schoolId, studentId),
            fetchHomeworkDue(admin, req.actor.schoolId, studentId),
            fetchMarksSummary(admin, req.actor.schoolId, studentId),
            fetchEie(admin, req.actor.schoolId, studentId, req.actor.role),
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
            system_template: modelResult.prompt?.system_template,
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
        const eie = (await withCache(await probeEie(admin, req.actor.schoolId, studentId, req.actor.role), () =>
          fetchEie(admin, req.actor.schoolId, studentId, req.actor.role),
        )) as Awaited<ReturnType<typeof fetchEie>>;
        // Was missing req.actor.role, which is why the parameter had been
        // optional. student.recommendations is reachable by staff.
        const parentLike = await fetchParentSummary(admin, req.actor.schoolId, studentId, req.actor.role);
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
        const queryEmbedding = await resolveQueryEmbedding(query);
        const pack: RetrievalPack = await retrieveKmsChunks(admin, {
          school_id: req.actor.schoolId,
          query,
          role,
          limit: 5,
          min_score: 0.12,
          query_embedding: queryEmbedding,
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
          vector_attempted: pack.vector_attempted ?? false,
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
          const queryEmbedding = await resolveQueryEmbedding(retrieveQuery);
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
            query_embedding: queryEmbedding,
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
        // AI-02 fix: outlineInSession/outlineFromSession gate whether a marking
        // scheme can be drafted at all — they must only ever be satisfied by
        // session memory (written server-side after generate_outline actually
        // ran), never by structured.outline_text, which is client-supplied on
        // this very request. Trusting the client payload here let a teacher
        // call marking_scheme directly with an arbitrary made-up "outline",
        // skipping the intended generate_outline step entirely.
        const outlineFromSession =
          (typeof flagsObj.outline_text === "string" && flagsObj.outline_text.trim()
            ? flagsObj.outline_text
            : null) ??
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
        const classByStudent = new Map(
          (schoolStudents ?? []).map((s) => [String(s.id), s.class_id ? String(s.class_id) : null]),
        );

        // Chunk 7B: REMOVED — a school-wide practice aggregate served to a
        // principal. It read concept_mastery for up to 500 students and
        // reduced it to avg_mastery and weak_concept_count.
        //
        // 10.8 is not only "no individual practice data": it says no teacher,
        // parent, principal, admin, "or aggregate". Chunk 1.6 deleted
        // rpc_teacher_concept_analytics() for serving exactly this shape at the
        // RPC layer; it survived here because this runs on the service role,
        // where RLS never applies and policy-level auditing does not look.
        //
        // avg_mastery and weak_concept_count stay in the response and stay
        // NULL. They are not zeroed (G4): the brief must say it has no such
        // figure, not that the figure is nought. The consumer at
        // `avgMastery != null` already handles the absent case.
        //
        // A school-health signal is legitimate — it must be derived from tests
        // and exams, which are school data, not from practice. Nothing is
        // substituted here: 1.6's rule is to leave it absent and report it,
        // because quietly swapping the source is how the leak returns.
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
        const eie = (await withCache(await probeEie(admin, req.actor.schoolId, studentId, req.actor.role), () =>
          fetchEie(admin, req.actor.schoolId, studentId, req.actor.role),
        )) as Awaited<ReturnType<typeof fetchEie>>;
        const concept = pickConceptFromEie(eie, req.input_text);

        // Retrieve-before-model: KMS-approved chunks when present
        const retrieveQuery = (req.input_text ?? concept?.name ?? "").trim();
        let retrievalPack: RetrievalPack | null = null;
        if (retrieveQuery) {
          const queryEmbedding = await resolveQueryEmbedding(retrieveQuery);
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
            query_embedding: queryEmbedding,
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
            system_template: modelResult.prompt?.system_template,
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

        // Recent turns + current-question context — client-supplied per-request only, never
        // persisted server-side (session memory stores structured flags, not transcripts).
        // Re-capped here regardless of any client-side cap; never trust client bounds.
        const structuredInput = req.input_structured ?? {};
        const rawTurns = Array.isArray(structuredInput.recent_turns)
          ? (structuredInput.recent_turns as unknown[])
          : [];
        const historyLines = rawTurns
          .slice(-6)
          .map((t) => {
            if (!t || typeof t !== "object") return null;
            const role = (t as { role?: unknown }).role === "nova" ? "Nova" : "Student";
            const text = (t as { text?: unknown }).text;
            const trimmed = typeof text === "string" ? text.trim().slice(0, 500) : "";
            return trimmed ? `${role}: ${trimmed}` : null;
          })
          .filter((l): l is string => Boolean(l));

        const qc = structuredInput.question_context;
        const questionContextBlock = (() => {
          if (!qc || typeof qc !== "object") return null;
          const q = qc as Record<string, unknown>;
          const qText = typeof q.question === "string" ? q.question.trim().slice(0, 1000) : "";
          if (!qText) return null;
          const options = Array.isArray(q.options) ? (q.options as unknown[]).slice(0, 8) : [];
          const optsLine = options.length
            ? options
                .map((o, i) => `${String.fromCharCode(65 + i)}. ${String(o).slice(0, 300)}`)
                .join(" | ")
            : "";
          const correctIdx = typeof q.correct_index === "number" ? q.correct_index : null;
          const correctLabel =
            correctIdx != null && options[correctIdx] != null
              ? `${String.fromCharCode(65 + correctIdx)}. ${String(options[correctIdx]).slice(0, 300)}`
              : null;
          const subjBits = [q.subject, q.chapter, q.topic].filter(
            (v): v is string => typeof v === "string" && v.trim().length > 0,
          );
          return (
            `The student is currently viewing this practice question` +
            (subjBits.length ? ` (${subjBits.join(" · ")})` : "") +
            `:\n"${qText}"` +
            (optsLine ? `\nOptions: ${optsLine}` : "") +
            (correctLabel ? `\nCorrect answer: ${correctLabel}` : "")
          );
        })();

        const contextPreamble = [
          questionContextBlock,
          historyLines.length
            ? `Previous turns in this conversation (most recent last):\n${historyLines.join("\n")}`
            : null,
        ]
          .filter((v): v is string => Boolean(v))
          .join("\n\n");

        // Attached photos/PDF pages — client-supplied data URIs only, never a stored/public URL
        // (never persisted server-side; sent inline to the model and discarded). Re-capped here
        // regardless of any client-side cap; never trust client bounds. Re-capping to 3 images ×
        // ~6MB matches roughly what a compressed photo or rendered PDF page needs.
        const rawImages = Array.isArray(structuredInput.images)
          ? (structuredInput.images as unknown[])
          : [];
        const images = rawImages
          .filter((v): v is string => typeof v === "string" && v.startsWith("data:image/"))
          .filter((v) => v.length < 8_000_000)
          .slice(0, 3);

        // No image-generation provider is connected (verified: no image endpoint, key, or SDK
        // anywhere in this codebase — OpenRouter is used for text chat + vision INPUT only).
        // Detect an explicit "make me a picture/diagram" request and decline honestly and
        // immediately, rather than silently forwarding it to the text model — which cannot
        // produce an image and may hallucinate having done so (a known LLM failure mode).
        const IMAGE_GENERATION_INTENT =
          /\b(draw|generate|create|make|design|sketch|paint|produce)\b[^.?!\n]{0,40}\b(diagram|picture|image|illustration|drawing|graphic|infographic|poster|photo|artwork)\b/i;
        if (IMAGE_GENERATION_INTENT.test(question)) {
          const reply =
            "I can't generate images or diagrams yet — that capability isn't connected for Nova. " +
            "I can describe it step by step in words instead, or you could ask your teacher for a " +
            "diagram. Want a detailed text description?";
          const conf = scoreConfidence({
            used_model: false, cache_hit: false, completeness: 1,
            source_as_of: null, route_class: cap.route_class, budget_tier: "simple",
          });
          decision = "answered_capability_unavailable";
          data = {
            reply, explanation: reply, facts: null, language,
            facts_empty: false, source: "capability_gap",
          };
          provenance = {
            algorithm_id: "image_generation_unavailable_v1", completeness: 1,
            data_version: "static", budget_tier: "simple", source_as_of: null,
          };
          await writeDecision(admin, {
            request_id: req.request_id, school_id: req.actor.schoolId,
            actor_user_id: req.actor.userId, actor_role: req.actor.role,
            feature_id: cap.feature_id, route_class: cap.route_class, decision,
            used_model: false, cache_hit: false, latency_ms: Date.now() - started,
            confidence: conf.confidence, budget_tier: "simple", validation_ok: true,
            estimated_cost_units: 0,
            evidence: { student_id: studentId, language, intent: "image_generation_request" },
          });
          return {
            request_id: req.request_id, feature_id: cap.feature_id, decision,
            route_class: cap.route_class, used_model: false, cache_hit: false,
            data, provenance, confidence: conf.confidence, budget_tier: "simple",
          };
        }

        const factsVersionSeed = await combineProbes([
          probeAttendance(admin, req.actor.schoolId, studentId),
          probeHomework(admin, req.actor.schoolId, studentId),
          probeMarks(admin, req.actor.schoolId, studentId),
          probeEie(admin, req.actor.schoolId, studentId, req.actor.role),
          probeParentSummary(admin, req.actor.schoolId, studentId),
          probeProgression(admin, req.actor.schoolId, studentId),
          probeStudentProfile(admin, req.actor.schoolId, studentId),
          probePracticeHistory(admin, req.actor.schoolId, studentId),
          probeMistakesBook(admin, req.actor.schoolId, studentId),
          probeRecoveryQueue(admin, req.actor.schoolId, studentId),
          probeUpcomingEvents(admin, req.actor.schoolId, studentId),
        ]);
        // The actor role is part of the key: the bundle now differs by role (practice
        // facts are student-only), so a student-built bundle must never be replayed
        // to a parent or teacher out of the cache.
        const factsBundle = (await withCache(`${factsVersionSeed}:${examsVisibilityTier}:${req.actor.role}`, async () => {
          const [
            attendance,
            homework,
            marks,
            eie,
            profile,
            progression,
            student_profile,
            practice,
            mistakes,
            recovery,
            events,
          ] = await Promise.all([
            fetchAttendance(admin, req.actor.schoolId, studentId),
            fetchHomeworkDue(admin, req.actor.schoolId, studentId),
            fetchMarksSummary(admin, req.actor.schoolId, studentId),
            fetchEie(admin, req.actor.schoolId, studentId, req.actor.role),
            fetchParentSummary(admin, req.actor.schoolId, studentId, req.actor.role),
            fetchProgression(admin, req.actor.schoolId, studentId, req.actor.role),
            fetchStudentProfileContext(admin, req.actor.schoolId, studentId),
            fetchPracticeHistory(admin, req.actor.schoolId, studentId, req.actor.role),
            fetchMistakesBook(admin, req.actor.schoolId, studentId, req.actor.role),
            fetchRecoveryQueue(admin, req.actor.schoolId, studentId, req.actor.role),
            fetchUpcomingEvents(admin, req.actor.schoolId, studentId),
          ]);
          // Merge enrolled subjects with practice/marks subjects (deduped).
          const subjects = dedupeSubjects([
            ...student_profile.subjects,
            ...practice.subjects,
            ...marks.subjects.map((s) => s.subject),
            ...mistakes.subjects,
            ...recovery.subjects,
          ]);
          return {
            attendance,
            homework,
            marks,
            eie,
            profile,
            progression,
            student_profile: { ...student_profile, subjects },
            practice,
            mistakes,
            recovery,
            events,
            data_version: `nova:${attendance.data_version}:${homework.data_version}:${marks.data_version}:${eie.data_version}:${profile.data_version}:${progression.data_version}:${student_profile.data_version}:${practice.data_version}:${mistakes.data_version}:${recovery.data_version}:${events.data_version}`,
            source_as_of: (() => {
              const stamps = [
                attendance.source_as_of,
                homework.source_as_of,
                marks.source_as_of,
                eie.computed_at,
                profile.source_as_of,
                progression.source_as_of,
                student_profile.source_as_of,
                practice.source_as_of,
                mistakes.source_as_of,
                recovery.source_as_of,
                events.source_as_of,
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
                progression.completeness +
                student_profile.completeness +
                practice.completeness +
                mistakes.completeness +
                recovery.completeness +
                events.completeness) /
              11,
          };
        })) as {
          attendance: Awaited<ReturnType<typeof fetchAttendance>>;
          homework: Awaited<ReturnType<typeof fetchHomeworkDue>>;
          marks: Awaited<ReturnType<typeof fetchMarksSummary>>;
          eie: Awaited<ReturnType<typeof fetchEie>>;
          profile: Awaited<ReturnType<typeof fetchParentSummary>>;
          progression: Awaited<ReturnType<typeof fetchProgression>>;
          student_profile: Awaited<ReturnType<typeof fetchStudentProfileContext>> & {
            subjects: string[];
          };
          practice: Awaited<ReturnType<typeof fetchPracticeHistory>>;
          mistakes: Awaited<ReturnType<typeof fetchMistakesBook>>;
          recovery: Awaited<ReturnType<typeof fetchRecoveryQueue>>;
          events: Awaited<ReturnType<typeof fetchUpcomingEvents>>;
          data_version: string;
          source_as_of: string | null;
          completeness: number;
        };

        const {
          attendance,
          homework,
          marks,
          eie,
          profile,
          progression,
          student_profile,
          practice,
          mistakes,
          recovery,
          events,
        } = factsBundle;
        const facts = {
          attendance,
          homework,
          marks,
          eie,
          profile,
          progression,
          student_profile,
          practice,
          mistakes,
          recovery,
          events,
        };
        const factsEmpty =
          factsBundle.completeness < 0.25 &&
          !(eie.weak_concepts?.length || eie.strong_concepts?.length) &&
          !profile.weak_topics?.length &&
          // practice_sessions is present only for the student themselves; for a
          // parent or teacher its absence is not evidence of emptiness, so it only
          // counts toward "no facts" when it was actually supplied.
          !(progression.xp > 0 || (progression.practice_sessions ?? 0) > 0) &&
          !(practice.sessions_completed > 0 || mistakes.open_count > 0 || recovery.pending_count > 0);

        // Question matching — two-stage, across BOTH question_bank (authoritative) and
        // ai_answer_cache (previously validated Nova-generated answers). Skipped entirely when
        // an image is attached (nothing to text-match against a photo) or question_context is
        // already known (exact question already identified — search could only add noise).
        // class_level is a hard SQL filter, never part of the similarity score, so a
        // semantically-similar-but-wrong-class question can never be returned regardless of
        // embedding quality.
        //
        // STAGE 1 (retrieval): broad similarity floor (0.65) across both sources.
        // STAGE 2 (verification): the top candidate is only ever treated as EXACT — safe to
        // return its stored answer directly — when similarity is also >= 0.78 AND every numeric
        // value in the two questions matches exactly (numbersMatch). This second gate is not
        // optional: verified empirically that a same-template-different-values pair can score
        // HIGHER (0.94) than a genuine same-question paraphrase (0.79) — cosine similarity alone
        // cannot distinguish "same question" from "same method, different numbers," and reusing
        // a cached numeric answer for different values would silently hand a student someone
        // else's answer. Below the EXACT bar but still >= 0.65, the candidate becomes a
        // REFERENCE: folded into the model prompt as a worked example to reuse the method
        // against, never as a ready-made answer — the model still calculates fresh for this
        // student's actual values.
        let queryEmbedding: number[] | null = null;
        let matchClassLevel: number | null = null;
        let matchSubjects: string[] | null = null;
        let referenceBlock: string | null = null;
        let matchedSubjectHint: string | null = null;
        if (!images.length && !questionContextBlock) {
          const classLevelMatch = /(\d+)/.exec(
            student_profile.class_name ?? student_profile.class_label ?? "",
          );
          matchClassLevel = classLevelMatch ? parseInt(classLevelMatch[1], 10) : null;
          if (matchClassLevel != null && matchClassLevel >= 1 && matchClassLevel <= 12) {
            try {
              queryEmbedding = await resolveQueryEmbedding(question);
              if (queryEmbedding) {
                matchSubjects = student_profile.subjects?.length ? student_profile.subjects : null;
                const [bankRes, cacheRes] = await Promise.all([
                  admin.rpc("match_question_bank", {
                    p_query_embedding: queryEmbedding,
                    p_class_level: matchClassLevel,
                    p_school_id: req.actor.schoolId,
                    p_subjects: matchSubjects,
                    p_match_threshold: 0.65,
                    p_match_count: 2,
                  }),
                  admin.rpc("match_ai_answer_cache", {
                    p_query_embedding: queryEmbedding,
                    p_class_level: matchClassLevel,
                    p_school_id: req.actor.schoolId,
                    p_subjects: matchSubjects,
                    p_match_threshold: 0.65,
                    p_match_count: 2,
                  }),
                ]);
                const bankRows: Record<string, unknown>[] =
                  !bankRes.error && Array.isArray(bankRes.data)
                    ? (bankRes.data as Record<string, unknown>[])
                    : [];
                const cacheRows: Record<string, unknown>[] =
                  !cacheRes.error && Array.isArray(cacheRes.data)
                    ? (cacheRes.data as Record<string, unknown>[])
                    : [];
                const bankCandidates: (Record<string, unknown> & { __source: "question_bank" })[] =
                  bankRows.map((m) => ({ ...m, __source: "question_bank" as const }));
                const cacheCandidates: (Record<string, unknown> & { __source: "ai_answer_cache" })[] =
                  cacheRows.map((m) => ({
                    ...m,
                    question: m.original_question,
                    __source: "ai_answer_cache" as const,
                  }));
                const best = ([...bankCandidates, ...cacheCandidates] as (Record<string, unknown> & {
                  __source: "question_bank" | "ai_answer_cache";
                })[]).sort((a, b) => Number(b.similarity) - Number(a.similarity))[0];

                if (best) {
                  const similarity = Number(best.similarity);
                  const candidateQuestion = String(best.question ?? "");
                  const isExact = similarity >= 0.78 && numbersMatch(question, candidateQuestion);

                  if (isExact && best.__source === "question_bank") {
                    const opts: string[] = Array.isArray(best.options) ? best.options as string[] : [];
                    const idx = typeof best.correct_index === "number" ? best.correct_index : null;
                    const letter = idx != null ? String.fromCharCode(65 + idx) : null;
                    const correctText = idx != null ? opts[idx] : null;
                    const bankReply =
                      `This matches a question already in our records` +
                      (best.chapter ? ` (${best.chapter})` : "") +
                      `:\n\n**${candidateQuestion}**\n\n` +
                      (letter && correctText ? `The correct answer is **${letter}. ${correctText}**.\n\n` : "") +
                      (best.explanation ? String(best.explanation) : "");
                    const conf = scoreConfidence({
                      used_model: false, cache_hit: true, completeness: 1,
                      source_as_of: null, route_class: cap.route_class, budget_tier: "simple",
                    });
                    decision = "answered_retrieval";
                    data = {
                      reply: bankReply, explanation: bankReply, facts, language,
                      facts_empty: factsEmpty, source: "question_bank", match_similarity: similarity,
                    };
                    provenance = {
                      algorithm_id: "question_bank_semantic_match_v1", completeness: 1,
                      data_version: factsBundle.data_version, budget_tier: "simple", source_as_of: null,
                    };
                    await writeDecision(admin, {
                      request_id: req.request_id, school_id: req.actor.schoolId,
                      actor_user_id: req.actor.userId, actor_role: req.actor.role,
                      feature_id: cap.feature_id, route_class: cap.route_class, decision,
                      used_model: false, cache_hit: true, latency_ms: Date.now() - started,
                      confidence: conf.confidence, budget_tier: "simple", validation_ok: true,
                      estimated_cost_units: 0,
                      evidence: { student_id: studentId, matched_question_id: best.id, similarity, language },
                    });
                    return {
                      request_id: req.request_id, feature_id: cap.feature_id, decision,
                      route_class: cap.route_class, used_model: false, cache_hit: true,
                      data, provenance, confidence: conf.confidence, budget_tier: "simple",
                    };
                  }

                  if (isExact && best.__source === "ai_answer_cache") {
                    const cachedReply = String(best.answer ?? "");
                    const conf = scoreConfidence({
                      used_model: false, cache_hit: true, completeness: 1,
                      source_as_of: null, route_class: cap.route_class, budget_tier: "simple",
                    });
                    decision = "answered_cache";
                    data = {
                      reply: cachedReply, explanation: cachedReply, facts, language,
                      facts_empty: factsEmpty, source: "ai_answer_cache", match_similarity: similarity,
                    };
                    provenance = {
                      algorithm_id: "ai_answer_cache_semantic_match_v1", completeness: 1,
                      data_version: factsBundle.data_version, budget_tier: "simple", source_as_of: null,
                    };
                    await writeDecision(admin, {
                      request_id: req.request_id, school_id: req.actor.schoolId,
                      actor_user_id: req.actor.userId, actor_role: req.actor.role,
                      feature_id: cap.feature_id, route_class: cap.route_class, decision,
                      used_model: false, cache_hit: true, latency_ms: Date.now() - started,
                      confidence: conf.confidence, budget_tier: "simple", validation_ok: true,
                      estimated_cost_units: 0,
                      evidence: { student_id: studentId, matched_cache_id: best.id, similarity, language },
                    });
                    admin.rpc("bump_ai_answer_cache_hit", { p_id: best.id }).then(
                      () => {}, () => {},
                    );
                    return {
                      request_id: req.request_id, feature_id: cap.feature_id, decision,
                      route_class: cap.route_class, used_model: false, cache_hit: true,
                      data, provenance, confidence: conf.confidence, budget_tier: "simple",
                    };
                  }

                  // Not exact (either similarity or numbers didn't clear the bar), but relevant
                  // enough to use as a worked-method reference for a fresh, recalculated answer.
                  const refAnswer = best.__source === "question_bank" ? String(best.explanation ?? "") : String(best.answer ?? "");
                  if (refAnswer.trim()) {
                    referenceBlock =
                      `A similar previously-solved question exists (do NOT reuse its specific numeric ` +
                      `answer — the values here may differ; use the same method/approach and calculate ` +
                      `fresh for THIS question's actual values):\n"${candidateQuestion}"\n${refAnswer}`;
                  }
                  if (typeof best.subject === "string" && best.subject.trim()) {
                    matchedSubjectHint = best.subject;
                  }
                }
              }
            } catch (e) {
              // Embedding/match failure never blocks the chat — fall through to
              // generation. G10: falling through is fine; doing it silently is not,
              // because a permanently-failing embed looks identical to a cache miss.
              console.warn(
                "[nova] question match/embed failed, falling through to generation:",
                e instanceof Error ? e.message : e,
              );
            }
          }
        }

        const pack = buildContextPack({
          capability: cap.feature_id,
          request_text: question,
          ae: {
            attendance,
            homework,
            marks,
            profile,
            progression,
            student_profile,
            practice,
            mistakes,
            recovery,
            events,
          },
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

        // History/question-context/reference are folded into the question text (not a new
        // template var) so they reach the model regardless of whether the production or
        // builtin prompt is active.
        const fullPreamble = [contextPreamble, referenceBlock].filter(Boolean).join("\n\n");
        const modelQuestion = fullPreamble
          ? `${fullPreamble}\n\nStudent's new message: ${question}`
          : question;

        const modelResult = await completeWithPromptLibrary({
          admin,
          capability_id: cap.feature_id,
          vars: { question: modelQuestion, language, facts: factsJson },
          images: images.length ? images : undefined,
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
              : "Nova could not reach the AI model right now. Try attendance, homework, marks, or mastery — those still work without generative credits.",
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
          system_template: modelResult.prompt?.system_template,
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

        // Save a genuinely new, successfully-answered question into the learned cache so a
        // future differently-worded question from another student can reuse it — never
        // question_bank (that stays authoritative/curated only). Best-effort, fire-and-forget:
        // a save failure must never affect the response already being returned to this student.
        // Eligibility mirrors the lookup gate above (no image, no question_context, class known)
        // plus requiring we actually have the embedding already computed (avoids a second paid
        // embedding call) and a non-empty validated reply. Live-verified end to end: a fresh
        // question saves here, and a later differently-worded equivalent (via
        // match_ai_answer_cache) retrieves it directly with zero model cost.
        if (
          matchClassLevel != null &&
          !images.length &&
          !questionContextBlock &&
          queryEmbedding &&
          modelResult.text.trim()
        ) {
          admin
            .from("ai_answer_cache")
            .insert({
              original_question: question,
              answer: modelResult.text,
              embedding: `[${queryEmbedding.join(",")}]`,
              class_level: matchClassLevel,
              subject: matchedSubjectHint,
              model_id: model_id ?? null,
              request_id: req.request_id,
              school_id: req.actor.schoolId,
            })
            .then(
              (res) => {
                if (res.error) console.error("ai_answer_cache insert failed:", JSON.stringify(res.error));
              },
              (e) => console.error("ai_answer_cache insert threw:", e instanceof Error ? e.message : String(e)),
            );
        }

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
            fallback_used: modelResult.fallback_used ?? false,
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
