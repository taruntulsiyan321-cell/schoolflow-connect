import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readExplanation } from "@/lib/explanationText";

vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));
import { ExplanationText } from "./ExplanationText";

/**
 * Every explanation the app shows goes through ExplanationText: the ruled shape
 * (answer, working, why each other option is wrong) laid out as such, and an
 * older plain one with its line breaks kept — they were collapsed into one run
 * of text on every screen that showed them.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261138000000_ai_practice_and_explanations_that_explain.sql"),
  "utf8",
);
const FIXTURE = MIGRATION.match(/_fixture constant text := E'((?:[^']|'')*)';/)![1].replace(/''/g, "'").replace(/\\n/g, "\n");

describe("reading an explanation", () => {
  it("the database's own proper fixture reads as the ruled shape", () => {
    const r = readExplanation(FIXTURE);
    expect(r?.kind).toBe("structured");
    if (r?.kind !== "structured") return;
    expect(r.answer).toEqual({ letter: "B", text: "₹30,000" });
    expect(r.working).toHaveLength(1);
    expect(r.wrong.map((w) => w.letter)).toEqual(["A", "C", "D"]);
  });

  it("the bank's old one-liners and AI paragraphs read as plain, lines kept", () => {
    expect(readExplanation("Answer (a) — from chapter answer key.")).toEqual({ kind: "plain", paragraphs: [["Answer (a) — from chapter answer key."]] });
    expect(readExplanation("Step 1: find CA.\nStep 2: find QA.\n\nSo inventory is ₹20,000.")).toEqual({
      kind: "plain",
      paragraphs: [["Step 1: find CA.", "Step 2: find QA."], ["So inventory is ₹20,000."]],
    });
    expect(readExplanation("   ")).toBeNull();
    expect(readExplanation({ not: "text" })).toBeNull();
  });

  it("a shape missing its wrong-option lines is not passed off as structured", () => {
    expect(readExplanation("Answer: (B) x\n\nWorking here.\n\nWhy the other options are wrong:\nsee the book")?.kind).toBe("plain");
  });
});

describe("showing it", () => {
  it("lays the ruled shape out: answer, working, a list of why the others are wrong", () => {
    render(<ExplanationText text={FIXTURE} />);
    const box = screen.getByTestId("explanation-structured");
    expect(within(box).getByText("Why the other options are wrong")).toBeInTheDocument();
    expect(within(box).getAllByRole("listitem")).toHaveLength(3);
    expect(within(box).getByText(/the Act fixes the rate at 6% per annum/)).toBeInTheDocument();
  });

  it("keeps a plain explanation's lines as lines", () => {
    render(<ExplanationText text={"Step 1: find CA.\nStep 2: find QA."} />);
    const box = screen.getByTestId("explanation-plain");
    expect(within(box).getByText("Step 1: find CA.")).toBeInTheDocument();
    expect(within(box).getByText("Step 2: find QA.")).toBeInTheDocument();
  });
});
