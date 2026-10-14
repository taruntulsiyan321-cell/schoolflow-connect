import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * How a mistake type's drill arrives at the Practice page (C5), through the
 * page itself rather than a Session handed its config: a time-pressure link is
 * timed at the real paper's pace, read as it arrives; a "these questions
 * again" hand-off starts exactly the marked questions, as a Mistake Book
 * reattempt.
 */

const h = vi.hoisted(() => ({
  listBankQuestions: vi.fn(),
  start: vi.fn(),
  paper: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => h.toastError(...a), message: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "user-1" }, session: { access_token: "t" } };
  return { useAuth: () => value };
});
vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT } = await import("@/gurukul/emptyStudent");
  const identity = { classId: null, schoolKind: "individual" };
  return { useGurukulStudent: () => EMPTY_STUDENT, useGurukulAcademicIdentity: () => identity, useGurukulShellReady: () => true };
});
vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = { ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" }, ready: true, settled: true };
  return {
    ...actual,
    useAcademicContext: () => value,
    PracticeService: {
      ...actual.PracticeService,
      resolveCurriculumScope: async () => ({ examId: "exam-1", classLevel: null }),
      listBankSubjects: async () => ["Accountancy"],
      settleAbandonedSessions: async () => 0,
      listHistory: async () => [],
      listSavedSessions: async () => [],
      listRecentFinished: async () => [],
      listBankQuestions: (...a: unknown[]) => h.listBankQuestions(...a),
      formMix: async () => null,
      start: (...a: unknown[]) => h.start(...a),
      recordAttempt: vi.fn(),
      finish: async () => null,
    },
  };
});
vi.mock("@/academic/services/studentUploadService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic/services/studentUploadService")>();
  return { ...actual, StudentUploadService: { ...actual.StudentUploadService, listByIds: async () => [] } };
});
vi.mock("@/academic/services/screenCaptureService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/academic/services/screenCaptureService")>()),
  listCaptureQuestionsByIds: async () => [],
}));
vi.mock("@/lib/examPaper", () => ({ fetchExamPaper: () => h.paper() }));
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: async () => null,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { default: Practice } = await import("@/gurukul/pages/Practice");

const PAPER = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 };
const QUESTION = { id: "q1", question: "Which?", options: ["A1", "B1", "C1", "D1"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" };
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const arrive = (entry: string | { pathname: string; state: unknown }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/student/practice" element={<Practice />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  h.listBankQuestions.mockReset();
  h.listBankQuestions.mockResolvedValue([QUESTION]);
  h.start.mockReset();
  h.start.mockResolvedValue("sid-1");
  h.paper.mockReset();
  h.toastError.mockReset();
});

describe("a time-pressure drill arrives timed at the paper's pace", () => {
  it("twenty questions at the paper's 72 seconds each is 24 minutes", async () => {
    h.paper.mockResolvedValue(PAPER);
    arrive("/student/practice?subject=Accountancy&drill=time_pressure");
    await waitFor(() => expect(h.start).toHaveBeenCalled());
    expect(h.start.mock.calls[0][1]).toMatchObject({ _subject: "Accountancy", _practice_mode: "subject", _time_limit_sec: 1440 });
    expect(await screen.findByText("Which?")).toBeInTheDocument();
  });

  it("with no paper on the account, says so and starts nothing untimed", async () => {
    h.paper.mockResolvedValue(null);
    arrive("/student/practice?subject=Accountancy&drill=time_pressure");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("There is no exam paper to keep pace with on this account."));
    expect(h.start).not.toHaveBeenCalled();
    expect(h.listBankQuestions).not.toHaveBeenCalled();
  });

  it("when the paper cannot be read, says so and starts nothing", async () => {
    h.paper.mockRejectedValue(new Error("timeout"));
    arrive("/student/practice?subject=Accountancy&drill=time_pressure");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Couldn't read the paper's pace. Try the drill again."));
    expect(h.start).not.toHaveBeenCalled();
  });

  it("CONTROL: another drill reads no paper and is not timed", async () => {
    arrive("/student/practice?subject=Accountancy&drill=calculation_error");
    await waitFor(() => expect(h.start).toHaveBeenCalled());
    expect(h.paper).not.toHaveBeenCalled();
    expect(h.start.mock.calls[0][1]).toMatchObject({ _time_limit_sec: null });
  });
});

describe("\"these questions again\" arrives as the marked questions", () => {
  it("starts exactly the questions handed over, as a Mistake Book reattempt, and nothing that is not an id", async () => {
    h.listBankQuestions.mockResolvedValue([{ ...QUESTION, id: U2 }, { ...QUESTION, id: U1, question: "First?" }]);
    arrive({ pathname: "/student/practice", state: { marked: { tag: "guessed", questionIds: [U1, "not-an-id", U2] } } });
    await waitFor(() => expect(h.start).toHaveBeenCalled());
    expect(h.listBankQuestions.mock.calls[0][1]).toEqual({ ids: [U1, U2], limit: 2 });
    expect(h.start.mock.calls[0][1]).toMatchObject({ _practice_mode: "incorrect", _count: 2 });
    // In the order handed over, whatever order the bank answered in.
    expect(await screen.findByText("First?")).toBeInTheDocument();
  });

  it("says so when the marked questions have left the bank", async () => {
    h.listBankQuestions.mockResolvedValue([]);
    arrive({ pathname: "/student/practice", state: { marked: { tag: "recall", questionIds: [U1] } } });
    expect(await screen.findByText("The questions you marked are no longer available.")).toBeInTheDocument();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("CONTROL: a hand-off holding no question starts nothing", async () => {
    arrive({ pathname: "/student/practice", state: { marked: { tag: "recall", questionIds: ["not-an-id"] } } });
    // The hub's modes are drawn; nothing was asked of the bank or started.
    expect((await screen.findAllByText("Subject Practice")).length).toBeGreaterThan(0);
    expect(h.listBankQuestions).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });
});
