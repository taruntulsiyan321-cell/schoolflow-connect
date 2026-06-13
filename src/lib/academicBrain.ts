import { supabase } from "@/integrations/supabase/client";

export type AcademicBrain = {
  id?: string;
  user_id?: string;
  strong_subjects: { subject: string; avg_mastery: number }[];
  weak_subjects: { subject: string; avg_mastery: number }[];
  strong_chapters: { chapter: string; subject: string; avg_mastery?: number }[];
  weak_chapters: { chapter: string; subject: string; avg_mastery?: number }[];
  strong_concepts: { concept: string; subject: string; chapter?: string; mastery_score: number }[];
  weak_concepts: { concept: string; subject: string; chapter?: string; mastery_score: number; mistake_count?: number }[];
  mistake_history: Record<string, unknown>;
  recovery_history: Record<string, unknown>;
  practice_history: Record<string, unknown>;
  speed_trend: Record<string, unknown>;
  accuracy_trend: Record<string, unknown>;
  consistency_trend: Record<string, unknown>;
  mastery_snapshot: unknown[];
  mistake_classification_trends: Record<string, number>;
  last_session_analytics: Record<string, unknown>;
  recovery_completion_pct: number;
  improvement_trend: "improving" | "slipping" | "steady";
  total_activities: number;
  updated_at?: string;
};

export type RevisionPlanPayload = {
  queue_items: {
    id?: string;
    subject: string;
    chapter?: string;
    topic?: string;
    reason?: string;
    priority: number;
    due_date?: string;
    priority_label?: string;
    source?: string;
  }[];
  brain_priorities: {
    concept: string;
    subject: string;
    chapter?: string;
    mastery_score?: number;
    priority: number;
    action?: string;
    source?: string;
  }[];
  improvement_trend: string;
  recovery_completion_pct: number;
  sort_note: string;
};

const EMPTY_BRAIN: AcademicBrain = {
  strong_subjects: [],
  weak_subjects: [],
  strong_chapters: [],
  weak_chapters: [],
  strong_concepts: [],
  weak_concepts: [],
  mistake_history: {},
  recovery_history: {},
  practice_history: {},
  speed_trend: {},
  accuracy_trend: {},
  consistency_trend: {},
  mastery_snapshot: [],
  mistake_classification_trends: {},
  last_session_analytics: {},
  recovery_completion_pct: 0,
  improvement_trend: "steady",
  total_activities: 0,
};

function normalizeBrain(raw: Record<string, unknown> | null): AcademicBrain {
  if (!raw) return { ...EMPTY_BRAIN };
  return {
    ...EMPTY_BRAIN,
    ...raw,
    strong_subjects: (raw.strong_subjects as AcademicBrain["strong_subjects"]) ?? [],
    weak_subjects: (raw.weak_subjects as AcademicBrain["weak_subjects"]) ?? [],
    strong_chapters: (raw.strong_chapters as AcademicBrain["strong_chapters"]) ?? [],
    weak_chapters: (raw.weak_chapters as AcademicBrain["weak_chapters"]) ?? [],
    strong_concepts: (raw.strong_concepts as AcademicBrain["strong_concepts"]) ?? [],
    weak_concepts: (raw.weak_concepts as AcademicBrain["weak_concepts"]) ?? [],
    improvement_trend: (raw.improvement_trend as AcademicBrain["improvement_trend"]) ?? "steady",
    recovery_completion_pct: Number(raw.recovery_completion_pct ?? 0),
    total_activities: Number(raw.total_activities ?? 0),
  };
}

export async function fetchAcademicBrain(): Promise<AcademicBrain> {
  const { data, error } = await supabase.rpc("rpc_get_academic_brain");
  if (error) throw new Error(error.message);
  return normalizeBrain(data as Record<string, unknown>);
}

export async function refreshAcademicBrain(): Promise<AcademicBrain> {
  const { data, error } = await supabase.rpc("rpc_refresh_academic_brain");
  if (error) throw new Error(error.message);
  return normalizeBrain(data as Record<string, unknown>);
}

export async function fetchRevisionPlan(): Promise<RevisionPlanPayload> {
  const { data, error } = await supabase.rpc("rpc_academic_revision_plan");
  if (error) throw new Error(error.message);
  const payload = data as RevisionPlanPayload;
  return {
    queue_items: payload?.queue_items ?? [],
    brain_priorities: payload?.brain_priorities ?? [],
    improvement_trend: payload?.improvement_trend ?? "steady",
    recovery_completion_pct: Number(payload?.recovery_completion_pct ?? 0),
    sort_note: payload?.sort_note ?? "",
  };
}

export async function computeSessionAnalyticsRpc(sessionId?: string) {
  const { data, error } = await supabase.rpc("rpc_compute_session_analytics", {
    _session_id: sessionId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function cacheAgentInsight(
  agentType: "learning_pattern" | "recovery" | "revision" | "coach",
  payload: Record<string, unknown>,
  source: "coach" | "rule" = "coach",
) {
  await supabase.rpc("rpc_cache_agent_insight", {
    _agent_type: agentType,
    _payload: payload,
    _source: source,
    _ttl_hours: 6,
  });
}

export async function getCachedAgentInsight(agentType: string) {
  const { data } = await supabase.rpc("rpc_get_cached_agent_insight", { _agent_type: agentType });
  if (!data || data === null) return null;
  return data as Record<string, unknown>;
}

/** Build structured agent payload — no raw test data. */
export function buildAgentPayload(brain: AcademicBrain, displayName?: string) {
  return {
    display_name: displayName ?? "Student",
    academic_brain: {
      strong_subjects: brain.strong_subjects.slice(0, 4),
      weak_subjects: brain.weak_subjects.slice(0, 4),
      strong_chapters: brain.strong_chapters.slice(0, 5),
      weak_chapters: brain.weak_chapters.slice(0, 5),
      strong_concepts: brain.strong_concepts.slice(0, 6),
      weak_concepts: brain.weak_concepts.slice(0, 8),
      mistake_history: brain.mistake_history,
      recovery_history: brain.recovery_history,
      practice_history: brain.practice_history,
      speed_trend: brain.speed_trend,
      accuracy_trend: brain.accuracy_trend,
      consistency_trend: brain.consistency_trend,
      mastery_snapshot: brain.mastery_snapshot,
      mistake_classification_trends: brain.mistake_classification_trends,
      last_session_analytics: brain.last_session_analytics,
      recovery_completion_pct: brain.recovery_completion_pct,
      improvement_trend: brain.improvement_trend,
      total_activities: brain.total_activities,
    },
  };
}
