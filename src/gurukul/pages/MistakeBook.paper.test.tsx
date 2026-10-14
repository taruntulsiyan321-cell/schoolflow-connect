/**
 * A previous-year question's mistake names the paper it was set in, as the
 * question does in practice. The book reads it from the student's own view of
 * the bank, with the difficulty it already reads there.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const base = {
  options: ["Alpha", "Beta", "Gamma", "Delta"], correct_answer: { index: 1 }, subject: "accountancy",
  chapter: "Partnership", concept: "Goodwill", topic: "Goodwill", source: "practice", assessment_type: null,
  last_wrong_at: "2026-10-01T10:00:00Z", explanation: null, status: "open", chapter_id: "c-1",
  student_answer: { index: 0 }, times_wrong: 1, lucky_guesses: 0,
};
const mistakes = [
  { ...base, id: "m-pyq", question_text: "Asked in 2023", question_id: "q-pyq" },
  { ...base, id: "m-bank", question_text: "From the ebook", question_id: "q-bank" },
];
const bank = [
  { id: "q-pyq", difficulty: "medium", is_active: true, source: "CUET (UG) 2023 · 30 May · Shift 3", exam_year: 2023 },
  { id: "q-bank", difficulty: "easy", is_active: true, source: "PW CUET ebook · Accountancy", exam_year: null },
];
const selected = vi.hoisted(() => ({ bank: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => ({
    data: table === "student_mistakes" ? mistakes : table === "question_bank_student" ? bank : [],
    error: null,
  });
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    c.select = (...a: unknown[]) => { if (table === "question_bank_student") selected.bank.push(a[0]); return c; };
    for (const m of ["eq", "in", "order"]) c[m] = () => c;
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
  const value = { tags: [], marks: new Map(), setMark: () => {} };
  return { useQuestionMarks: () => value };
});

import MistakeBook from "./MistakeBook";

const card = (question: string) => screen.getByText(question).closest("div.p-4") as HTMLElement;

describe("a previous-year question in the Mistake Book", () => {
  it("names its paper, read with the question's difficulty from the bank", async () => {
    render(<MemoryRouter><MistakeBook /></MemoryRouter>);
    await screen.findByText("Asked in 2023");
    expect(selected.bank).toContain("id, difficulty, is_active, source, exam_year");
    expect(within(card("Asked in 2023")).getByTestId("question-paper")).toHaveTextContent("PYQ·CUET (UG) 2023 · 30 May · Shift 3");
    // CONTROL: a bank question with no exam year names no paper, whatever its source.
    expect(within(card("From the ebook")).queryByTestId("question-paper")).toBeNull();
  });
});
