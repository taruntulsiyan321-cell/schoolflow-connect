/**
 * The client's side of a mock test: what it reads, and how it names a refusal.
 *
 * Every assertion here is about NOT having a second home for a server rule.
 * The paper's shape, the marks and the wording of a refusal come from the
 * server; the tests feed values that are deliberately NOT the ruled ones (a
 * 40-question paper at +4/−2) so that anything hard-coded to 50 / +5 / −1
 * fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const {
  MockError, PALETTE_WORDS, fetchMockCatalog, fetchMockHistory, formatCountdown, marksSentence,
  notEnoughYet, paletteState, remainingMs, saveMockAnswer, startMock, submitMock,
} = await import("./mockTest");
const { PlanLimitError } = await import("./premium");

beforeEach(() => {
  rpc.mockReset();
});

/** A PostgREST failure, shaped as the client receives one. */
const failure = (message: string, details?: string, hint?: string) => ({
  data: null,
  error: { message, details: details ?? null, hint: hint ?? null, code: "P0001" },
});
const success = (data: unknown) => ({ data, error: null });

describe("the clock", () => {
  it("counts down to the server's deadline and never past zero", () => {
    const now = Date.parse("2026-09-27T10:00:00Z");
    expect(remainingMs("2026-09-27T10:01:30Z", now)).toBe(90_000);
    expect(remainingMs("2026-09-27T09:59:00Z", now)).toBe(0);
    // A deadline that cannot be read is out of time, not infinite time.
    expect(remainingMs("not a date", now)).toBe(0);
  });

  it("is always two digits, so it does not change width as it runs", () => {
    expect(formatCountdown(59_000)).toBe("00:59");
    expect(formatCountdown(9 * 60_000 + 5_000)).toBe("09:05");
    expect(formatCountdown(60 * 60_000)).toBe("1:00:00");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});

describe("the palette", () => {
  const q = (over: Partial<{ choice: number | null; marked: boolean; available: boolean }> = {}) => ({
    choice: null as number | null, marked: false, available: true, ...over,
  });

  it("tells answered, marked, both, neither and withdrawn apart", () => {
    expect(paletteState(q())).toBe("unanswered");
    expect(paletteState(q({ choice: 0 }))).toBe("answered");
    expect(paletteState(q({ marked: true }))).toBe("marked");
    expect(paletteState(q({ choice: 2, marked: true }))).toBe("answered_marked");
    expect(paletteState(q({ choice: 2, available: false }))).toBe("unavailable");
  });

  it("counts option 0 as answered — a falsy index is still a choice", () => {
    expect(paletteState(q({ choice: 0 }))).toBe("answered");
    expect(PALETTE_WORDS[paletteState(q({ choice: 0 }))]).toBe("answered");
  });

  it("says every state out loud", () => {
    for (const state of ["answered", "marked", "answered_marked", "unanswered", "unavailable"] as const) {
      expect(PALETTE_WORDS[state]).toMatch(/[a-z]/);
    }
  });
});

describe("what the screen says, from what the server said", () => {
  it("names the marks the server marks at, not the ones in the ruling", () => {
    expect(marksSentence({ marks_correct: 4, marks_wrong: -2 }))
      .toBe("+4 for a right answer, −2 for a wrong one, 0 if you leave it.");
    // And the ruled paper, for the sentence a student actually sees.
    expect(marksSentence({ marks_correct: 5, marks_wrong: -1 }))
      .toBe("+5 for a right answer, −1 for a wrong one, 0 if you leave it.");
  });

  it("says how short a subject is, with both counts", () => {
    const paper = { questions: 40, minutes: 30, marks_correct: 4, marks_wrong: -2, min_chapters: 5, max_per_chapter: 8, max_score: 160 };
    expect(notEnoughYet({ subject: "Accountancy", questions: 22, chapters: 3, ready: false }, paper))
      .toBe("22 of 40 questions ready, from 3 chapters.");
    // One chapter is not "1 chapters".
    expect(notEnoughYet({ subject: "Law", questions: 8, chapters: 1, ready: false }, paper))
      .toBe("8 of 40 questions ready, from 1 chapter.");
  });
});

describe("a refusal keeps the server's words", () => {
  it("carries the DETAIL the SQL sent, and which refusal it was", async () => {
    rpc.mockResolvedValue(failure("mock_time_is_up", "The hour is over. Submit to see the result."));
    const e = await submitMock("a").catch((x) => x);
    expect(e).toBeInstanceOf(MockError);
    expect(e.refusal).toBe("mock_time_is_up");
    expect(e.message).toBe("The hour is over. Submit to see the result.");
  });

  it("has its own sentence only when the server sent none", async () => {
    rpc.mockResolvedValue(failure("mock_attempt_not_found"));
    const e = await submitMock("a").catch((x) => x);
    expect(e).toBeInstanceOf(MockError);
    expect(e.message).toBe("That paper could not be found.");
  });

  it("is a plan refusal when the plan is what refused", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "plan_limit:mock_test.start",
        details: JSON.stringify({
          ok: false, feature: "mock_test.start", reason: "limit_reached",
          period: "lifetime", limit: 1, used: 1, remaining: 0,
        }),
        hint: "limit_reached",
      },
    });
    const e = await startMock("Mathematics").catch((x) => x);
    expect(e).toBeInstanceOf(PlanLimitError);
    expect(e.planLimit.reason).toBe("limit_reached");
    expect(e.planLimit.message).toBe("You've used your 1 mock test.");
  });

  it("is an ordinary failure when it is not one of ours", async () => {
    rpc.mockResolvedValue(failure("could not connect to server"));
    const e = await submitMock("a").catch((x) => x);
    expect(e).not.toBeInstanceOf(MockError);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("could not connect to server");
  });
});

describe("saving an answer", () => {
  it("sends the choice, the flag and the time spent", async () => {
    rpc.mockResolvedValue(success({ saved: true, deadline: "2026-09-27T11:00:00Z" }));
    await saveMockAnswer({ attempt: "att", question: "q", choice: 2, marked: true, timeMs: 4321.7 });
    expect(rpc).toHaveBeenCalledWith("rpc_mock_save_answer", {
      _attempt: "att", _question: "q", _choice: 2, _marked: true, _time_ms: 4322,
    });
  });

  it("clears an answer by leaving _choice out, because its SQL default is NULL", async () => {
    rpc.mockResolvedValue(success({ saved: true, deadline: "x" }));
    await saveMockAnswer({ attempt: "att", question: "q", choice: null });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect("_choice" in args).toBe(false);
    // CONTROL: option 0 is a choice and must still be sent.
    rpc.mockClear();
    await saveMockAnswer({ attempt: "att", question: "q", choice: 0 });
    expect((rpc.mock.calls[0][1] as Record<string, unknown>)._choice).toBe(0);
  });
});

describe("reads", () => {
  it("asks the catalog with no arguments at all", async () => {
    rpc.mockResolvedValue(success({ individual: false, paper: {} }));
    await fetchMockCatalog();
    expect(rpc).toHaveBeenCalledWith("rpc_mock_catalog");
  });

  it("treats a history that is not a list as no papers", async () => {
    rpc.mockResolvedValue(success(null));
    expect(await fetchMockHistory()).toEqual([]);
  });
});
