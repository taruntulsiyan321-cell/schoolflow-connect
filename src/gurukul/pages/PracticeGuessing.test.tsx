import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ANSWERED_UNMARKED, MARKED_AS_GUESS } from "@/academic/metrics/answerConfidence";

/**
 * The "I'm guessing" tap (owner, 2026-10-03): set before the answer, because
 * tapping an option answers. Each answer sends what the tap was — a guess, or
 * not — as question_attempts.confidence; the next question starts unmarked.
 */

const recordAttempt = vi.fn();

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
      listBankQuestions: async () => [
        { id: "q1", question: "First?", options: ["One", "Two", "Three", "Four"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
        { id: "q2", question: "Second?", options: ["P", "Q", "R", "S"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
        { id: "q3", question: "Third?", options: ["W", "X", "Y", "Z"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
      ],
      start: async () => "sid-1",
      recordAttempt: (...a: unknown[]) => recordAttempt(...a),
    },
  };
});
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: async () => null,
}));

const { Session } = await import("@/gurukul/pages/Practice");

const CONFIG = { mode: "subject", label: "Subject Practice", subject: "Accountancy", difficulty: "mixed", qCount: 3, timeLimitSec: null } as const;
const sent = (n: number) => (recordAttempt.mock.calls[n]?.[1] as { confidence?: number | null; skipped?: boolean }) ?? {};
const guessTap = () => screen.getByRole("button", { name: "I'm guessing" });

describe("Practice — the \"I'm guessing\" tap", () => {
  beforeEach(() => {
    recordAttempt.mockReset();
    recordAttempt.mockResolvedValue({ attemptId: "a", isCorrect: false, skipped: false, correctIndex: 0, correctText: "", explanation: "" });
  });

  it("sends a guess when the tap is on, and starts the next question unmarked", async () => {
    render(
      <MemoryRouter>
        <Session config={CONFIG as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
      </MemoryRouter>,
    );
    await screen.findByText("First?");
    expect(guessTap()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(guessTap());
    expect(guessTap()).toHaveAttribute("aria-pressed", "true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^B\s*Two/ })); });
    expect(sent(0).confidence).toBe(MARKED_AS_GUESS);
    // After answering it stays on show, as it was recorded, and cannot be changed.
    expect(guessTap()).toBeDisabled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Next/ })); });
    await screen.findByText("Second?");
    expect(guessTap()).toHaveAttribute("aria-pressed", "false");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^A\s*P/ })); });
    expect(sent(1).confidence).toBe(ANSWERED_UNMARKED);
    // CONTROL: the two answers differ only by the tap.
    expect(sent(0).confidence).not.toBe(sent(1).confidence);
  });

  it("a skip records no guess either way", async () => {
    render(
      <MemoryRouter>
        <Session config={CONFIG as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
      </MemoryRouter>,
    );
    await screen.findByText("First?");
    fireEvent.click(guessTap());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Skip/ })); });
    expect(sent(0).skipped).toBe(true);
    expect(sent(0).confidence ?? null).toBeNull();
    // The next question starts unmarked.
    await screen.findByText("Second?");
    expect(guessTap()).toHaveAttribute("aria-pressed", "false");
  });
});
