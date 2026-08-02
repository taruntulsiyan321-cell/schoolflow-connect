import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";

export const PRACTICE_ACCURACY_LABEL = "Practice accuracy";
export const CONCEPT_MASTERY_LABEL = "Concept mastery";
export const STUDY_CONSISTENCY_LABEL = "Study consistency";

/**
 * Product overall accuracy SSOT for Home / Practice / Analysis / Nova / Battleground chrome.
 * Source: `rpc_student_academic_snapshot` → `exam_readiness.accuracy_pct` only.
 * Never average charts subjects, mastery attempt ratios, or battle Q&A counters here.
 * XP / level / study streak remain ProgressionService (`rpc_get_student_progression`).
 */
export function practiceAccuracyFromSnapshot(snap: AcademicSnapshot | null | undefined): number {
  const raw = snap?.exam_readiness?.accuracy_pct;
  if (raw == null || Number.isNaN(Number(raw))) return 0;
  return Math.round(Number(raw));
}

/** Alias — same SSOT as practiceAccuracyFromSnapshot. */
export const overallAccuracyFromSnapshot = practiceAccuracyFromSnapshot;

/** Active study days in the last 14 days. */
export function studyActiveDaysFromSnapshot(snap: AcademicSnapshot | null | undefined): number {
  return snap?.exam_readiness?.active_days_14d ?? 0;
}

/** Average concept mastery across tracked skills. */
export function averageConceptMastery(mastery: ConceptMasteryItem[]): number {
  if (mastery.length === 0) return 0;
  const sum = mastery.reduce((s, m) => s + m.mastery_score, 0);
  return Math.round(sum / mastery.length);
}

/** Hero ring score: mastery when tracked, otherwise practice accuracy. */
export function heroLearningScore(
  snap: AcademicSnapshot | null | undefined,
  mastery: ConceptMasteryItem[],
): { score: number; label: string } {
  const avgMastery = averageConceptMastery(mastery);
  if (mastery.length > 0) {
    return { score: avgMastery, label: CONCEPT_MASTERY_LABEL };
  }
  return { score: practiceAccuracyFromSnapshot(snap), label: PRACTICE_ACCURACY_LABEL };
}

/** Parent / report one-liner without exam-readiness jargon. */
export function formatLearningProgressSummary(snap: AcademicSnapshot | null | undefined): string {
  const acc = practiceAccuracyFromSnapshot(snap);
  const days = studyActiveDaysFromSnapshot(snap);
  const mistakes = snap?.mistake_count ?? 0;
  const recovery = snap?.recovery_pending ?? 0;
  const parts = [
    `${PRACTICE_ACCURACY_LABEL}: ${acc}%`,
    `${days} active day${days === 1 ? "" : "s"} (14d)`,
    `${mistakes} open mistake${mistakes === 1 ? "" : "s"}`,
  ];
  if (recovery > 0) parts.push(`${recovery} recovery task${recovery === 1 ? "" : "s"} pending`);
  return parts.join(" · ");
}
