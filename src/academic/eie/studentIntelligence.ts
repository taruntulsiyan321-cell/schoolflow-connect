/**
 * StudentEducationalIntelligence — EIE v1 projection from concept_mastery + revision_queue.
 * Formulas reuse thresholds from conceptMasteryEngine (weak < 60, strong >= 75).
 */

import {
  bandFromScore,
  EIE_ALGORITHM_ID,
  isWeakBand,
  type MasteryBand,
} from "./masteryBands";
import {
  computeAttendanceRisk,
  computeHomeworkConsistency,
  type AttendanceRiskProduct,
  type HomeworkConsistencyProduct,
} from "./riskProducts";

export interface ConceptMasteryRow {
  subject: string;
  chapter?: string | null;
  concept: string;
  mastery_score: number;
  mistake_count?: number;
  updated_at?: string | null;
  last_attempt_at?: string | null;
}

export interface RevisionQueueRow {
  subject: string;
  chapter?: string | null;
  topic?: string | null;
  reason?: string | null;
  priority: number;
  due_date?: string | null;
  completed?: boolean;
}

export interface MasteryConceptView {
  subject: string;
  chapter: string | null;
  concept: string;
  mastery_score: number;
  band: MasteryBand;
  mistake_count: number;
}

export interface RevisionPriorityItem {
  subject: string;
  chapter: string | null;
  topic: string | null;
  reason: string | null;
  priority: number;
  due_date: string | null;
}

export interface StudentEducationalIntelligence {
  studentId: string;
  schoolId: string;
  algorithm_id: string;
  computed_at: string;
  source_data_version: string;
  completeness: number;
  avg_mastery: number;
  total_tracked: number;
  weak_concepts: MasteryConceptView[];
  // strong_concepts removed (§10.8). It was assembled here and consumed by the
  // AI context builders, so silencing any single consumer would have left the
  // value computed and one refactor from being rendered again.
  by_band: Record<MasteryBand, number>;
  revision_priority: RevisionPriorityItem[];
  /** From AE academic profile when available — never LLM-invented. */
  attendance_risk: AttendanceRiskProduct;
  homework_consistency: HomeworkConsistencyProduct;
}

export function computeDataVersion(rows: ConceptMasteryRow[], revision: RevisionQueueRow[]): string {
  let latest = 0;
  for (const r of rows) {
    const t = Date.parse(r.updated_at ?? r.last_attempt_at ?? "") || 0;
    if (t > latest) latest = t;
  }
  for (const r of revision) {
    const t = Date.parse(r.due_date ?? "") || 0;
    if (t > latest) latest = t;
  }
  // Match edge eieProjection: version on open (incomplete) revision depth.
  const openCount = revision.filter((r) => !r.completed).length;
  return `eie:${rows.length}:${openCount}:${latest || 0}`;
}

export function buildStudentEducationalIntelligence(input: {
  studentId: string;
  schoolId: string;
  mastery: ConceptMasteryRow[];
  revisionQueue: RevisionQueueRow[];
  computedAt?: string;
  /** Academic Engine profile facts (optional). */
  attendance_pct?: number | null;
  homework_completion_pct?: number | null;
}): StudentEducationalIntelligence {
  const computed_at = input.computedAt ?? new Date().toISOString();
  const concepts: MasteryConceptView[] = input.mastery.map((m) => ({
    subject: m.subject,
    chapter: m.chapter ?? null,
    concept: m.concept,
    mastery_score: Number(m.mastery_score) || 0,
    band: bandFromScore(Number(m.mastery_score) || 0),
    mistake_count: m.mistake_count ?? 0,
  }));

  const by_band: Record<MasteryBand, number> = {
    critical: 0,
    weak: 0,
    developing: 0,
    high: 0,
    very_high: 0,
  };
  for (const c of concepts) by_band[c.band] += 1;

  const weak_concepts = concepts
    .filter((c) => isWeakBand(c.band))
    .sort((a, b) => a.mastery_score - b.mastery_score)
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

  // Completeness: 0 if no mastery tracked; rises with coverage + revision signal.
  let completeness = 0;
  if (concepts.length > 0) completeness += 0.7;
  if (concepts.length >= 5) completeness += 0.15;
  if (openRevision.length > 0 || concepts.length >= 10) completeness += 0.15;
  completeness = Math.min(1, Math.round(completeness * 100) / 100);

  const attendance_risk = computeAttendanceRisk(input.attendance_pct);
  const homework_consistency = computeHomeworkConsistency(input.homework_completion_pct);

  return {
    studentId: input.studentId,
    schoolId: input.schoolId,
    algorithm_id: EIE_ALGORITHM_ID,
    computed_at,
    source_data_version: computeDataVersion(input.mastery, input.revisionQueue),
    completeness,
    avg_mastery,
    total_tracked: concepts.length,
    weak_concepts,
    by_band,
    revision_priority,
    attendance_risk,
    homework_consistency,
  };
}
