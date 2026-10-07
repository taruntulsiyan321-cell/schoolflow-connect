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
  | "unsupported"
  /** Answered by the plan check, not routed (decision plan_limit). */
  | "premium";

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
  | "kill_switch"
  /** The caller's plan refused the turn (20261111000000); `premium` carries the decision. */
  | "plan_limit";

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

