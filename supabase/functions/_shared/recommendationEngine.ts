/**
 * Edge Recommendation Engine v1 — mirrors src/academic/ai/recommendationEngine.ts
 */

export type RecommendationAction = {
  action_id: string;
  kind: "next_concept" | "revision_priority" | "attendance_checkin" | "homework_catchup";
  title: string;
  subject: string | null;
  concept_or_topic: string | null;
  priority: number;
  reason_codes: string[];
  metrics: Record<string, number | string | null>;
};

export type RecommendationPackage = {
  projection: "RecommendationPackage";
  version: 1;
  studentId: string;
  schoolId: string;
  intelligence_version: string;
  completeness: number;
  actions: RecommendationAction[];
  source_as_of: string | null;
  data_version: string;
};

export function buildRecommendationPackage(input: {
  studentId: string;
  schoolId: string;
  intelligence_version: string;
  completeness: number;
  weak_concepts: {
    subject: string;
    chapter?: string | null;
    concept: string;
    mastery_score: number;
    band?: string;
    mistake_count?: number;
  }[];
  revision_priority: {
    subject: string;
    chapter?: string | null;
    topic?: string | null;
    reason?: string | null;
    priority: number;
    due_date?: string | null;
  }[];
  attendance_pct?: number | null;
  homework_completion_pct?: number | null;
  source_as_of?: string | null;
}): RecommendationPackage {
  const actions: RecommendationAction[] = [];

  const weakest = [...(input.weak_concepts ?? [])]
    .filter((c) => c && c.concept)
    .sort((a, b) => (a.mastery_score ?? 0) - (b.mastery_score ?? 0))[0];

  if (weakest) {
    actions.push({
      action_id: `next_concept:${weakest.subject}:${weakest.concept}`,
      kind: "next_concept",
      title: `Practise ${weakest.concept}`,
      subject: weakest.subject,
      concept_or_topic: weakest.concept,
      priority: 100 - Math.min(100, Math.max(0, weakest.mastery_score)),
      reason_codes: ["eie_weak_concept", weakest.band ? `band_${weakest.band}` : "band_unknown"],
      metrics: {
        mastery_score: weakest.mastery_score,
        mistake_count: weakest.mistake_count ?? 0,
      },
    });
  }

  const topRev = [...(input.revision_priority ?? [])]
    .filter((r) => r && (r.topic || r.subject))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];

  if (topRev) {
    const topic = topRev.topic ?? topRev.subject;
    actions.push({
      action_id: `revision:${topRev.subject}:${topic}`,
      kind: "revision_priority",
      title: `Revise ${topic}`,
      subject: topRev.subject,
      concept_or_topic: topic,
      priority: topRev.priority ?? 0,
      reason_codes: ["eie_revision_queue", topRev.reason ?? "scheduled_revision"],
      metrics: {
        revision_priority: topRev.priority ?? 0,
        due_date: topRev.due_date ?? null,
      },
    });
  }

  const att = input.attendance_pct;
  if (typeof att === "number" && Number.isFinite(att) && att < 85) {
    actions.push({
      action_id: "attendance_checkin",
      kind: "attendance_checkin",
      title: "Check recent attendance",
      subject: null,
      concept_or_topic: null,
      priority: Math.round(85 - att),
      reason_codes: ["ae_attendance_below_threshold"],
      metrics: { attendance_pct: att },
    });
  }

  const hw = input.homework_completion_pct;
  if (typeof hw === "number" && Number.isFinite(hw) && hw < 70) {
    actions.push({
      action_id: "homework_catchup",
      kind: "homework_catchup",
      title: "Catch up on homework",
      subject: null,
      concept_or_topic: null,
      priority: Math.round(70 - hw),
      reason_codes: ["ae_homework_consistency_low"],
      metrics: { homework_completion_pct: hw },
    });
  }

  actions.sort((a, b) => b.priority - a.priority);
  const data_version = `rec:${input.intelligence_version}:${actions.length}`;

  return {
    projection: "RecommendationPackage",
    version: 1,
    studentId: input.studentId,
    schoolId: input.schoolId,
    intelligence_version: input.intelligence_version,
    completeness: input.completeness,
    actions: actions.slice(0, 6),
    source_as_of: input.source_as_of ?? null,
    data_version,
  };
}
