import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";

/**
 * THE SESSION REPORT'S TIME, PER QUESTION AND ON AVERAGE.
 *
 * Each question card carries the time it took, from the one clock the finish
 * sums into the session's length (question_attempts.time_taken_ms). The
 * questions reach this screen three ways — this device's own log, the
 * database, a saved snapshot — and each is asserted, because a time wired
 * through two of them renders a screen that looks finished.
 *
 * "Avg / answer" is read off the same times, over answers only: a skip is
 * time spent, not solving. It was total ÷ question count.
 */

const db = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  attempts: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/academic", () => ({
  useAcademicContext: () => ({ ctx: { schoolId: "s1", userId: "u1", role: "student" }, ready: true }),
  PracticeService: {
    getSession: () => Promise.resolve(db.session),
    listSessionAttempts: () => Promise.resolve(db.attempts),
    saveSession: () => Promise.resolve({ saved_at: null }),
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/learn/ExplainPanel", () => ({ ExplainPanel: () => null }));
vi.mock("@/components/student/ConceptRecoveryReport", () => ({ ConceptRecoveryReport: () => null }));
vi.mock("@/components/MathText", () => ({
  MathText: ({ text }: { text: string }) => <span>{text}</span>,
}));

import PracticeSessionResult from "./PracticeSessionResult";

function show(state?: PracticeSessionResultState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/student/practice/session/s1/result", state }]}>
      <Routes>
        <Route path="/student/practice/session/:id/result" element={<PracticeSessionResult />} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = (question: string) => screen.getByText(question).closest("div.p-5") as HTMLElement;
const tile = (label: string) => within(screen.getByTestId("summary-score")).getByText(label).parentElement as HTMLElement;
/** The questions are on the Questions tab; the session's figures on Summary. */
async function openQuestions(text: string) {
  fireEvent.click(await screen.findByRole("tab", { name: "Questions" }));
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}
const openSummary = () => fireEvent.click(screen.getByRole("tab", { name: "Summary" }));


const q = (question: string, over: Partial<PracticeSessionResultState["attempts"][number]> = {}) => ({
  question,
  options: ["A", "B"],
  correctIndex: 0,
  selectedIndex: 0,
  isCorrect: true,
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
  db.session = null;
  db.attempts = [];
});

describe("the session report's time", () => {
  it("shows each question's own time, a skip's included, and none for an untimed one", async () => {
    show({
      subject: "Mathematics",
      chapter: "Algebra",
      attempts: [
        q("First question", { timeTakenMs: 42_000 }),
        q("Second question", { timeTakenMs: 100_000, selectedIndex: 1, isCorrect: false }),
        q("Third question", { timeTakenMs: 2_000, skipped: true, selectedIndex: -1, isCorrect: false }),
        q("Fourth question", { timeTakenMs: null }),
      ],
    });
    await openQuestions("First question");

    expect(within(card("First question")).getByTestId("question-time").textContent).toBe("42s");
    expect(within(card("Second question")).getByTestId("question-time").textContent).toBe("1m 40s");
    // A skip took time too, and says it was a skip — two seconds is not an answer.
    expect(within(card("Third question")).getByText(/Skipped/)).toBeInTheDocument();
    expect(within(card("Third question")).getByTestId("question-time").textContent).toBe("2s");
    // POSITIVE CONTROL for the blank: an untimed question has no time, not "0s".
    expect(within(card("Fourth question")).queryByTestId("question-time")).toBeNull();

    openSummary();
    // The session's length is the sum of the questions: 144s.
    expect(within(tile("Time")).getByText("2m 24s")).toBeInTheDocument();
    // (42 + 100 + 0 untimed) over the two timed ANSWERS = 71s. Counting the
    // skip gives 48s; total ÷ question count gives 36s.
    expect(within(tile("Per answer")).getByText("71s")).toBeInTheDocument();
  });

  it("reads each question's time from the database when the device has no log", async () => {
    db.session = {
      id: "s1", subject: "Mathematics", chapter: "Algebra", question_count: 2, correct_count: 1,
      wrong_count: 0, skipped_count: 1, accuracy: 100, total_time_ms: 35_000,
      finished_at: "2026-09-26T10:00:00Z", created_at: "2026-09-26T09:59:00Z", score: 1,
    };
    db.attempts = [
      { id: "a1", generated_question: { question: "Database question", options: ["A", "B"] }, correct_answer: { index: 0 },
        selected_answer: { index: 0 }, is_correct: true, skipped: false, time_taken_ms: 33_000, created_at: "2026-09-26T09:59:30Z" },
      { id: "a2", generated_question: { question: "Skipped in the database", options: ["A", "B"] }, correct_answer: { index: 1 },
        selected_answer: null, is_correct: false, skipped: true, time_taken_ms: 2_000, created_at: "2026-09-26T09:59:40Z" },
    ];
    show();
    await openQuestions("Database question");
    expect(within(card("Database question")).getByTestId("question-time").textContent).toBe("33s");
    expect(within(card("Skipped in the database")).getByTestId("question-time").textContent).toBe("2s");
    openSummary();
    expect(within(tile("Per answer")).getByText("33s")).toBeInTheDocument();
  });

  it("reads each question's time from a saved snapshot, and none from one saved before times were kept", async () => {
    const snapshot = (attempts: Record<string, unknown>[]) => ({
      version: 5, subject: "Mathematics", chapter: "Algebra", practiceMode: "chapter", difficulty: null,
      questionCount: attempts.length, correctCount: 1, wrongCount: 0, skippedCount: 0, accuracy: 100,
      xpEarned: 5, totalTimeMs: 50_000, finishedAt: "2026-09-26T10:00:00Z", startedAt: null,
      attempts, insights: { headline: "", bullets: [], recommendations: [] },
    });
    db.session = {
      id: "s1", subject: "Mathematics", chapter: "Algebra", question_count: 2, correct_count: 1,
      wrong_count: 1, skipped_count: 0, accuracy: 50, total_time_ms: 50_000,
      finished_at: "2026-09-26T10:00:00Z", created_at: "2026-09-26T09:59:00Z", score: 1,
      analysis_snapshot: snapshot([
        { question: "Saved question", options: ["A", "B"], correctIndex: 0, selectedIndex: 0, isCorrect: true, skipped: false, timeTakenMs: 20_000 },
        // A version-4 question: no time was frozen with it.
        { question: "Older saved question", options: ["A", "B"], correctIndex: 0, selectedIndex: 1, isCorrect: false, skipped: false },
      ]),
    };
    show();
    await openQuestions("Saved question");
    expect(within(card("Saved question")).getByTestId("question-time").textContent).toBe("20s");
    expect(within(card("Older saved question")).queryByTestId("question-time")).toBeNull();
    openSummary();
    // One timed answer: 20s. Not the session's 50s over two questions.
    expect(within(tile("Per answer")).getByText("20s")).toBeInTheDocument();
  });
});

describe("the revision verdict on the ladder", () => {
  const outcome = (over: Record<string, unknown>) => ({
    passed: true, rate: 0.85, correct: 11, total: 13, mistake_correct: 4, mistake_total: 5,
    fresh_correct: 7, fresh_total: 8, stage: 2, solid: false, consecutive_passes: 2,
    stages_to_solid: 3, next_revision_at: "2026-10-06T10:00:00Z", state: "recovered", ...over,
  });
  const revisionState = (over: Record<string, unknown>) =>
    ({ subject: "Mathematics", chapter: "Algebra", attempts: [q("A question")], revision: outcome(over) }) as never;

  it("numbers a check on the way to solid", async () => {
    show(revisionState({}));
    expect(await screen.findByText("check 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("3 in a row makes it solid")).toBeInTheDocument();
  });

  it("calls a solid chapter's check a solid check, and its run is not '5/3'", async () => {
    show(revisionState({ stage: 5, solid: true, consecutive_passes: 5 }));
    expect(await screen.findByText("solid check")).toBeInTheDocument();
    expect(screen.queryByText(/check 5 of/)).toBeNull();
    const run = screen.getByText("In a row").parentElement as HTMLElement;
    expect(run.textContent).toContain("5");
    expect(run.textContent).not.toContain("/3");
    expect(run.textContent).toContain("solid — it now comes back less often");
    expect(screen.getByText(/Solid — 5 checks in a row/)).toBeInTheDocument();
  });
});
