import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Readiness } from "@/academic/metrics/readiness";
import { ReadinessEstimate } from "./ReadinessEstimate";

const PAPER = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 };

describe("if the paper were today", () => {
  it("each estimate says what it stands on; a subject not yet read says what it still needs", () => {
    const rows: Readiness[] = [
      { subject: "Accountancy", kind: "estimate", accuracy: 30, answered: 120, practised: 6, chapters: 11, marks: 40, maxMarks: 250, perQuestion: 0.8 },
      { subject: "Economics", kind: "estimate", accuracy: 10, answered: 60, practised: 5, chapters: 10, marks: -20, maxMarks: 250, perQuestion: -0.4 },
      { subject: "Business Studies", kind: "not_yet", practised: 3, chapters: 12, answered: 20, needChapters: 6, needAnswers: 50 },
    ];
    render(<ReadinessEstimate paper={PAPER} rows={rows} />);
    const est = screen.getAllByTestId("readiness-estimate");
    expect(est[0]).toHaveTextContent("Accountancy40 of 250");
    expect(est[0]).toHaveTextContent("At 30% right over 120 answers, answering all 50 · 6 of 11 chapters practised");
    expect(est[0]).not.toHaveTextContent("better left");
    expect(est[1]).toHaveTextContent("-20 of 250");
    expect(est[1]).toHaveTextContent("an answer costs more than it earns");
    expect(screen.getByTestId("readiness-not-yet")).toHaveTextContent("Business StudiesNot yet — 3 more chapters and 30 more answers");
    expect(screen.getByTestId("readiness")).toHaveTextContent("A subject is read once half its chapters (50%) and 50 answers are behind it.");
  });
});
