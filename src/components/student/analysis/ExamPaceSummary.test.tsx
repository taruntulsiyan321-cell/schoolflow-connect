import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ExamPaceSummary, OverThePaper } from "./ExamPaceSummary";

const PAPER = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 };

describe("the student's pace against the real paper", () => {
  it("names the subjects slower than the paper, furthest over first, and nothing about the rest", () => {
    render(
      <ExamPaceSummary
        paper={PAPER}
        subjects={[
          { key: "Economics", timed: 12, avgSec: 95 },
          { key: "Accountancy", timed: 30, avgSec: 140 },
          { key: "Business Studies", timed: 9, avgSec: 60 },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("exam-pace-over");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Accountancy140s68s over the paper",
      "Economics95s23s over the paper",
    ]);
    expect(screen.queryByText("Business Studies")).toBeNull();
  });

  it("with too few timed answers anywhere, says so rather than ranking noise", () => {
    render(<ExamPaceSummary paper={PAPER} subjects={[{ key: "Hindi", timed: 1, avgSec: 300 }]} />);
    expect(screen.getByTestId("exam-pace")).toHaveTextContent("No subject has 5 timed answers behind it yet.");
  });

  it("under one row's pace: how far over the paper, or nothing", () => {
    const { container, rerender } = render(<OverThePaper avgSec={100} paper={PAPER} />);
    expect(container).toHaveTextContent("28s over the paper");
    rerender(<OverThePaper avgSec={60} paper={PAPER} />);
    expect(container.textContent).toBe("");
    rerender(<OverThePaper avgSec={100} paper={null} />);
    expect(container.textContent).toBe("");
    expect(within(container).queryByText(/over the paper/)).toBeNull();
  });
});
