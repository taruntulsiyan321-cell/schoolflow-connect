/**
 * The "Get insights" coach is told exactly what happened in the session.
 *
 * Measured 2026-09-26 on www.gurukul.study: for a CUET practice session with 4
 * answers, all wrong, the coach claimed the "assessment was submitted without
 * answering any questions", sent the student to "your school's IT support",
 * and wrote about recovery assignments that no longer exist.
 */
import { describe, expect, it } from "vitest";
import { buildConceptReportPrompt } from "../../supabase/functions/_shared/conceptReportPrompt.ts";

const SESSION = {
  source_type: "practice_session",
  accuracy_pct: 0,
  correct_count: 0,
  total_count: 4,
  time_minutes: 0.3,
  weak_concepts: [
    { subject: "Business Studies", chapter: "Directing", concept: "Marketing", accuracy: 0 },
    { subject: "Business Studies", chapter: "Planning", concept: "Planning", accuracy: 0 },
  ],
};

describe("the concept-report coach's prompt", () => {
  it("says how many were answered, and how many went wrong", () => {
    const { user } = buildConceptReportPrompt(SESSION);
    expect(user).toContain("Questions answered: 4 — 0 correct, 4 wrong (accuracy 0%).");
    expect(user).toContain("This was a practice session.");
  });

  it("names each weak concept with its chapter, unless the chapter is the concept", () => {
    const { user } = buildConceptReportPrompt(SESSION);
    expect(user).toContain("Marketing (Directing, 0%); Planning (0%)");
  });

  it("forbids guessing at unanswered questions or sending the student to school staff, and drops the old recovery engine", () => {
    const { system, user } = buildConceptReportPrompt(SESSION);
    expect(system).toContain("never suggest that questions went unanswered");
    expect(system).toContain("never refer the student to school staff or IT support");
    expect(system).not.toMatch(/school students|post-assessment/i);
    expect(`${system}\n${user}`).not.toMatch(/recovery assignment/i);
  });

  it("CONTROL: a session with nothing answered says so, and has no accuracy", () => {
    const { user } = buildConceptReportPrompt({ ...SESSION, accuracy_pct: null, correct_count: 0, total_count: 0, weak_concepts: [] });
    expect(user).toContain("No question was answered, so there is no accuracy.");
    expect(user).toContain("Weak concepts, with their chapter: none.");
    expect(user).not.toContain("Questions answered:");
  });
});
