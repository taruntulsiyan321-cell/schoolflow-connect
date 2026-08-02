/**
 * AI Session Memory v1 — workflow-scoped short memory.
 * Scopes: tutoring | paper_gen | parent_guidance | principal_analytics.
 * Never stores unrestricted chat history.
 */

export type SessionWorkflowScope =
  | "tutoring"
  | "paper_gen"
  | "parent_guidance"
  | "principal_analytics";

export type SessionMemoryStatus = "active" | "closed" | "expired";

export type SessionMemoryRecord = {
  session_id: string;
  school_id?: string;
  workflow_scope: SessionWorkflowScope | string;
  capability_id?: string | null;
  workflow_id?: string | null;
  target_student_id?: string | null;
  status: SessionMemoryStatus | string;
  summary: Record<string, unknown>;
  turn_count: number;
  expires_at?: string;
  updated_at?: string;
};

/** Capabilities that may inject session memory into Context Builder. */
export const SESSION_MEMORY_CAPABILITIES: Record<string, SessionWorkflowScope> = {
  "student.concept.explain": "tutoring",
  "student.knowledge.retrieve": "tutoring",
  "student.image_doubt": "tutoring",
  "student.image_doubt.submit": "tutoring",
  "student.image_doubt.solve": "tutoring",
  "student.voice_doubt.submit": "tutoring",
  "teacher.question_paper.plan": "paper_gen",
  "teacher.question_paper.generate_outline": "paper_gen",
  "teacher.question_paper.marking_scheme": "paper_gen",
  "parent.child.summary": "parent_guidance",
  "parent.child.narrative": "parent_guidance",
  "principal.school.health_brief": "principal_analytics",
};

export function sessionScopeForCapability(featureId: string): SessionWorkflowScope | null {
  return SESSION_MEMORY_CAPABILITIES[featureId] ?? null;
}

export function isSessionMemoryAllowed(featureId: string): boolean {
  return sessionScopeForCapability(featureId) != null;
}

/** Build a compact summary patch — structured flags only. */
export function buildSessionSummaryPatch(input: {
  last_feature_id?: string;
  last_decision?: string;
  misconceptions_addressed?: string[];
  concepts_touched?: string[];
  plan_hash?: string;
  flags?: Record<string, unknown>;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.last_feature_id) patch.last_feature_id = input.last_feature_id;
  if (input.last_decision) patch.last_decision = input.last_decision;
  if (input.misconceptions_addressed?.length) {
    patch.misconceptions_addressed = input.misconceptions_addressed.slice(0, 8);
  }
  if (input.concepts_touched?.length) {
    patch.concepts_touched = input.concepts_touched.slice(0, 8);
  }
  if (input.plan_hash) patch.plan_hash = input.plan_hash;
  if (input.flags) patch.flags = input.flags;
  return patch;
}

export function redactSessionForContext(
  session: SessionMemoryRecord | null | undefined,
): Record<string, unknown> | null {
  if (!session || session.status !== "active") return null;
  const summary = session.summary ?? {};
  const rawFlags =
    summary.flags && typeof summary.flags === "object"
      ? (summary.flags as Record<string, unknown>)
      : {};
  // Never inject large outline/paper bodies into model context.
  const {
    outline_text: _outline,
    marking_scheme_text: _marking,
    full_paper: _paper,
    ...safeFlags
  } = rawFlags;
  return {
    workflow_scope: session.workflow_scope,
    turn_count: session.turn_count,
    misconceptions_addressed: summary.misconceptions_addressed ?? [],
    concepts_touched: summary.concepts_touched ?? [],
    last_decision: summary.last_decision ?? null,
    flags: safeFlags,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openSessionMemory(
  client: any,
  input: {
    school_id: string;
    workflow_scope: SessionWorkflowScope;
    capability_id?: string | null;
    workflow_id?: string | null;
    target_student_id?: string | null;
    ttl_minutes?: number;
    summary?: Record<string, unknown>;
  },
) {
  const { data, error } = await client.rpc("ai_session_memory_open", {
    p_school_id: input.school_id,
    p_workflow_scope: input.workflow_scope,
    p_capability_id: input.capability_id ?? null,
    p_workflow_id: input.workflow_id ?? null,
    p_target_student_id: input.target_student_id ?? null,
    p_ttl_minutes: input.ttl_minutes ?? 120,
    p_summary: input.summary ?? {},
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data: data as SessionMemoryRecord };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readSessionMemory(client: any, sessionId: string) {
  const { data, error } = await client.rpc("ai_session_memory_read", {
    p_session_id: sessionId,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  if (!data) return { ok: true as const, data: null as SessionMemoryRecord | null };
  return { ok: true as const, data: data as SessionMemoryRecord };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function appendSessionMemory(
  client: any,
  sessionId: string,
  summaryPatch: Record<string, unknown>,
  incrementTurn = true,
) {
  const { data, error } = await client.rpc("ai_session_memory_append", {
    p_session_id: sessionId,
    p_summary_patch: summaryPatch,
    p_increment_turn: incrementTurn,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function closeSessionMemory(client: any, sessionId: string) {
  const { data, error } = await client.rpc("ai_session_memory_close", {
    p_session_id: sessionId,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}
