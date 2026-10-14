import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * A revision check ended early is refused by the engine
 * (rpc_submit_revision_session: "a revision check needs 8 unseen question(s)…").
 * The session hands that refusal to the result screen, which says it, rather than
 * flashing a toast the result screen then covers.
 */

const submitRevision = vi.fn();
const onFinish = vi.fn();

// One object, as the real hook's context gives: a fresh one per render re-runs
// every effect that depends on the user, and the page renders without end.
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
      listBankQuestions: async () => [
        { id: "q1", question: "First?", options: ["A1", "B1", "C1", "D1"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
        { id: "q2", question: "Second?", options: ["A2", "B2", "C2", "D2"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
      ],
      start: async () => "sid-1",
      recordAttempt: async () => ({ is_correct: false }),
      finish: async () => ({ total: 1, correct_count: 0, wrong_count: 1, skipped_count: 0, accuracy: 0, xp_earned: 5 }),
      resolveCurriculumScope: async () => ({ examId: "exam-1", classLevel: null }),
      listBankSubjects: async () => ["Accountancy"],
      settleAbandonedSessions: async () => 0,
      listHistory: async () => [],
      listSavedSessions: async () => [],
      listRecentFinished: async () => [],
      formMix: async () => null,
    },
    RecoveryEngineService: { ...actual.RecoveryEngineService, submitRevisionSession: (...a: unknown[]) => submitRevision(...a) },
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
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: async () => null,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { Session, default: Practice } = await import("@/gurukul/pages/Practice");

const CHECK = {
  mode: "revision", label: "Revision check", subject: "Mixed", chapter: null, topic: null, difficulty: "mixed", qCount: 2, timeLimitSec: null,
  revision: { chapterId: "c1", questionIds: ["q1", "q2"], mistakes: 0, fresh: 2 },
};

const endAfterOne = async () => {
  render(<MemoryRouter><Session config={CHECK as never} onFinish={onFinish} onBack={() => {}} subjects={[]} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /^A\s*A1/ }));
  fireEvent.click(await screen.findByRole("button", { name: "End Session" }));
  await waitFor(() => expect(onFinish).toHaveBeenCalled());
  return onFinish.mock.calls[0][0] as { notCounted?: unknown; revision?: unknown };
};

beforeEach(() => {
  submitRevision.mockReset();
  onFinish.mockReset();
});

describe("Practice — a revision check the engine refused", () => {
  it("hands the refusal, and why, to the result screen", async () => {
    submitRevision.mockRejectedValue({ message: "a revision check needs 8 unseen question(s) from this chapter; that sitting answered 1" });
    const result = await endAfterOne();
    expect(submitRevision).toHaveBeenCalledWith(expect.anything(), "c1", "sid-1");
    expect(result.notCounted).toEqual({ kind: "revision", reason: "a revision check needs 8 unseen question(s) from this chapter; that sitting answered 1" });
    expect(result.revision).toBeUndefined();
  });

  it("CONTROL: a check the engine counted carries its verdict and no refusal", async () => {
    submitRevision.mockResolvedValue({ passed: false, consecutive_passes: 0 });
    const result = await endAfterOne();
    expect(result.revision).toMatchObject({ passed: false });
    expect(result.notCounted).toBeUndefined();
  });
});

describe("Practice page — the refusal reaches the result screen", () => {
  function Arrived() {
    return <pre data-testid="arrived">{JSON.stringify((useLocation().state as { notCounted?: unknown } | null)?.notCounted ?? null)}</pre>;
  }

  it("a revision check handed over, ended early and refused, opens its result with the refusal", async () => {
    submitRevision.mockRejectedValue({ message: "a revision check needs 8 unseen question(s) from this chapter; that sitting answered 1" });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/student/practice", state: { revision: CHECK.revision } }]}>
        <Routes>
          <Route path="/student/practice" element={<Practice />} />
          <Route path="/student/practice/session/:id/result" element={<Arrived />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^A\s*A1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "End Session" }));
    expect(JSON.parse((await screen.findByTestId("arrived")).textContent!)).toEqual({
      kind: "revision", reason: "a revision check needs 8 unseen question(s) from this chapter; that sitting answered 1",
    });
  });
});
