import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { QuestionReport } from "@/lib/questionReports";

/**
 * The report control (§10.21) and the dialog behind it: what can be reported
 * before and after the answer is shown, "something else" needs words, the
 * option the student says is right, a report the check has taken is shown
 * not edited, and the plan's refusal is a notice.
 */

const lib = vi.hoisted(() => ({ reportQuestion: vi.fn() }));
vi.mock("@/lib/questionReports", async (orig) => ({
  ...(await orig<typeof import("@/lib/questionReports")>()),
  reportQuestion: (...a: unknown[]) => lib.reportQuestion(...a),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));

import { PlanLimitError } from "@/lib/premium";
import { ReportQuestionButton } from "./ReportQuestionButton";

const QUESTION = { text: "Goodwill is valued at?", options: ["₹10,000", "₹20,000", "₹30,000", "₹40,000"] };
const report = (over: Partial<QuestionReport> = {}): QuestionReport => ({
  id: "r1", questionId: "q1", reason: "wrong_answer", claimedIndex: 2, note: null, questionText: QUESTION.text,
  options: QUESTION.options, subject: null, chapter: null, status: "open", outcome: null, outcomeExplanation: null,
  replacementQuestionId: null, createdAt: "2026-10-03T10:00:00Z", resolvedAt: null, ...over,
});

function show(props: { answered?: boolean; report?: QuestionReport | null; variant?: "icon" | "button" } = {}) {
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <ReportQuestionButton
        variant={props.variant ?? "button"}
        questionId="q1"
        question={QUESTION}
        answered={props.answered ?? true}
        sessionId="s1"
        report={props.report ?? null}
        onChange={onChange}
      />
    </MemoryRouter>,
  );
  return onChange;
}
const dialog = () => screen.getByRole("dialog");
const send = () => within(dialog()).getByRole("button", { name: /send report|update report/i });

beforeEach(() => {
  lib.reportQuestion.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("reporting a question", () => {
  it("before answering offers only what can be wrong without the answer", () => {
    show({ answered: false, variant: "icon" });
    fireEvent.click(screen.getByRole("button", { name: "Report a problem with this question" }));
    const radios = within(dialog()).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["question_error", "other"]);
    expect(within(dialog()).getByText(/Once you've answered/)).toBeInTheDocument();
  });

  it("after answering, a wrong answer can name the right option, and sends it", async () => {
    lib.reportQuestion.mockResolvedValue({ created: true, report: report() });
    const onChange = show();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(send()).toBeDisabled();
    fireEvent.click(within(dialog()).getByLabelText("The marked answer is wrong"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "C" }));
    fireEvent.click(send());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(report()));
    expect(lib.reportQuestion).toHaveBeenCalledWith({ questionId: "q1", reason: "wrong_answer", claimedIndex: 2, note: "", sessionId: "s1" });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("checked within a few minutes"));
  });

  it("the option picker is for a wrong answer only, and is not sent with another reason", async () => {
    lib.reportQuestion.mockResolvedValue({ created: true, report: report({ reason: "question_error", claimedIndex: null }) });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(within(dialog()).getByLabelText("The marked answer is wrong"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "B" }));
    fireEvent.click(within(dialog()).getByLabelText("The question or its options have a mistake"));
    expect(within(dialog()).queryByRole("button", { name: "B" })).toBeNull();
    fireEvent.click(send());
    await waitFor(() => expect(lib.reportQuestion).toHaveBeenCalled());
    expect(lib.reportQuestion.mock.calls[0][0]).toMatchObject({ reason: "question_error", claimedIndex: null });
  });

  it("'something else' cannot be sent without words", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(within(dialog()).getByLabelText("Something else"));
    expect(send()).toBeDisabled();
    fireEvent.change(within(dialog()).getByLabelText(/^Note/), { target: { value: "Two options are the same" } });
    expect(send()).toBeEnabled();
  });

  it("a waiting report opens as itself, and can still be changed", () => {
    show({ report: report({ note: "It is C" }) });
    fireEvent.click(screen.getByRole("button", { name: "Your report" }));
    expect((within(dialog()).getByLabelText("The marked answer is wrong") as HTMLInputElement).checked).toBe(true);
    expect(within(dialog()).getByRole("button", { name: "C" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog()).getByDisplayValue("It is C")).toBeInTheDocument();
    expect(send()).toHaveTextContent("Update report");
  });

  it("a settled report shows what was found and offers nothing to send", () => {
    show({
      report: report({
        status: "fixed", outcome: "The marked answer was wrong: it is (C), not (B).",
        outcomeExplanation: "Answer: (C) ₹30,000\n\nThe working.", resolvedAt: "2026-10-03T10:03:00Z",
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Your report" }));
    expect(within(dialog()).getByText("Your report")).toBeInTheDocument();
    expect(within(dialog()).getByText("Fixed")).toBeInTheDocument();
    expect(within(dialog()).getByText("The marked answer was wrong: it is (C), not (B).")).toBeInTheDocument();
    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: /send report|update report/i })).toBeNull();
  });

  it("the plan's refusal is shown as its notice, and nothing is saved", async () => {
    lib.reportQuestion.mockRejectedValue(new PlanLimitError({
      feature: "question.report", reason: "limit_reached", message: "You've used today's 10 question reports.",
      decision: { ok: false, feature: "question.report" },
    }));
    const onChange = show();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(within(dialog()).getByLabelText("The marked answer is wrong"));
    fireEvent.click(send());
    expect(await within(dialog()).findByText("You've used today's 10 question reports.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
