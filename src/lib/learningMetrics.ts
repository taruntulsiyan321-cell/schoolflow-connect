import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";

/**
 * Practice-only accuracy SSOT, for anything labelled PRACTICE_ACCURACY_LABEL —
 * or null when the snapshot carries none (ruling 8: absent data is a dash,
 * never a zero).
 *
 * Source: `rpc_student_academic_snapshot` → `exam_readiness.practice_accuracy_pct`,
 * which `_exam_readiness()` computes straight from `question_attempts`.
 *
 * Deliberately NOT `accuracy_pct`: that field is a *blend* of Test accuracy and
 * practice accuracy (`_acc := (test_acc + practice_acc) / 2`), so reading it here
 * reported a number the student never scored in practice — e.g. 100% Test + 66.7%
 * practice surfaced as an "83% practice accuracy" tile. No screen shows the
 * blend.
 *
 * undefined and null mean DIFFERENT things for `practice_accuracy_pct`:
 *
 *   key ABSENT   a snapshot predating practice_accuracy_pct — fall back to the
 *                blended accuracy_pct, which is why that fallback exists
 *   key NULL     a current snapshot saying there is no practice accuracy,
 *                because there were no attempts. Falling back here would
 *                relabel the blend as a practice figure.
 *
 * This used to be two functions — a number reader that fell back on null too
 * (`?? accuracy_pct`) and a separate "is there one?" check that did not — so
 * the fact had two homes that disagreed, and only the guard at the one call
 * site kept the wrong one from showing.
 *
 * Never average charts subjects, mastery attempt ratios, or battle Q&A counters here.
 * XP / level / study streak remain ProgressionService (`rpc_get_student_progression`).
 */
export function practiceAccuracyFromSnapshot(snap: AcademicSnapshot | null | undefined): number | null {
  const readiness = snap?.exam_readiness;
  if (!readiness) return null;
  const raw = "practice_accuracy_pct" in readiness ? readiness.practice_accuracy_pct : readiness.accuracy_pct;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  return Math.round(Number(raw));
}
