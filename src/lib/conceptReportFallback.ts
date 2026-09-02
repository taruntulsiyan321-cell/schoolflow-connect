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
    concept: string;
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

export function buildRuleConceptReport(report: ConceptRecoveryReport): ConceptAiReport {
  const weak = report.weak_concepts ?? [];
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

  if (weak.length > 0) {
    bullets.push(
      `Weak concepts: ${weak.slice(0, 4).map((w) => `${w.concept} (${w.accuracy}%)`).join(", ")}.`,
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
  if (weak.length > 0) {
    next_steps.push(`Re-read NCERT section for ${weak[0].concept} (${weak[0].subject}).`);
    next_steps.push(`Complete recovery questions for ${weak[0].concept} before your next test.`);
    if (weak.length > 1) {
      next_steps.push(`Schedule revision for ${weak[1].concept} within 48 hours.`);
    }
  } else {
    next_steps.push("Attempt a timed mixed Test to maintain momentum.");
    next_steps.push("Teach one solved problem to a classmate — teaching locks in mastery.");
  }
  next_steps.push("Review your Mistake Book for any recurring error patterns.");

  return { headline, bullets, next_steps, source: "rule" };
}
