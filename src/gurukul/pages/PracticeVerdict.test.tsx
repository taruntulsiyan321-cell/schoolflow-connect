import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * An answer the server has not marked yet is not a wrong answer.
 *
 * Measured 2026-09-24 as a CUET student: the first answer of a session was
 * right (question_attempts.is_correct true, selected 0 = correct 0), and the
 * screen showed it WRONG — red, with a cross, "0/1 correct" — because the
 * verdict took longer than the student looked at it, and the runner drew
 * "no verdict yet" the same as "wrong". The verdict is held open here so both
 * moments can be asserted.
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
        { id: "q1", question: "Which is right?", options: ["Right", "Wrong", "Also wrong", "No"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
        { id: "q2", question: "Second?", options: ["P", "Q", "R", "S"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
      ],
      start: async () => "sid-1",
      recordAttempt: (...a: unknown[]) => recordAttempt(...a),
    },
  };
});

const { Session } = await import("@/gurukul/pages/Practice");

const CONFIG = { mode: "subject", label: "Subject Practice", subject: "Accountancy", difficulty: "mixed", qCount: 2, timeLimitSec: null } as const;

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function answerFirst(label: string) {
  render(
    <MemoryRouter>
      <Session config={CONFIG as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^A\\s*${label}`) }));
}

const crossesShown = () => document.querySelectorAll("button svg.text-destructive").length;

describe("Practice — an answer still being checked is not marked wrong", () => {
  beforeEach(() => recordAttempt.mockReset());

  it("shows the choice as checking, counts nothing, then shows the server's verdict", async () => {
    const v = deferred<unknown>();
    recordAttempt.mockReturnValueOnce(v.promise);
    await answerFirst("Right");

    expect(screen.getByRole("status")).toHaveTextContent("Checking your answer");
    expect(screen.getByText("0/0 correct")).toBeInTheDocument();
    expect(crossesShown()).toBe(0);

    await act(async () => {
      v.resolve({ attemptId: "a1", isCorrect: true, skipped: false, correctIndex: 0, correctText: "Right", explanation: "Because." });
    });
    expect(screen.getByText("1/1 correct")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(crossesShown()).toBe(0);
    expect(screen.getByText("Because.")).toBeInTheDocument();
  });

  it("POSITIVE CONTROL: a wrong verdict is marked wrong once it lands", async () => {
    recordAttempt.mockResolvedValueOnce({ attemptId: "a1", isCorrect: false, skipped: false, correctIndex: 1, correctText: "Wrong", explanation: "" });
    await answerFirst("Right");
    await act(async () => {});
    expect(screen.getByText("0/1 correct")).toBeInTheDocument();
    expect(crossesShown()).toBe(1);
  });

  it("says it could not check, rather than wrong, when the answer could not be recorded", async () => {
    recordAttempt.mockRejectedValueOnce(new Error("network"));
    await answerFirst("Right");
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't check this answer right now");
    expect(screen.getByText("0/0 correct")).toBeInTheDocument();
    expect(crossesShown()).toBe(0);
  });
});
