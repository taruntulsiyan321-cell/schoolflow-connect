import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * What a student sees of each question form (owner, 2026-10-03): Assertion and
 * Reason as two labelled statements, a match as a two-column table, a case in
 * its own box above its question — from the migration's own fixtures.
 */
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));

import { PreviousYearBadge, QuestionFormBadge, QuestionText } from "./QuestionText";

type Fixture = { form: string; text: string; options: string[]; parts?: unknown };
const MIGRATION = readFileSync("supabase/migrations/20261141000000_every_question_form_is_laid_out.sql", "utf8");
const FIXTURES: Fixture[] = JSON.parse(MIGRATION.match(/_fixtures constant jsonb := \$json\$([\s\S]*?)\$json\$/)![1]);
const fixture = (form: string) => FIXTURES.find((f) => f.form === form && f.parts)!;

describe("a question as it is shown", () => {
  it("assertion–reason: two labelled statements, each on its own", () => {
    render(<QuestionText text={fixture("assertion_reason").text} />);
    const ar = screen.getByTestId("question-assertion-reason");
    const [a, r] = within(ar).getAllByRole("paragraph");
    expect(a).toHaveTextContent("Assertion (A): Goodwill is an intangible asset of a firm.");
    expect(r).toHaveTextContent("Reason (R): Goodwill cannot be seen or touched but has a value.");
  });

  it("match: List I and List II side by side, row by row", () => {
    render(<QuestionText text={fixture("match").text} />);
    const table = within(screen.getByTestId("question-match")).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["List I (Ratio)", "List II (Type)"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["A.Current ratio", "I.Solvency ratio"],
      ["B.Quick ratio", "II.Liquidity ratio"],
      ["C.Debt-equity ratio", "III.Acid-test ratio"],
    ]);
  });

  it("case-based: the case in its own box, the question after it", () => {
    const { container } = render(<QuestionText text={fixture("case_based").text} />);
    const box = screen.getByTestId("question-case");
    expect(box).toHaveTextContent(/^CaseAsha and Binu are partners/);
    expect(box).not.toHaveTextContent("In what ratio");
    expect(container.textContent?.endsWith("In what ratio will Asha and Binu share the premium brought in by Chetan?")).toBe(true);
  });

  it("statements: a numbered list between the introduction and the question", () => {
    render(<QuestionText text={fixture("statements").text} />);
    const items = within(screen.getByTestId("question-list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "I.It may be oral or written.",
      "II.It must be registered with the Registrar of Firms.",
      "III.It settles the ratio in which profits are shared.",
    ]);
  });

  it("an older question's options, printed again in its text, are shown once", () => {
    const f = FIXTURES.find((x) => x.text.startsWith("If a company's Proprietors' Funds"))!;
    render(<QuestionText text={f.text} options={f.options} />);
    expect(screen.queryByTestId("question-list")).toBeNull();
    expect(screen.getByTestId("question-text")).toHaveTextContent(/^If a company's Proprietors' Funds are ₹5,00,000, what are its Net Assets\?$/);
  });

  it("compact: one line, for a card", () => {
    const { container } = render(<QuestionText compact text={fixture("assertion_reason").text} />);
    expect(container.textContent).toBe("Assertion (A): Goodwill is an intangible asset of a firm. Reason (R): Goodwill cannot be seen or touched but has a value.");
    expect(screen.queryByTestId("question-text")).toBeNull();
  });

  it("its form is named beside it — and a direct question is not labelled", () => {
    const { rerender } = render(<QuestionFormBadge text={fixture("assertion_reason").text} options={fixture("assertion_reason").options} />);
    expect(screen.getByTestId("question-form")).toHaveTextContent("Assertion–reason");
    rerender(<QuestionFormBadge text={fixture("sequence").text} options={fixture("sequence").options} />);
    expect(screen.getByTestId("question-form")).toHaveTextContent("Sequence");
    rerender(<QuestionFormBadge text={fixture("statements").text} options={fixture("statements").options} />);
    expect(screen.getByTestId("question-form")).toHaveTextContent("Statement-based");
    rerender(<QuestionFormBadge text={fixture("mcq").text} options={fixture("mcq").options} />);
    expect(screen.queryByTestId("question-form")).toBeNull();
  });

  it("nothing for a question with no text", () => {
    const { container } = render(<QuestionText text={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a table of data, as it is shown", () => {
  const TEXT = "Given:\n| Particulars | 2020 (Rs.) |\n| --- | --- |\n| Cash | 36,000 |\n| Bank overdraft | - |\nFind the cash flow.";

  it("has its header cells and its rows, figures right-aligned and words not", () => {
    render(<QuestionText text={TEXT} />);
    const table = within(screen.getByTestId("question-table")).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Particulars", "2020 (Rs.)"]);
    const rows = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell"));
    expect(rows.map((r) => r.map((c) => c.textContent))).toEqual([["Cash", "36,000"], ["Bank overdraft", "-"]]);
    expect(rows[0][1]).toHaveClass("text-right");
    expect(rows[0][0]).not.toHaveClass("text-right");
  });

  it("inside a case, in the case's own box", () => {
    render(<QuestionText text={"Case: The firm's balances were:\n\n| Account | Rs. |\n| --- | --- |\n| Capital | 50,000 |\nQuestion: What is the capital?"} />);
    expect(within(screen.getByTestId("question-case")).getByTestId("question-table")).toBeInTheDocument();
  });
});

describe("the paper a previous-year question was set in", () => {
  it("is named beside the question", () => {
    render(<PreviousYearBadge source="CUET (UG) 2023 · 30 May · Shift 3 · Section A" examYear={2023} />);
    expect(screen.getByTestId("question-paper")).toHaveTextContent("PYQ·CUET (UG) 2023 · 30 May · Shift 3 · Section A");
  });

  it("says the year when the paper has no label", () => {
    render(<PreviousYearBadge source={null} examYear={2022} />);
    expect(screen.getByTestId("question-paper")).toHaveTextContent("PYQ·Previous year 2022");
  });

  it("CONTROL: nothing for a question with no exam year, whatever its source says", () => {
    const { container } = render(<PreviousYearBadge source="PW CUET ebook · Accountancy" examYear={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
