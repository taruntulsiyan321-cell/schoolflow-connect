/**
 * A question the student forgot to mark after the session can be marked —
 * and re-marked, or unmarked — from the Mistake Book (owner's ruling
 * 2026-10-02). Each card's Mark is for that card's own question; a school
 * test's mistake names a test question, not a bank one, and has none.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rows = [
  {
    id: "m-bank", question_text: "What is the formula for goodwill?", options: ["A", "B"],
    correct_answer: { index: 1 }, student_answer: { index: 0 }, subject: "accountancy", chapter: "Partnership",
    concept: "Goodwill", topic: "Goodwill", source: "practice", assessment_type: null, last_wrong_at: "2026-10-01T10:00:00Z",
    times_wrong: 1, explanation: null, status: "open", question_id: "q-bank", chapter_id: "c-1",
  },
  {
    id: "m-upload", question_text: "From my own notes", options: ["A", "B"],
    correct_answer: { index: 1 }, student_answer: { index: 0 }, subject: "economics", chapter: "Money",
    concept: "Money supply", topic: "Money supply", source: "upload", assessment_type: null, last_wrong_at: "2026-09-30T10:00:00Z",
    times_wrong: 1, explanation: null, status: "open", question_id: null, upload_question_id: "uq-1", chapter_id: "c-2",
  },
  {
    id: "m-test", question_text: "A school test question", options: ["A", "B"],
    correct_answer: { index: 1 }, student_answer: { index: 0 }, subject: "economics", chapter: "Money",
    concept: "Money supply", topic: "Money supply", source: "test", assessment_type: null, last_wrong_at: "2026-09-29T10:00:00Z",
    times_wrong: 1, explanation: null, status: "open", question_id: "tq-1", chapter_id: "c-2",
  },
];

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => ({ data: table === "student_mistakes" ? rows : [], error: null });
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result(table)).then(res, rej);
    return c;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "u" } };
  return { useAuth: () => value };
});
vi.mock("@/academic", () => {
  const ctx = { schoolId: "s", userId: "u", studentId: "st", role: "student" };
  const value = { ctx, ready: true };
  return {
    useAcademicContext: () => value,
    useAcademicLive: () => 0,
    PracticeService: {
      resolveCurriculumScope: () => Promise.resolve({ stream: null, classLevel: 12, examId: "exam" }),
      markMistakesCleared: vi.fn(),
      completeMistakeRetry: vi.fn(),
    },
    StudentUploadService: {},
  };
});
vi.mock("@/academic/services/screenCaptureService", () => ({ deleteScreenCaptureQuestion: vi.fn() }));
vi.mock("@/gurukul/StudentContext", () => {
  const value = { schoolKind: "individual" };
  return { useGurukulAcademicIdentity: () => value };
});
vi.mock("@/components/student/questionMarks/useQuestionMarks", () => {
  const value = { tags: [], marks: new Map([["uq-1", { tags: ["recall"] }]]), setMark: () => {} };
  return { useQuestionMarks: () => value };
});
vi.mock("@/components/student/questionMarks/QuestionMarkBar", () => ({
  QuestionMarkBar: (p: { questionRef: { kind: string; id: string }; question: { subject: string | null }; mark: unknown }) => (
    <div data-testid="mark-bar" data-ref={`${p.questionRef.kind}:${p.questionRef.id}`} data-marked={p.mark ? "yes" : "no"} />
  ),
}));

import MistakeBook from "./MistakeBook";

const card = (question: string) => screen.getByText(question).closest("div.p-4") as HTMLElement;
const barOf = (question: string) => within(card(question)).queryByTestId("mark-bar");

describe("marking from the Mistake Book", () => {
  it("each card marks its own question; a school test's has nothing to mark", async () => {
    render(<MemoryRouter><MistakeBook /></MemoryRouter>);
    await screen.findByText("What is the formula for goodwill?");
    expect(barOf("What is the formula for goodwill?")).toHaveAttribute("data-ref", "bank:q-bank");
    expect(barOf("What is the formula for goodwill?")).toHaveAttribute("data-marked", "no");
    expect(barOf("From my own notes")).toHaveAttribute("data-ref", "upload:uq-1");
    expect(barOf("From my own notes")).toHaveAttribute("data-marked", "yes");
    expect(barOf("A school test question")).toBeNull();
  });

  it("opens Mistake Types", async () => {
    render(
      <MemoryRouter initialEntries={["/student/mistakes"]}>
        <Routes>
          <Route path="/student/mistakes" element={<MistakeBook />} />
          <Route path="/student/mistakes/types" element={<div>Types screen</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("What is the formula for goodwill?");
    fireEvent.click(screen.getByRole("button", { name: /Mistake Types/ }));
    expect(await screen.findByText("Types screen")).toBeInTheDocument();
  });
});
