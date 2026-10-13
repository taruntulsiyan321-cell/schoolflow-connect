/**
 * Parent scheduled narrative pilot — deterministic template from AE/EIE facts.
 * No LLM required; optional explain path may phrase later via Router.
 */

type ParentNarrativeInput = {
  student_label?: string;
  // null: not known (fetchParentSummary's pctOrNull) — said as "not available yet".
  attendance_pct: number | null;
  homework_completion_pct: number | null;
  tests_avg_pct: number | null;
  exams_avg_pct: number | null;
  // Chunk 7B batch 2d: weak_topics and strong_topics are GONE from the parent
  // narrative, not made optional.
  //
  // This file renders what a parent reads. It was emitting
  //   "Stronger areas: <topics>."   and   "Focus areas: <topics>."
  // and putting "Priority practice: <topic>" into the narrative sentence —
  // concept names derived from the child's practice mastery. §10.8 makes
  // practice student-only, and "strong areas are never surfaced anywhere in
  // the app" rules out the first one for every audience including the student.
  //
  // avg_mastery and revision_topics stay in the type: both are supplied from
  // fetchEie, whose concept_mastery and revision_queue reads are already
  // inside an actorRole === "student" gate, so a parent receives neither.
  avg_mastery?: number | null;
  revision_topics?: string[];
  source_as_of: string | null;
  data_version: string;
};

type ParentNarrative = {
  projection: "ParentScheduledNarrative";
  version: 1;
  narrative: string;
  bullets: string[];
  source_as_of: string | null;
  data_version: string;
  used_model: false;
  completeness: number;
};

/** A percentage there is something to say about: known, finite and above zero. */
function known(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function pct(n: number | null | undefined): string {
  return known(n) ? `${Math.round(n * 10) / 10}%` : "not available yet";
}

/**
 * Build a short parent progress narrative from verified facts only.
 */
export function buildParentScheduledNarrative(input: ParentNarrativeInput): ParentNarrative {
  const label = input.student_label?.trim() || "Your child";
  const bullets: string[] = [];

  bullets.push(`Attendance: ${pct(input.attendance_pct)}.`);
  bullets.push(`Homework completion: ${pct(input.homework_completion_pct)}.`);
  if (known(input.tests_avg_pct)) bullets.push(`Tests average: ${pct(input.tests_avg_pct)}.`);
  if (known(input.exams_avg_pct)) bullets.push(`Exams average: ${pct(input.exams_avg_pct)}.`);

  if (known(input.avg_mastery)) {
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
    asOf;

  let completeness = 0.2;
  if (known(input.attendance_pct)) completeness += 0.25;
  if (known(input.homework_completion_pct)) completeness += 0.2;
  if (known(input.tests_avg_pct) || known(input.exams_avg_pct)) completeness += 0.15;
  // The 0.2 that practice topics used to contribute is not redistributed: the
  // narrative genuinely carries less than it did, and completeness should say
  // so rather than round itself back up to look unchanged (G4).
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
