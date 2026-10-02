import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";

/**
 * After a session, every question can be marked — wrong, skipped, or right by
 * a guess — and each Mark is for THAT question, filed under its own subject.
 * Questions reach this screen three ways; a saved snapshot froze no ids, so
 * its questions have nothing to mark and show no button.
 */

const db = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  attempts: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "u1" } };
  return { useAuth: () => value };
});
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
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("@/components/student/questionMarks/useQuestionMarks", () => {
  const value = { tags: [], marks: new Map([["b1", { tags: ["formula_error"] }]]), setMark: () => {} };
  return { useQuestionMarks: () => value };
});
vi.mock("@/components/student/questionMarks/QuestionMarkBar", () => ({
  QuestionMarkBar: (p: { questionRef: { kind: string; id: string }; question: { subject: string | null }; mark: unknown }) => (
    <div
      data-testid="mark-bar"
      data-ref={`${p.questionRef.kind}:${p.questionRef.id}`}
      data-subject={p.question.subject ?? ""}
      data-marked={p.mark ? "yes" : "no"}
    />
  ),
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
const barOf = (question: string) => within(card(question)).queryByTestId("mark-bar");

beforeEach(() => {
  sessionStorage.clear();
  db.session = null;
  db.attempts = [];
});

describe("marking the questions of a session", () => {
  it("from this device's log: every question, each its own, under its own subject", async () => {
    show({
      subject: "",
      chapter: "",
      attempts: [
        { question: "Wrong bank question", options: ["A", "B"], correctIndex: 0, selectedIndex: 1, isCorrect: false, bankQuestionId: "b1", subject: "economics" },
        { question: "Right by a guess", options: ["A", "B"], correctIndex: 0, selectedIndex: 0, isCorrect: true, bankQuestionId: "b2", subject: "accountancy" },
        { question: "Skipped upload", options: ["A", "B"], correctIndex: 0, selectedIndex: -1, isCorrect: false, skipped: true, uploadQuestionId: "u9" },
      ],
    });
    await waitFor(() => expect(screen.getByText("Wrong bank question")).toBeInTheDocument());
    expect(barOf("Wrong bank question")).toHaveAttribute("data-ref", "bank:b1");
    expect(barOf("Wrong bank question")).toHaveAttribute("data-subject", "economics");
    expect(barOf("Wrong bank question")).toHaveAttribute("data-marked", "yes");
    expect(barOf("Right by a guess")).toHaveAttribute("data-ref", "bank:b2");
    expect(barOf("Right by a guess")).toHaveAttribute("data-subject", "accountancy");
    expect(barOf("Right by a guess")).toHaveAttribute("data-marked", "no");
    expect(barOf("Skipped upload")).toHaveAttribute("data-ref", "upload:u9");
  });

  it("from the database: the bank_question_id column and the row's subject", async () => {
    db.session = {
      id: "s1", subject: "economics", chapter: "", question_count: 1, correct_count: 0, wrong_count: 1,
      skipped_count: 0, accuracy: 0, total_time_ms: 10_000, finished_at: "2026-10-02T10:00:00Z",
      created_at: "2026-10-02T09:59:00Z", score: 0,
    };
    db.attempts = [
      { id: "a1", bank_question_id: "b7", subject: "economics", generated_question: { question: "From the database", options: ["A", "B"] },
        correct_answer: { index: 0 }, selected_answer: { index: 1 }, is_correct: false, skipped: false, time_taken_ms: 10_000,
        created_at: "2026-10-02T09:59:30Z" },
    ];
    show();
    await waitFor(() => expect(screen.getByText("From the database")).toBeInTheDocument());
    expect(barOf("From the database")).toHaveAttribute("data-ref", "bank:b7");
  });

  it("from a saved snapshot, which froze no ids: no button that could not save", async () => {
    db.session = {
      id: "s1", subject: "economics", chapter: "", question_count: 1, correct_count: 0, wrong_count: 1,
      skipped_count: 0, accuracy: 0, total_time_ms: 10_000, finished_at: "2026-10-02T10:00:00Z",
      created_at: "2026-10-02T09:59:00Z", score: 0,
      analysis_snapshot: {
        version: 5, subject: "economics", chapter: "", practiceMode: "chapter", difficulty: null, questionCount: 1,
        correctCount: 0, wrongCount: 1, skippedCount: 0, accuracy: 0, xpEarned: 0, totalTimeMs: 10_000,
        finishedAt: "2026-10-02T10:00:00Z", startedAt: null,
        attempts: [{ question: "Saved question", options: ["A", "B"], correctIndex: 0, selectedIndex: 1, isCorrect: false, skipped: false }],
        insights: { headline: "", bullets: [], recommendations: [] },
      },
    };
    show();
    await waitFor(() => expect(screen.getByText("Saved question")).toBeInTheDocument());
    expect(barOf("Saved question")).toBeNull();
  });

  it("links to the student's mistake types", async () => {
    show({ subject: "economics", chapter: "", attempts: [
      { question: "Any question", options: ["A", "B"], correctIndex: 0, selectedIndex: 1, isCorrect: false, bankQuestionId: "b1" },
    ] });
    await waitFor(() => expect(screen.getByText("Any question")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Your mistake types/ })).toHaveAttribute("href", "/student/mistakes/types");
  });
});
