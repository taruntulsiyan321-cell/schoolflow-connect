/**
 * Only the student clears their mistake book (owner's ruling 2026-09-28).
 *
 * A Mistake Book retry used to clear every mistake answered right whenever the
 * retry scored 70% or more — the book emptied itself without being asked. A
 * retry is evidence now, never a decision: it is recorded as a practice
 * session and clears nothing, however well it went.
 *
 * The positive control is the perfect retry: every answer right, 100%. That is
 * exactly the case the old code cleared, so if clearing came back this fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

import { PracticeService } from "./practiceService";

const ctx = { schoolId: "s", userId: "u", studentId: "st", role: "student" } as never;

const attempt = (mistakeId: string, selectedIndex: number) => ({
  mistakeId,
  bankQuestionId: `q-${mistakeId}`,
  subject: "Physics",
  chapter: "Optics",
  questionText: `Question ${mistakeId}`,
  options: ["a", "b", "c", "d"],
  selectedIndex,
  correctIndex: 1,
});

describe("a Mistake Book retry clears nothing", () => {
  let cleared: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(PracticeService, "start").mockResolvedValue("session-1" as never);
    vi.spyOn(PracticeService, "recordAttempt").mockResolvedValue(undefined as never);
    vi.spyOn(PracticeService, "finish").mockResolvedValue(undefined as never);
    cleared = vi.spyOn(PracticeService, "markMistakesCleared").mockResolvedValue(undefined);
  });

  it("a perfect retry is recorded, scored 100, and leaves every mistake in the book", async () => {
    const result = await PracticeService.completeMistakeRetry(ctx, [attempt("m1", 1), attempt("m2", 1)]);
    expect(result).toEqual({ score: 100, sessionId: "session-1", persisted: true });
    expect(PracticeService.finish).toHaveBeenCalledTimes(1);
    expect(cleared).not.toHaveBeenCalled();
  });

  it("a mixed retry clears nothing either", async () => {
    const result = await PracticeService.completeMistakeRetry(ctx, [attempt("m1", 1), attempt("m2", 0)]);
    expect(result.score).toBe(50);
    expect(cleared).not.toHaveBeenCalled();
  });
});
