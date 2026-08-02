/**
 * Edge EIE projection — mirrors src/academic/eie (no LLM calculation).
 */

export const EIE_ALGORITHM_ID = "eie.mastery.v1";

export type MasteryBand = "critical" | "weak" | "developing" | "strong" | "mastered";

export type RiskBand = "low" | "moderate" | "elevated" | "high" | "unknown";

export function bandFromScore(score: number): MasteryBand {
  const s = Number.isFinite(score) ? score : 0;
  if (s < 40) return "critical";
  if (s < 60) return "weak";
  if (s < 75) return "developing";
  if (s < 90) return "strong";
  return "mastered";
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bandFromRiskScore(score: number): RiskBand {
  if (score >= 75) return "high";
  if (score >= 55) return "elevated";
  if (score >= 35) return "moderate";
  return "low";
}

function bandFromConsistency(score: number): RiskBand {
  if (score >= 85) return "low";
  if (score >= 70) return "moderate";
  if (score >= 50) return "elevated";
  return "high";
}

export function computeAttendanceRisk(attendance_pct: number | null | undefined) {
  if (attendance_pct == null || !Number.isFinite(attendance_pct)) {
    return {
      product: "attendance_risk" as const,
      attendance_pct: null,
      risk_score: 0,
      band: "unknown" as RiskBand,
      reason_codes: ["attendance_data_missing"],
    };
  }
  const pct = Math.max(0, Math.min(100, Number(attendance_pct)));
  const risk_score = clampScore((95 - pct) * (100 / 45));
  const reason_codes: string[] = [];
  if (pct < 75) reason_codes.push("attendance_critical_threshold");
  else if (pct < 85) reason_codes.push("attendance_watch_threshold");
  else if (pct < 95) reason_codes.push("attendance_soft_gap");
  else reason_codes.push("attendance_healthy");
  return {
    product: "attendance_risk" as const,
    attendance_pct: pct,
    risk_score,
    band: bandFromRiskScore(risk_score),
    reason_codes,
  };
}

export function computeHomeworkConsistency(
  homework_completion_pct: number | null | undefined,
) {
  if (homework_completion_pct == null || !Number.isFinite(homework_completion_pct)) {
    return {
      product: "homework_consistency" as const,
      homework_completion_pct: null,
      consistency_score: 0,
      band: "unknown" as RiskBand,
      reason_codes: ["homework_data_missing"],
    };
  }
  const pct = Math.max(0, Math.min(100, Number(homework_completion_pct)));
  const consistency_score = clampScore(pct);
  const reason_codes: string[] = [];
  if (pct < 50) reason_codes.push("homework_critical");
  else if (pct < 70) reason_codes.push("homework_inconsistent");
  else if (pct < 85) reason_codes.push("homework_developing");
  else reason_codes.push("homework_consistent");
  return {
    product: "homework_consistency" as const,
    homework_completion_pct: pct,
    consistency_score,
    band: bandFromConsistency(consistency_score),
    reason_codes,
  };
}

export function buildEieProjection(input: {
  studentId: string;
  schoolId: string;
  mastery: {
    subject: string;
    chapter?: string | null;
    concept: string;
    mastery_score: number;
    mistake_count?: number;
    updated_at?: string | null;
  }[];
  revisionQueue: {
    subject: string;
    chapter?: string | null;
    topic?: string | null;
    reason?: string | null;
    priority: number;
    due_date?: string | null;
    completed?: boolean;
  }[];
  attendance_pct?: number | null;
  homework_completion_pct?: number | null;
}) {
  const concepts = input.mastery.map((m) => {
    const mastery_score = Number(m.mastery_score) || 0;
    const band = bandFromScore(mastery_score);
    return {
      subject: m.subject,
      chapter: m.chapter ?? null,
      concept: m.concept,
      mastery_score,
      band,
      mistake_count: m.mistake_count ?? 0,
    };
  });

  const by_band: Record<MasteryBand, number> = {
    critical: 0,
    weak: 0,
    developing: 0,
    strong: 0,
    mastered: 0,
  };
  for (const c of concepts) by_band[c.band] += 1;

  const weak_concepts = concepts
    .filter((c) => c.band === "critical" || c.band === "weak")
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 12);
  const strong_concepts = concepts
    .filter((c) => c.band === "strong" || c.band === "mastered")
    .sort((a, b) => b.mastery_score - a.mastery_score)
    .slice(0, 12);

  const avg_mastery = concepts.length
    ? Math.round(concepts.reduce((s, c) => s + c.mastery_score, 0) / concepts.length)
    : 0;

  const openRevision = input.revisionQueue.filter((r) => !r.completed);
  const revision_priority = openRevision
    .slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 15)
    .map((r) => ({
      subject: r.subject,
      chapter: r.chapter ?? null,
      topic: r.topic ?? null,
      reason: r.reason ?? null,
      priority: r.priority ?? 0,
      due_date: r.due_date ?? null,
    }));

  let completeness = 0;
  if (concepts.length > 0) completeness += 0.7;
  if (concepts.length >= 5) completeness += 0.15;
  if (openRevision.length > 0 || concepts.length >= 10) completeness += 0.15;
  completeness = Math.min(1, Math.round(completeness * 100) / 100);

  let latest = 0;
  for (const r of input.mastery) {
    const t = Date.parse(r.updated_at ?? "") || 0;
    if (t > latest) latest = t;
  }

  return {
    studentId: input.studentId,
    schoolId: input.schoolId,
    algorithm_id: EIE_ALGORITHM_ID,
    computed_at: new Date().toISOString(),
    source_data_version: `eie:${concepts.length}:${openRevision.length}:${latest || 0}`,
    data_version: `eie:${concepts.length}:${openRevision.length}:${latest || 0}`,
    completeness,
    avg_mastery,
    total_tracked: concepts.length,
    weak_concepts,
    strong_concepts,
    by_band,
    revision_priority,
    attendance_risk: computeAttendanceRisk(input.attendance_pct),
    homework_consistency: computeHomeworkConsistency(input.homework_completion_pct),
  };
}
