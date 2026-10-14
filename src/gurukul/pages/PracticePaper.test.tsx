import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A previous-year question names the paper it was set in, on the question
 * itself (owner, 2026-10-14: "all the proper details have to be shown"). The
 * bank serves it with its exam year and its label (listBankQuestions); any
 * other question carries neither and shows nothing.
 */
const recordAttempt = vi.fn(async () => ({ attemptId: "a", isCorrect: true, skipped: false, correctIndex: 0, correctText: "", explanation: "" }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { access_token: "t" } }) }));
vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = {
    ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" },
    ready: true,
    settled: true,
  };
  return {
    ...actual,
    useAcademicContext: () => value,
    PracticeService: {
      ...actual.PracticeService,
      listBankQuestions: async () => [
        { id: "q1", question: "Set in 2023?", options: ["One", "Two", "Three", "Four"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy",
          source: "CUET (UG) 2023 · 30 May · Shift 3", exam_year: 2023 },
        { id: "q2", question: "From the ebook?", options: ["P", "Q", "R", "S"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy",
          source: "PW CUET ebook · Accountancy", exam_year: null },
      ],
      start: async () => "sid-1",
      recordAttempt: (...a: unknown[]) => recordAttempt(...(a as [])),
      formMix: async () => null,
      finish: async () => null,
    },
  };
});
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: async () => null,
}));

const { Session } = await import("@/gurukul/pages/Practice");
const CONFIG = { mode: "pyq", label: "Previous Year Questions", subject: "Accountancy", difficulty: "mixed", qCount: 2, timeLimitSec: null } as const;

describe("Practice — the paper a previous-year question was set in", () => {
  it("is named on that question, and not on a question with no exam year", async () => {
    render(
      <MemoryRouter>
        <Session config={CONFIG as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
      </MemoryRouter>,
    );
    await screen.findByText("Set in 2023?");
    expect(screen.getByTestId("question-paper")).toHaveTextContent("PYQ·CUET (UG) 2023 · 30 May · Shift 3");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^A\s*One/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Next/ })); });
    await screen.findByText("From the ebook?");
    // CONTROL: the ebook's source is not a paper, and is not shown as one.
    expect(screen.queryByTestId("question-paper")).toBeNull();
  });
});
