/**
 * Only the student clears their mistake book (owner's ruling 2026-09-28).
 *
 * The book had no way to do it: a mistake left only when a retry or a
 * recovery round cleared it on the student's behalf. Each open mistake now
 * carries the student's own Clear, and pressing it is the only thing that
 * clears it. A mistake already cleared offers no Clear — the control that
 * shows the button is not simply drawn on every card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const markMistakesCleared = vi.fn();

const rows = [
  {
    id: "m-open", question_text: "Which way does light bend entering glass?", options: ["Away", "Towards the normal"],
    correct_answer: { correct_index: 1 }, student_answer: { selected_index: 0 },
    subject: "Physics", chapter: "Ray Optics", concept: "Refraction", topic: "Refraction",
    source: "practice", assessment_type: null, last_wrong_at: "2026-09-27T10:00:00Z", times_wrong: 2,
    explanation: null, status: "open", question_id: "q-1", chapter_id: "c-1",
  },
  {
    id: "m-done", question_text: "What is the unit of power of a lens?", options: ["Dioptre", "Watt"],
    correct_answer: { correct_index: 0 }, student_answer: { selected_index: 1 },
    subject: "Physics", chapter: "Ray Optics", concept: "Lenses", topic: "Lenses",
    source: "practice", assessment_type: null, last_wrong_at: "2026-09-26T10:00:00Z", times_wrong: 1,
    explanation: null, status: "cleared", question_id: "q-2", chapter_id: "c-1",
  },
];

vi.mock("@/integrations/supabase/client", () => {
  const result = (table: string) => ({ data: table === "student_mistakes" ? rows : [], error: null });
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result(table)).then(res, rej);
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
      markMistakesCleared: (...a: unknown[]) => markMistakesCleared(...a),
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

import MistakeBook from "./MistakeBook";

const card = (question: string) =>
  screen.getByText(question).closest("div.p-4") as HTMLElement;

beforeEach(() => {
  markMistakesCleared.mockReset();
  markMistakesCleared.mockResolvedValue(undefined);
});

describe("Mistake Book — the student clears their own mistakes", () => {
  it("an open mistake offers Clear; a cleared one does not", async () => {
    render(<MemoryRouter><MistakeBook /></MemoryRouter>);
    await screen.findByText("Which way does light bend entering glass?");
    expect(within(card("Which way does light bend entering glass?")).getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(within(card("What is the unit of power of a lens?")).queryByRole("button", { name: "Clear" })).toBeNull();
    expect(markMistakesCleared).not.toHaveBeenCalled();
  });

  it("pressing Clear clears that one mistake, and the card then reads Resolved", async () => {
    render(<MemoryRouter><MistakeBook /></MemoryRouter>);
    await screen.findByText("Which way does light bend entering glass?");
    const open = card("Which way does light bend entering glass?");
    expect(within(open).queryByText("Resolved")).toBeNull();

    fireEvent.click(within(open).getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(markMistakesCleared).toHaveBeenCalledTimes(1));
    expect(markMistakesCleared).toHaveBeenCalledWith(expect.objectContaining({ userId: "u" }), ["m-open"]);
    await waitFor(() => expect(within(card("Which way does light bend entering glass?")).getByText("Resolved")).toBeInTheDocument());
    expect(within(card("Which way does light bend entering glass?")).queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
