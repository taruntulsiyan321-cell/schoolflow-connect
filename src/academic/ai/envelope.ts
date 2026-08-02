/**
 * AI request envelope — SSOT §5.1.
 * Clients may send feature_id / input / target_refs; Gateway injects
 * request_id, tenant_id, and actor from the authenticated session.
 */

export type AiChannel =
  | "student_app"
  | "teacher_workspace"
  | "parent_app"
  | "principal_dashboard"
  | "admin_console"
  | "api";

export type AiInteractionMode = "interactive" | "streaming" | "batch" | "asynchronous";

/** Valid AI actor roles only — never super_admin (not a school portal role). */
export type AiActorRole = "student" | "teacher" | "parent" | "principal" | "admin";

export interface AiActor {
  userId: string;
  role: AiActorRole;
  studentId?: string | null;
  teacherId?: string | null;
  classIds?: string[];
}

export interface AiTargetRefs {
  studentId?: string;
  classId?: string;
  subject?: string;
  chapter?: string;
  assignmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  date?: string;
}

export interface AiClientRequest {
  /** Registered capability, e.g. student.attendance.query */
  feature_id: string;
  intent_hint?: string;
  input?: {
    text?: string;
    structured?: Record<string, unknown>;
  };
  target_refs?: AiTargetRefs;
  locale?: string;
  interaction_mode?: AiInteractionMode;
  channel?: AiChannel;
  client_context_version?: string;
  /** Optional client-supplied id; Gateway may replace */
  request_id?: string;
  /** Existing multi-turn session from a prior gateway response */
  session_id?: string;
  /** Ask gateway to open a short workflow session (Nova chat) */
  open_session?: boolean;
}

/** Immutable envelope after Gateway binding — clients must not forge these. */
export interface AiBoundEnvelope extends AiClientRequest {
  request_id: string;
  tenant_id: string;
  actor: AiActor;
  channel: AiChannel;
  interaction_mode: AiInteractionMode;
  bound_at: string;
}

export type AiRouteClass =
  | "deterministic_record"
  | "deterministic_insight"
  | "cached_explanation"
  | "eie_insight"
  | "grounded_retrieval"
  | "personalised_intelligence"
  | "content_generation"
  | "multimodal"
  | "recommendation"
  | "sensitive"
  | "unsupported";

export type AiDecisionKind =
  | "answered_deterministic"
  | "answered_eie"
  | "answered_cache"
  | "answered_retrieval"
  | "answered_model"
  | "answered_facts_only"
  | "rejected"
  | "permission_denied"
  | "degraded"
  | "kill_switch";

export interface AiGatewayResponse<T = unknown> {
  request_id: string;
  feature_id: string;
  decision: AiDecisionKind;
  route_class: AiRouteClass;
  used_model: boolean;
  cache_hit: boolean;
  data: T | null;
  message?: string;
  provenance?: {
    source_as_of?: string | null;
    data_version?: string;
    completeness?: number;
    algorithm_id?: string;
  };
  error_code?: string;
  /** Present when multi-turn session memory is active */
  session_id?: string;
}

export class EnvelopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeValidationError";
  }
}

/** Bind session identity into an immutable envelope. Rejects client tenant/actor overrides. */
export function bindEnvelope(
  client: AiClientRequest,
  session: {
    tenantId: string;
    actor: AiActor;
    requestId?: string;
  },
): AiBoundEnvelope {
  if (!client.feature_id || typeof client.feature_id !== "string") {
    throw new EnvelopeValidationError("feature_id is required");
  }
  if (!session.tenantId) {
    throw new EnvelopeValidationError("tenant_id missing from session");
  }
  if (!session.actor?.userId || !session.actor?.role) {
    throw new EnvelopeValidationError("actor missing from session");
  }

  // Reject forged identity fields if a client smuggles them on the body.
  const raw = client as AiClientRequest & { tenant_id?: string; actor?: AiActor };
  if (raw.tenant_id != null && raw.tenant_id !== session.tenantId) {
    throw new EnvelopeValidationError("Clients may not override tenant_id");
  }
  if (raw.actor?.userId != null && raw.actor.userId !== session.actor.userId) {
    throw new EnvelopeValidationError("Clients may not override actor identity");
  }

  return {
    ...client,
    request_id: session.requestId ?? client.request_id ?? cryptoRandomId(),
    tenant_id: session.tenantId,
    actor: { ...session.actor },
    channel: client.channel ?? "student_app",
    interaction_mode: client.interaction_mode ?? "interactive",
    bound_at: new Date().toISOString(),
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
