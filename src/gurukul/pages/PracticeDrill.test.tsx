import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A mistake type's drill (C5) reaches the bank: a session started with one
 * asks the bank for only the questions that type needs — and a session
 * without one asks for no such narrowing.
 */

const listBankQuestions = vi.fn();
const formMix = vi.fn();
const start = vi.fn();
const uploadsByIds = vi.fn();
const capturesByIds = vi.fn();

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
      formMix: (...a: unknown[]) => formMix(...a),
      start: (...a: unknown[]) => start(...a),
      recordAttempt: vi.fn(),
      finish: async () => null,
    },
  };
});
vi.mock("@/academic/services/studentUploadService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic/services/studentUploadService")>();
  return { ...actual, StudentUploadService: { ...actual.StudentUploadService, listByIds: (...a: unknown[]) => uploadsByIds(...a) } };
});
vi.mock("@/academic/services/screenCaptureService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/academic/services/screenCaptureService")>()),
  listCaptureQuestionsByIds: (...a: unknown[]) => capturesByIds(...a),
}));
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
    formMix.mockReset();
    formMix.mockResolvedValue({ mcq: 24, case_based: 10 });
    start.mockReset();
    start.mockResolvedValue("sid-1");
    uploadsByIds.mockReset();
    uploadsByIds.mockResolvedValue([]);
    capturesByIds.mockReset();
    capturesByIds.mockResolvedValue([]);
  });

  it("a chapter drill draws fresh questions from its chapter, in the paper's mix", async () => {
    const opts = await run({ ...BASE, mode: "chapter", chapter: "Ratio Analysis", drill: MISTAKE_DRILLS.conceptual_gap });
    expect(opts).toMatchObject({ subject: "Accountancy", chapter: "Ratio Analysis", numberAnswers: false, forms: null });
    expect(opts.formMix).toEqual({ mcq: 24, case_based: 10 });
  });

  it("a drill at the paper's pace narrows nothing: the paper's own mix", async () => {
    const opts = await run({ ...BASE, timeLimitSec: 1440, drill: MISTAKE_DRILLS.time_pressure });
    expect(opts).toMatchObject({ numberAnswers: false, forms: null, formMix: { mcq: 24, case_based: 10 } });
    expect(start.mock.calls[0][1]).toMatchObject({ _time_limit_sec: 1440 });
  });

  it("the marked questions again: exactly those, by their own ids, as a Mistake Book reattempt", async () => {
    const opts = await run({ ...BASE, mode: "incorrect", subject: "Mixed", label: MISTAKE_DRILLS.recall.label, qCount: 2, marked: { questionIds: ["q1", "q9"] } });
    expect(opts).toEqual({ ids: ["q1", "q9"], limit: 2 });
    expect(uploadsByIds).toHaveBeenCalledWith(expect.anything(), ["q1", "q9"]);
    expect(capturesByIds).toHaveBeenCalledWith(expect.anything(), ["q1", "q9"]);
    // Never counted against a plan: the server reads the mode (rpc_record_question_attempt).
    expect(start.mock.calls[0][1]).toMatchObject({ _practice_mode: "incorrect", _subject: "Accountancy", _count: 1 });
    expect(formMix).not.toHaveBeenCalled();
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

  it("an ordinary session is drawn in the real paper's mix for its subject (C7)", async () => {
    const opts = await run(BASE);
    expect(formMix).toHaveBeenCalledWith(expect.anything(), "Accountancy");
    expect(opts.formMix).toEqual({ mcq: 24, case_based: 10 });
  });

  it("a drill is not: it already chose its forms (C7)", async () => {
    const opts = await run({ ...BASE, drill: MISTAKE_DRILLS.misread_question });
    expect(formMix).not.toHaveBeenCalled();
    expect(opts.formMix).toBeNull();
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
