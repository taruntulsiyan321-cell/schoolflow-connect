/**
 * Parent scheduled narrative pilot — deterministic template from AE/EIE facts.
 * No LLM required; optional explain path may phrase later via Router.
 *
 * It takes only what the school recorded — attendance, homework, tests, exams.
 * What the system inferred about the child (weak or strong topics, mastery) is
 * not the parent's to see (RULE 25, §10.8), so it is not an input at all.
 */

type ParentNarrativeInput = {
  attendance_pct: number;
  homework_completion_pct: number;
  tests_avg_pct: number;
  exams_avg_pct: number;
  source_as_of: string | null;
  data_version: string;
};

export type ParentNarrative = {
  projection: "ParentScheduledNarrative";
  version: 1;
  narrative: string;
  bullets: string[];
  source_as_of: string | null;
  data_version: string;
  used_model: false;
  completeness: number;
};

function pct(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "not available yet";
  return `${Math.round(n * 10) / 10}%`;
}

/**
 * Build a short parent progress narrative from verified facts only.
 */
export function buildParentScheduledNarrative(input: ParentNarrativeInput): ParentNarrative {
  const bullets: string[] = [];

  bullets.push(`Attendance: ${pct(input.attendance_pct)}.`);
  bullets.push(`Homework completion: ${pct(input.homework_completion_pct)}.`);
  if (input.tests_avg_pct > 0) bullets.push(`Tests average: ${pct(input.tests_avg_pct)}.`);
  if (input.exams_avg_pct > 0) bullets.push(`Exams average: ${pct(input.exams_avg_pct)}.`);

  const asOf = input.source_as_of
    ? ` Based on school records as of ${input.source_as_of}.`
    : " Based on available school records.";

  const narrative =
    `Your child's recent academic snapshot: attendance ${pct(input.attendance_pct)}, ` +
    `homework completion ${pct(input.homework_completion_pct)}.` +
    asOf;

  let completeness = 0.2;
  if (input.attendance_pct > 0) completeness += 0.25;
  if (input.homework_completion_pct > 0) completeness += 0.2;
  if (input.tests_avg_pct > 0 || input.exams_avg_pct > 0) completeness += 0.15;
  completeness = Math.min(1, Math.round(completeness * 100) / 100);

  return {
    projection: "ParentScheduledNarrative",
    version: 1,
    narrative,
    bullets,
    source_as_of: input.source_as_of,
    data_version: input.data_version,
    used_model: false,
    completeness,
  };
}
