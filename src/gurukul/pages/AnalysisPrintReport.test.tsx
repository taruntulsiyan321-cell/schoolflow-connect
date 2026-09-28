import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { AnalysisPrintReport } from "./AnalysisPrintReport";

/**
 * "Print or save as PDF" printed whichever tab was on screen, with the
 * sidebar and the bottom bar, because the app had no print styles. The
 * report is the page's figures on paper, mounted only while printing.
 */
const props = {
  studentName: "Arjun Mehta",
  summary: [{ label: "Practice accuracy", value: "50%" }, { label: "Open mistakes", value: null }],
  totals: [{ label: "Questions solved", value: "161" }],
  subjects: [{ name: "Mathematics", accuracy: 55, attempts: 120, measuredMs: 4_200_000 }, { name: "Hindi", accuracy: null, attempts: 3, measuredMs: null }],
  topics: [
    { topic: "Word Problems", chapter: "Polynomials", subject: "Mathematics", score: 31, attempts: 16 },
    { topic: "Word Problems", chapter: "Light", subject: "Science", score: 28, attempts: 9 },
  ],
  months: [{ label: "Study time", thisM: 8_400_000, lastM: null, unit: "time" }],
};

const report = () => document.body.querySelector(".analysis-print-report");

describe("AnalysisPrintReport", () => {
  it("is not in the page until the browser prints", () => {
    render(<AnalysisPrintReport {...props} />);
    expect(report()).toBeNull();
  });

  it("carries every tab's figures while printing, and leaves when printing ends", () => {
    render(<AnalysisPrintReport {...props} />);
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    const r = report();
    expect(r).not.toBeNull();
    const text = r!.textContent ?? "";
    expect(text).toContain("Arjun Mehta");
    expect(text).toContain("Practice accuracy50%");
    expect(text).toContain("Open mistakesnot recorded yet");
    expect(text).toContain("Questions solved161");
    expect(text).toContain("Mathematics55%1201h 10m");
    expect(text).toContain("Hindinot enough yet3—");
    // Two topics of one name, told apart by their chapters.
    expect(text).toContain("Word ProblemsPolynomials");
    expect(text).toContain("Word ProblemsLight");
    expect(text).toContain("Study time2h 20m—");
    act(() => { window.dispatchEvent(new Event("afterprint")); });
    expect(report()).toBeNull();
  });
});
