/**
 * Parent scheduled narrative pilot — deterministic template from AE/EIE facts.
 * No LLM required; optional explain path may phrase later via Router.
 */

export type ParentNarrativeInput = {
  student_label?: string;
  attendance_pct: number;
  homework_completion_pct: number;
  tests_avg_pct: number;
  exams_avg_pct: number;
  weak_topics: string[];
  strong_topics: string[];
  avg_mastery?: number | null;
  revision_topics?: string[];
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
  const label = input.student_label?.trim() || "Your child";
  const bullets: string[] = [];

  bullets.push(`Attendance: ${pct(input.attendance_pct)}.`);
  bullets.push(`Homework completion: ${pct(input.homework_completion_pct)}.`);
  if (input.tests_avg_pct > 0) bullets.push(`Tests average: ${pct(input.tests_avg_pct)}.`);
  if (input.exams_avg_pct > 0) bullets.push(`Exams average: ${pct(input.exams_avg_pct)}.`);

  // CHUNK 10.5 — §10.8: "Strong areas are never shown anywhere in the app."
  //
  // This pushed `Stronger areas: <topic>, <topic>, <topic>.` into the narrative a
  // PARENT reads. A generated sentence is a render — the rule is about what a
  // user may see, not about which layer assembled it, and a sentence built from
  // strong_topics is the same disclosure as a list of cards headed "Strong
  // topics".
  //
  // strong_topics stays on the input type for now: it is fed by the AI context
  // builders, which 10.5 closes separately. Removing the field here without
  // closing the source would leave the data flowing and only this consumer
  // silent — and a value computed and discarded is one refactor from being live.
  if (input.weak_topics.length) {
    bullets.push(`Focus areas: ${input.weak_topics.slice(0, 3).join(", ")}.`);
  }
  if (typeof input.avg_mastery === "number" && input.avg_mastery > 0) {
    bullets.push(`Tracked concept mastery average: ${pct(input.avg_mastery)}.`);
  }
  if (input.revision_topics?.length) {
    bullets.push(`Suggested revision: ${input.revision_topics.slice(0, 3).join(", ")}.`);
  }

  const asOf = input.source_as_of
    ? ` Based on school records as of ${input.source_as_of}.`
    : " Based on available school records.";

  const narrative =
    `${label}'s recent academic snapshot: attendance ${pct(input.attendance_pct)}, ` +
    `homework completion ${pct(input.homework_completion_pct)}.` +
    (input.weak_topics[0] ? ` Priority practice: ${input.weak_topics[0]}.` : "") +
    asOf;

  let completeness = 0.2;
  if (input.attendance_pct > 0) completeness += 0.25;
  if (input.homework_completion_pct > 0) completeness += 0.2;
  if (input.tests_avg_pct > 0 || input.exams_avg_pct > 0) completeness += 0.15;
  if (input.weak_topics.length || input.strong_topics.length) completeness += 0.2;
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
