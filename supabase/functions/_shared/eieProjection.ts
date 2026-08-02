/**
 * Edge EIE projection — mirrors src/academic/eie (no LLM calculation).
 */

export const EIE_ALGORITHM_ID = "eie.mastery.v1";

export type MasteryBand = "critical" | "weak" | "developing" | "strong" | "mastered";

export function bandFromScore(score: number): MasteryBand {
  const s = Number.isFinite(score) ? score : 0;
  if (s < 40) return "critical";
  if (s < 60) return "weak";
  if (s < 75) return "developing";
  if (s < 90) return "strong";
  return "mastered";
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
  };
}
