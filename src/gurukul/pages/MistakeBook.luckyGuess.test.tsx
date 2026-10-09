/**
 * A right answer marked as a guess goes to the Mistake Book (C2,
 * 20261152000000). The book says what it is — right, by a guess — and never
 * shows the right answer under a red "Your Answer" as if it were wrong.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const base = {
  options: ["Alpha", "Beta", "Gamma", "Delta"], correct_answer: { index: 1 }, subject: "accountancy",
  chapter: "Partnership", concept: "Goodwill", topic: "Goodwill", source: "practice", assessment_type: null,
  last_wrong_at: "2026-10-01T10:00:00Z", explanation: null, status: "open", chapter_id: "c-1",
};
const rows = [
  // Here only for a lucky guess: no wrong answer, and the answer given was the right one.
  { ...base, id: "m-lucky", question_text: "Guessed right once", question_id: "q-1", student_answer: { index: 1 }, times_wrong: 0, lucky_guesses: 1 },
  { ...base, id: "m-lucky-twice", question_text: "Guessed right twice", question_id: "q-2", student_answer: { index: 1 }, times_wrong: 0, lucky_guesses: 2 },
  // Wrong, and never guessed.
  { ...base, id: "m-wrong", question_text: "Answered wrong", question_id: "q-3", student_answer: { index: 0 }, times_wrong: 1, lucky_guesses: 0 },
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
  const value = { tags: [], marks: new Map(), setMark: () => {} };
  return { useQuestionMarks: () => value };
});

import MistakeBook from "./MistakeBook";

const card = (question: string) => screen.getByText(question).closest("div.p-4") as HTMLElement;
const details = (question: string) => fireEvent.click(within(card(question)).getByRole("button", { name: /Details/ }));

describe("a lucky guess in the Mistake Book", () => {
  it("is marked as right by a guess, counted, and only on the rows that are", async () => {
    render(<MemoryRouter><MistakeBook /></MemoryRouter>);
    await screen.findByText("Guessed right once");
    expect(within(card("Guessed right once")).getByTestId("mistake-lucky-guess")).toHaveTextContent("Right by a guess");
    expect(within(card("Guessed right twice")).getByTestId("mistake-lucky-guess")).toHaveTextContent("Right by a guess ×2");
    // CONTROL: the wrong answer carries no such badge.
    expect(within(card("Answered wrong")).queryByTestId("mistake-lucky-guess")).toBeNull();
  });

  it("shows the answer given as right by a guess, not as a wrong answer", async () => {
    render(<MemoryRouter><MistakeBook /></MemoryRouter>);
    await screen.findByText("Guessed right once");
    details("Guessed right once");
    const guessed = within(card("Guessed right once")).getByTestId("mistake-answer-guessed");
    expect(guessed).toHaveTextContent("Your Answer — right, by a guess");
    expect(guessed).toHaveTextContent("Beta");
    // CONTROL: a wrong answer is still shown as one.
    details("Answered wrong");
    const wrong = card("Answered wrong");
    expect(within(wrong).queryByTestId("mistake-answer-guessed")).toBeNull();
    expect(within(wrong).getByText("Your Answer")).toBeInTheDocument();
    expect(within(wrong).getByText("Alpha")).toBeInTheDocument();
  });
});
