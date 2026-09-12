export type ConceptRecoveryReport = {
  source_type: string;
  source_id: string;
  accuracy_pct: number;
  correct_count: number;
  total_count: number;
  time_minutes: number;
  weak_concepts: {
    subject: string;
    chapter?: string;
    /**
     * NULLABLE, and the type used to say otherwise.
     *
     * A question that was never tagged with a concept produces a weak-concept
     * row with no name. The declared `string` made that impossible on paper, so
     * every consumer interpolated it directly — and the test report shipped
     * "Re-read NCERT section for null (Mathematics)" to a student, three
     * sentences of it, under the heading "Next steps".
     */
    concept: string | null;
    subconcept?: string;
    accuracy: number;
    attempts?: number;
    correct?: number;
  }[];
  recovery_assignments: { assignment_id: string; concept: string; severity?: string }[];
  improvement_areas: string[];
  insights?: {
    headline: string;
    bullets: string[];
    next_steps: string[];
    source: "ai" | "rule";
  };
};

export type ConceptAiReport = {
  headline: string;
  bullets: string[];
  next_steps: string[];
  source: "ai" | "rule";
};

/** A weak concept is only nameable if something actually named it. */
function conceptName(w: { concept: string | null }): string | null {
  const name = (w.concept ?? "").trim();
  return name && name.toLowerCase() !== "null" ? name : null;
}

export function buildRuleConceptReport(report: ConceptRecoveryReport): ConceptAiReport {
  const weak = report.weak_concepts ?? [];
  /**
   * Only the rows that can be NAMED drive the name-bearing copy.
   *
   * `weak` counts every weak row, including the ones whose question carried no
   * concept tag. Advice that names a concept is useless without one — and what
   * shipped instead was the string "null" in the student's next steps. A row
   * with no name still counts towards "you have weak areas"; it just cannot be
   * the subject of a sentence about which area to re-read.
   */
  const named = weak.filter((w) => conceptName(w) !== null);
  const headline =
    report.accuracy_pct >= 80
      ? "Strong session — keep consolidating"
      : report.accuracy_pct >= 60
        ? "Good effort — a few concepts need targeted practice"
        : "Focus recovery needed on weak concepts";

  const bullets: string[] = [
    `Overall accuracy: ${report.accuracy_pct}% (${report.correct_count}/${report.total_count} correct).`,
  ];

  if (report.time_minutes > 0) {
    bullets.push(`Time spent: ~${report.time_minutes} minutes.`);
  }

  if (named.length > 0) {
    bullets.push(
      `Weak concepts: ${named.slice(0, 4).map((w) => `${conceptName(w)} (${w.accuracy}%)`).join(", ")}.`,
    );
  } else if (weak.length > 0) {
    // Weak areas exist but none of the questions carried a concept tag. Say
    // that plainly rather than naming nothing, or naming "null".
    const subjects = [...new Set(weak.map((w) => w.subject).filter(Boolean))];
    bullets.push(
      subjects.length > 0
        ? `Weak areas in ${subjects.slice(0, 3).join(", ")} — these questions are not tagged to a concept yet, so there is no topic to name.`
        : "Weak areas found, but these questions are not tagged to a concept yet.",
    );
  } else {
    bullets.push("No concept-level weaknesses detected in this session.");
  }

  if ((report.recovery_assignments ?? []).length > 0) {
    bullets.push(
      `${report.recovery_assignments.length} recovery assignment(s) queued — open Recovery Zone to fix mistakes.`,
    );
  }

  const next_steps: string[] = [];
  if (named.length > 0) {
    next_steps.push(`Re-read NCERT section for ${conceptName(named[0])} (${named[0].subject}).`);
    next_steps.push(`Complete recovery questions for ${conceptName(named[0])} before your next test.`);
    if (named.length > 1) {
      next_steps.push(`Schedule revision for ${conceptName(named[1])} within 48 hours.`);
    }
  } else if (weak.length > 0) {
    // Advice that can still be acted on without a concept name.
    next_steps.push("Open your Mistake Book and re-attempt the questions you got wrong in this test.");
    next_steps.push("Ask Nova to explain any question here you are still unsure about.");
  } else {
    next_steps.push("Attempt a timed mixed Test to maintain momentum.");
    next_steps.push("Teach one solved problem to a classmate — teaching locks in mastery.");
  }
  // The closing step is a catch-all, so it only earns its place when nothing
  // above already sent the student to the Mistake Book. Three numbered steps
  // where two name the same destination reads as padding.
  if (!next_steps.some((s) => s.includes("Mistake Book"))) {
    next_steps.push("Review your Mistake Book for any recurring error patterns.");
  }

  return { headline, bullets, next_steps, source: "rule" };
}
