import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A mistake type's drill (C5) reaches the bank: a session started with one
 * asks the bank for only the questions that type needs — and a session
 * without one asks for no such narrowing.
 */

const listBankQuestions = vi.fn();

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
      listBankQuestions: (...a: unknown[]) => listBankQuestions(...a),
      start: async () => "sid-1",
      recordAttempt: vi.fn(),
    },
  };
});
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: async () => null,
}));

const { Session } = await import("@/gurukul/pages/Practice");
const { MISTAKE_DRILLS } = await import("@/lib/questionMarks");

const BASE = { mode: "subject", label: "Subject Practice", subject: "Accountancy", difficulty: "mixed", qCount: 20, timeLimitSec: null };
const QUESTION = { id: "q1", question: "How much?", options: ["₹ 1", "₹ 2", "₹ 3", "₹ 4"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" };

const run = async (config: Record<string, unknown>) => {
  render(
    <MemoryRouter>
      <Session config={config as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
    </MemoryRouter>,
  );
  await screen.findByText("How much?");
  return listBankQuestions.mock.calls[0][1] as Record<string, unknown>;
};

describe("Practice — a mistake type's drill", () => {
  beforeEach(() => {
    listBankQuestions.mockReset();
    listBankQuestions.mockResolvedValue([QUESTION]);
  });

  it("a calculation drill asks for questions worked out to a figure", async () => {
    const opts = await run({ ...BASE, label: MISTAKE_DRILLS.calculation_error.label, drill: MISTAKE_DRILLS.calculation_error });
    expect(opts).toMatchObject({ subject: "Accountancy", numberAnswers: true, forms: null });
  });

  it("a reading drill asks for statement and assertion–reason questions", async () => {
    const opts = await run({ ...BASE, drill: MISTAKE_DRILLS.misread_question });
    expect(opts).toMatchObject({ numberAnswers: false, forms: ["statements", "assertion_reason"] });
  });

  it("CONTROL: a session with no drill narrows by neither", async () => {
    const opts = await run(BASE);
    expect(opts).toMatchObject({ numberAnswers: false, forms: null });
  });

  it("says what the drill looked for when the bank has none of it in the subject", async () => {
    listBankQuestions.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Session config={{ ...BASE, subject: "Business Studies", drill: MISTAKE_DRILLS.calculation_error } as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("The bank has no questions worked out to a figure in Business Studies yet.")).toBeInTheDocument();
  });
});
