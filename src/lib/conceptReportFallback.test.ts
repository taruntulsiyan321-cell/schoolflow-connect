import { describe, expect, it } from "vitest";
import { buildRuleConceptReport, type ConceptRecoveryReport } from "./conceptReportFallback";

/**
 * The word "null" reached a student's test report.
 *
 * Seen in the browser on /student/test/<id>/result, under the heading
 * "Next steps":
 *
 *     Weak concepts: null (0%).
 *     1. Re-read NCERT section for null (Mathematics).
 *     2. Complete recovery questions for null before your next test.
 *
 * `weak_concepts[].concept` is nullable — a question that was never tagged to a
 * concept produces a weak row with no name — and the TYPE declared it `string`,
 * so every consumer interpolated it straight into a sentence. The type said the
 * case was impossible; the database disagreed.
 */

function report(over: Partial<ConceptRecoveryReport> = {}): ConceptRecoveryReport {
  return {
    source_type: "test",
    source_id: "t1",
    accuracy_pct: 0,
    correct_count: 0,
    total_count: 1,
    time_minutes: 0,
    weak_concepts: [],
    improvement_areas: [],
    ...over,
  };
}

describe("the rule-based concept report never shows a student a placeholder", () => {
  it("POSITIVE CONTROL: it does name a concept when there is one", () => {
    // Without this, every assertion below would also pass on a function that
    // returned nothing at all.
    const out = buildRuleConceptReport(
      report({ weak_concepts: [{ subject: "Physics", concept: "Refraction", accuracy: 40 }] }),
    );
    expect(out.bullets.join(" ")).toContain("Refraction");
    expect(out.next_steps.join(" ")).toContain("Refraction");
  });

  it("says nothing about a concept that has no name", () => {
    const out = buildRuleConceptReport(
      report({ weak_concepts: [{ subject: "Mathematics", concept: null, accuracy: 0 }] }),
    );
    const all = [out.headline, ...out.bullets, ...out.next_steps].join(" ");
    expect(all).not.toContain("null");
    expect(all).not.toContain("undefined");
  });

  it("still tells the student they have a weak area, and where", () => {
    // Losing the name must not lose the fact. The row is real; only its label
    // is missing, and dropping it silently would under-report the session.
    const out = buildRuleConceptReport(
      report({ weak_concepts: [{ subject: "Mathematics", concept: null, accuracy: 0 }] }),
    );
    expect(out.bullets.join(" ")).toContain("Mathematics");
    expect(out.bullets.join(" ")).not.toContain("No concept-level weaknesses");
  });

  it("gives next steps that do not need a concept name", () => {
    const out = buildRuleConceptReport(
      report({ weak_concepts: [{ subject: "Mathematics", concept: null, accuracy: 0 }] }),
    );
    expect(out.next_steps.length).toBeGreaterThan(0);
    expect(out.next_steps.join(" ")).toMatch(/Mistake Book|Nova/);
  });

  it("handles an empty string and the literal text 'null' the same way", () => {
    // Both shapes exist in this data: a genuinely empty tag, and a string that
    // was stringified from null somewhere upstream.
    for (const concept of ["", "   ", "null"]) {
      const out = buildRuleConceptReport(
        report({ weak_concepts: [{ subject: "Chemistry", concept, accuracy: 10 }] }),
      );
      const all = [...out.bullets, ...out.next_steps].join(" ");
      expect(all, `concept=${JSON.stringify(concept)}`).not.toMatch(/\bnull\b/);
    }
  });

  it("names the tagged concepts and ignores the untagged ones", () => {
    const out = buildRuleConceptReport(
      report({
        weak_concepts: [
          { subject: "Mathematics", concept: null, accuracy: 0 },
          { subject: "Physics", concept: "Refraction", accuracy: 40 },
        ],
      }),
    );
    const all = [...out.bullets, ...out.next_steps].join(" ");
    expect(all).toContain("Refraction");
    expect(all).not.toContain("null");
  });

  it("does not send the student to the Mistake Book twice in three steps", () => {
    const out = buildRuleConceptReport(
      report({ weak_concepts: [{ subject: "Mathematics", concept: null, accuracy: 0 }] }),
    );
    const mentions = out.next_steps.filter((s) => s.includes("Mistake Book")).length;
    expect(mentions, out.next_steps.join(" | ")).toBe(1);
  });

  it("says so plainly when there are no weak concepts at all", () => {
    const out = buildRuleConceptReport(report({ accuracy_pct: 100, correct_count: 1 }));
    expect(out.bullets.join(" ")).toContain("No concept-level weaknesses");
  });

  /**
   * A session nobody answered has no accuracy, and the report used to print
   * one. Measured 2026-09-19 on the practice result screen: for 24 of the
   * student's 40 latest sessions this report disagreed with the session's own
   * figures shown directly above it — "0%" where the session says "—".
   */
  it("reports no accuracy, and no verdict, when nothing was answered", () => {
    const out = buildRuleConceptReport(report({ accuracy_pct: null, correct_count: 0, total_count: 0 }));
    expect(out.headline).toContain("Nothing was answered");
    expect(out.bullets.join(" ")).toContain("No question was answered");
    expect(out.bullets.join(" "), "an absent accuracy must not be printed as a number")
      .not.toMatch(/\d+%/);
    expect(out.bullets.join(" ")).not.toContain("null");
  });

  it("gives no duration when none was recorded", () => {
    const none = buildRuleConceptReport(report({ time_minutes: null }));
    expect(none.bullets.join(" ")).not.toContain("Time spent");
    // POSITIVE CONTROL: it does report a duration it has.
    const timed = buildRuleConceptReport(report({ time_minutes: 7 }));
    expect(timed.bullets.join(" ")).toContain("Time spent: ~7 minutes");
  });
});
