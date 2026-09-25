import { displayChapter, displayConcept } from "@/lib/academicDisplay";

export type ConceptRecoveryReport = {
  source_type: string;
  source_id: string;
  /**
   * NULL when nothing was answered, and the type used to say otherwise.
   *
   * A session that was skipped end to end has no accuracy; 0% is a verdict
   * the answers do not carry. Measured 2026-09-19 on the practice result
   * screen: of the student's 40 latest sessions, this card disagreed with the
   * summary tiles above it on 24 — "—" against "0%", and 100% against 50% —
   * because it counted a skip as a wrong answer.
   */
  accuracy_pct: number | null;
  correct_count: number;
  total_count: number;
  /** NULL when no question carried a timing — never a floor of one minute. */
  time_minutes: number | null;
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

type WeakConcept = ConceptRecoveryReport["weak_concepts"][number];

/**
 * What each weak concept is CALLED — the one home of it, for the report's
 * chips and for its sentences alike.
 *
 * Null when nothing named it: a question never tagged with a concept, whose
 * name used to reach the student as "null". A name two rows share carries its
 * chapter, because the rows are different — the report groups by chapter AND
 * concept — and a list reading "Marketing · 0%, Marketing · 0%" (measured
 * 2026-09-25, a Business Studies session: one question from Directing, one
 * from Consumer Protection, both tagged Marketing) looks like one concept
 * counted twice.
 */
export function weakConceptLabels(weak: WeakConcept[]): (string | null)[] {
  const names = weak.map((w) => {
    const raw = (w.concept ?? "").trim();
    return raw && raw.toLowerCase() !== "null" ? displayConcept(raw) || null : null;
  });
  const uses = new Map<string, number>();
  for (const n of names) if (n) uses.set(n, (uses.get(n) ?? 0) + 1);
  return names.map((n, i) => {
    if (!n || (uses.get(n) ?? 0) < 2) return n;
    const chapter = displayChapter(weak[i].chapter);
    return chapter && chapter !== n ? `${n} (${chapter})` : n;
  });
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
  const labels = weakConceptLabels(weak);
  const named = weak.flatMap((w, i) => (labels[i] ? [{ ...w, name: labels[i] as string }] : []));
  const accuracy = report.accuracy_pct;
  const headline =
    accuracy == null
      ? "Nothing was answered — there is no accuracy to report"
      : accuracy >= 80
        ? "Strong session — keep consolidating"
        : accuracy >= 60
          ? "Good effort — a few concepts need targeted practice"
          : "Focus recovery needed on weak concepts";

  // No restatement of the score or the time. Every page that shows this report
  // shows both itself, from its own record, and a second copy here disagreed
  // with the first: "Overall accuracy: 38.5%" beside a tile reading 38%, or 0%
  // beside "—". The accuracy still chooses the headline above; it is not
  // printed again.
  const bullets: string[] = accuracy == null ? ["No question was answered."] : [];

  if (named.length > 0) {
    bullets.push(
      `Weak concepts: ${named.slice(0, 4).map((w) => `${w.name} (${w.accuracy}%)`).join(", ")}.`,
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

  const next_steps: string[] = [];
  if (named.length > 0) {
    next_steps.push(`Re-read NCERT section for ${named[0].name} (${named[0].subject}).`);
    next_steps.push(`Complete recovery questions for ${named[0].name} before your next test.`);
    if (named.length > 1) {
      next_steps.push(`Schedule revision for ${named[1].name} within 48 hours.`);
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
