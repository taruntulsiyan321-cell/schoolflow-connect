/**
 * Principal school health brief — deterministic from AE/EIE aggregates.
 * Never invents school-wide stats; honest empty when aggregates missing.
 */

export type SchoolHealthAggregateInput = {
  school_id: string;
  class_count?: number | null;
  student_count?: number | null;
  teacher_count?: number | null;
  avg_attendance_pct?: number | null;
  avg_homework_completion_pct?: number | null;
  avg_tests_pct?: number | null;
  avg_exams_pct?: number | null;
  avg_mastery?: number | null;
  attendance_risk_band?: string | null;
  weak_concept_count?: number | null;
  revision_queue_depth?: number | null;
  source_as_of?: string | null;
  data_version?: string | null;
  eie_algorithm_id?: string | null;
};

export type SchoolHealthBrief = {
  capability_id: "principal.school.health_brief";
  projection: "PrincipalSchoolHealthBrief";
  version: 1;
  school_id: string;
  status: "ready" | "empty";
  headline: string;
  bullets: string[];
  metrics: {
    class_count: number | null;
    student_count: number | null;
    teacher_count: number | null;
    avg_attendance_pct: number | null;
    avg_homework_completion_pct: number | null;
    avg_tests_pct: number | null;
    avg_exams_pct: number | null;
    avg_mastery: number | null;
    attendance_risk_band: string | null;
    weak_concept_count: number | null;
    revision_queue_depth: number | null;
  };
  used_model: false;
  completeness: number;
  source_as_of: string | null;
  data_version: string;
  eie_algorithm_id: string | null;
  notes: string[];
};

function finiteOrNull(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

function pctLabel(n: number | null): string {
  if (n == null || n <= 0) return "not available";
  return `${Math.round(n * 10) / 10}%`;
}

/**
 * Build a principal health brief from verified aggregates only.
 */
export function buildSchoolHealthBrief(input: SchoolHealthAggregateInput): SchoolHealthBrief {
  const metrics = {
    class_count: finiteOrNull(input.class_count),
    student_count: finiteOrNull(input.student_count),
    teacher_count: finiteOrNull(input.teacher_count),
    avg_attendance_pct: finiteOrNull(input.avg_attendance_pct),
    avg_homework_completion_pct: finiteOrNull(input.avg_homework_completion_pct),
    avg_tests_pct: finiteOrNull(input.avg_tests_pct),
    avg_exams_pct: finiteOrNull(input.avg_exams_pct),
    avg_mastery: finiteOrNull(input.avg_mastery),
    attendance_risk_band: input.attendance_risk_band?.trim() || null,
    weak_concept_count: finiteOrNull(input.weak_concept_count),
    revision_queue_depth: finiteOrNull(input.revision_queue_depth),
  };

  const hasHeadcount =
    (metrics.student_count != null && metrics.student_count > 0) ||
    (metrics.class_count != null && metrics.class_count > 0);
  const hasAcademic =
    (metrics.avg_attendance_pct != null && metrics.avg_attendance_pct > 0) ||
    (metrics.avg_homework_completion_pct != null && metrics.avg_homework_completion_pct > 0) ||
    (metrics.avg_tests_pct != null && metrics.avg_tests_pct > 0) ||
    (metrics.avg_exams_pct != null && metrics.avg_exams_pct > 0) ||
    (metrics.avg_mastery != null && metrics.avg_mastery > 0);

  const bullets: string[] = [];
  const notes: string[] = [];

  if (hasHeadcount) {
    bullets.push(
      `School size: ${metrics.student_count ?? "—"} students across ${metrics.class_count ?? "—"} classes` +
        (metrics.teacher_count != null ? `, ${metrics.teacher_count} teachers.` : "."),
    );
  }
  if (metrics.avg_attendance_pct != null && metrics.avg_attendance_pct > 0) {
    bullets.push(`Average attendance: ${pctLabel(metrics.avg_attendance_pct)}.`);
  }
  if (metrics.avg_homework_completion_pct != null && metrics.avg_homework_completion_pct > 0) {
    bullets.push(`Homework completion: ${pctLabel(metrics.avg_homework_completion_pct)}.`);
  }
  if (metrics.avg_tests_pct != null && metrics.avg_tests_pct > 0) {
    bullets.push(`Tests average: ${pctLabel(metrics.avg_tests_pct)}.`);
  }
  if (metrics.avg_exams_pct != null && metrics.avg_exams_pct > 0) {
    bullets.push(`Exams average: ${pctLabel(metrics.avg_exams_pct)}.`);
  }
  if (metrics.avg_mastery != null && metrics.avg_mastery > 0) {
    bullets.push(`Tracked concept mastery average: ${pctLabel(metrics.avg_mastery)}.`);
  }
  if (metrics.attendance_risk_band) {
    bullets.push(`Attendance risk band (EIE): ${metrics.attendance_risk_band}.`);
  }
  if (metrics.weak_concept_count != null && metrics.weak_concept_count > 0) {
    bullets.push(`Weak concepts tracked: ${metrics.weak_concept_count}.`);
  }
  if (metrics.revision_queue_depth != null && metrics.revision_queue_depth > 0) {
    bullets.push(`Open revision queue depth: ${metrics.revision_queue_depth}.`);
  }

  let completeness = 0;
  if (hasHeadcount) completeness += 0.25;
  if (metrics.avg_attendance_pct != null && metrics.avg_attendance_pct > 0) completeness += 0.2;
  if (metrics.avg_homework_completion_pct != null && metrics.avg_homework_completion_pct > 0) {
    completeness += 0.15;
  }
  if (
    (metrics.avg_tests_pct != null && metrics.avg_tests_pct > 0) ||
    (metrics.avg_exams_pct != null && metrics.avg_exams_pct > 0)
  ) {
    completeness += 0.15;
  }
  if (metrics.avg_mastery != null && metrics.avg_mastery > 0) completeness += 0.15;
  if (metrics.weak_concept_count != null || metrics.revision_queue_depth != null) {
    completeness += 0.1;
  }
  completeness = Math.min(1, Math.round(completeness * 100) / 100);

  const status: "ready" | "empty" = hasHeadcount || hasAcademic ? "ready" : "empty";
  if (status === "empty") {
    notes.push("No AE/EIE school aggregates available yet — honest empty brief.");
  } else {
    notes.push("Deterministic brief from Academic Engine / EIE aggregates only (no LLM).");
  }

  const asOf = input.source_as_of
    ? ` As of ${input.source_as_of}.`
    : " Based on available school records.";

  const headline =
    status === "empty"
      ? "School academic health data is not available yet."
      : `School academic health snapshot: attendance ${pctLabel(metrics.avg_attendance_pct)}, homework ${pctLabel(metrics.avg_homework_completion_pct)}.${asOf}`;

  return {
    capability_id: "principal.school.health_brief",
    projection: "PrincipalSchoolHealthBrief",
    version: 1,
    school_id: input.school_id,
    status,
    headline,
    bullets,
    metrics,
    used_model: false,
    completeness,
    source_as_of: input.source_as_of ?? null,
    data_version: input.data_version?.trim() || "school_health:empty",
    eie_algorithm_id: input.eie_algorithm_id ?? null,
    notes,
  };
}
