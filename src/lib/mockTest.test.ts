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
  MockError, PALETTE_WORDS, fetchMockAnalysisContext, fetchMockCatalog, fetchMockHistory, formatCountdown, formsSentence,
  marksSentence, mockResultToAttemptRows, notEnoughYet, paletteState, prepareMock, remainingMs, saveMockAnswer,
  seenBeforeSentence, setExamOption, shortSentence, startMock, submitMock,
} = await import("./mockTest");
const { PlanLimitError } = await import("./premium");
const { ANSWERED_UNMARKED, MARKED_AS_GUESS } = await import("@/academic/metrics/answerConfidence");
type MockResultShape = import("./mockTest").MockResult;
type MockReviewQuestion = import("./mockTest").MockReviewQuestion;

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

  it("says how short a subject or chapter is, with both counts", () => {
    expect(notEnoughYet(22, { questions: 40 })).toBe("22 of 40 questions ready.");
    expect(notEnoughYet(0, { questions: 50 })).toBe("0 of 50 questions ready.");
  });

  it("says before the paper starts how many of its questions were met, and which come first (B4.3)", () => {
    expect(seenBeforeSentence({ seen_before: 0, troubled: 0 })).toBeNull();
    expect(seenBeforeSentence({ seen_before: 18, troubled: 18 }))
      .toBe("This paper includes 18 questions you've seen before — ones you got wrong, left or guessed.");
    expect(seenBeforeSentence({ seen_before: 1, troubled: 0 }))
      .toBe("This paper includes 1 question you've seen before — ones you got right longest ago.");
    expect(seenBeforeSentence({ seen_before: 18, troubled: 7 }))
      .toBe("This paper includes 18 questions you've seen before — first the 7 you got wrong, left or guessed, then ones you got right longest ago.");
  });

  it("names every chapter that came up short, once", () => {
    expect(shortSentence([])).toBeNull();
    expect(shortSentence([
      { chapter_id: "c1", chapter: "Computerised Accounting System", wanted: 13, got: 9 },
      { chapter_id: "c2", chapter: "Ratio Analysis", wanted: 5, got: 0 },
    ])).toBe("Computerised Accounting System gave 9 of its 13; Ratio Analysis gave 0 of its 5. The rest come from the other chapters.");
  });

  it("says when the paper has fewer non-direct questions than the blueprint sets, from the blueprint it was sent", () => {
    // Not the ruled blueprint: 7 non-direct wanted, 3 held.
    expect(formsSentence({ forms: { mcq: 37, match: 3 }, blueprint_forms: { mcq: 33, match: 4, sequence: 3 } }))
      .toBe("The real paper sets 7 statement, match, sequence and passage questions; this one has 3 — the bank does not hold more of them yet.");
    expect(formsSentence({ forms: { mcq: 33, match: 7 }, blueprint_forms: { mcq: 33, match: 4, sequence: 3 } })).toBeNull();
    // CONTROL: direct questions do not count toward the share.
    expect(formsSentence({ forms: { mcq: 40 }, blueprint_forms: { mcq: 40 } })).toBeNull();
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
    const e = await startMock("paper-1").catch((x) => x);
    expect(e).toBeInstanceOf(PlanLimitError);
    expect(e.planLimit.reason).toBe("limit_reached");
    expect(e.planLimit.message).toBe("You've used your 1 mock test.");
  });

  it("names the refusals a library of papers adds", async () => {
    rpc.mockResolvedValue(failure("mock_paper_already_sat"));
    const e = await startMock("paper-1").catch((x) => x);
    expect(e).toBeInstanceOf(MockError);
    expect(e.refusal).toBe("mock_paper_already_sat");
    rpc.mockResolvedValue(failure("mock_option_not_chosen", "Choose your Unit V first."));
    const f = await prepareMock("Accountancy").catch((x) => x);
    expect(f.refusal).toBe("mock_option_not_chosen");
    expect(f.message).toBe("Choose your Unit V first.");
  });

  it("is an ordinary failure when it is not one of ours", async () => {
    rpc.mockResolvedValue(failure("could not connect to server"));
    const e = await submitMock("a").catch((x) => x);
    expect(e).not.toBeInstanceOf(MockError);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("could not connect to server");
  });
});

describe("preparing and starting a paper", () => {
  it("prepares a whole-subject paper by leaving _chapter out, and a chapter paper by naming it", async () => {
    rpc.mockResolvedValue(success({ paper_id: "p" }));
    await prepareMock("Accountancy");
    expect(rpc).toHaveBeenLastCalledWith("rpc_mock_prepare", { _subject: "Accountancy" });
    await prepareMock("Accountancy", "ch-1");
    expect(rpc).toHaveBeenLastCalledWith("rpc_mock_prepare", { _subject: "Accountancy", _chapter: "ch-1" });
  });

  it("starts the paper it prepared, by its id", async () => {
    rpc.mockResolvedValue(success({ id: "att" }));
    await startMock("paper-1");
    expect(rpc).toHaveBeenCalledWith("rpc_mock_start", { _paper: "paper-1" });
  });

  it("saves a subject's once-only choice", async () => {
    rpc.mockResolvedValue(success({ label: "Analysis of Financial Statements" }));
    await setExamOption("Accountancy", "unit_v", "analysis");
    expect(rpc).toHaveBeenCalledWith("rpc_set_exam_option", { _subject: "Accountancy", _group: "unit_v", _option: "analysis" });
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

  it("sends the guess when it is said either way, and leaves it out when it is not", async () => {
    rpc.mockResolvedValue(success({ saved: true, deadline: "x" }));
    await saveMockAnswer({ attempt: "att", question: "q", choice: 1, guessed: true });
    expect((rpc.mock.calls[0][1] as Record<string, unknown>)._guessed).toBe(true);
    // CONTROL: false is "answered without the tap" — a value, not "not said".
    await saveMockAnswer({ attempt: "att", question: "q", choice: 1, guessed: false });
    expect((rpc.mock.calls[1][1] as Record<string, unknown>)._guessed).toBe(false);
    await saveMockAnswer({ attempt: "att", question: "q", choice: null, guessed: null });
    expect("_guessed" in (rpc.mock.calls[2][1] as Record<string, unknown>)).toBe(false);
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

  it("asks the analysis context of the attempt", async () => {
    rpc.mockResolvedValue(success({ paper: {} }));
    await fetchMockAnalysisContext("att");
    expect(rpc).toHaveBeenCalledWith("rpc_mock_analysis_context", { _attempt: "att" });
  });
});

describe("a marked paper, read as a session is (B5)", () => {
  const question = (over: Partial<MockReviewQuestion>): MockReviewQuestion => ({
    order: 1, id: "q1", available: true, question: "What is 2 + 2?", options: ["3", "4", "5", "6"], format: "mcq",
    chapter: "Ratio Analysis", topic: "Liquidity ratios", difficulty: "medium", explanation: "Add them.",
    correct: { index: 1, text: "4" }, choice: 1, is_correct: true, guessed: false, marks: 5, time_ms: 40_000, ...over,
  });
  const result = (questions: MockReviewQuestion[]): MockResultShape => ({
    id: "att", paper_id: "p", subject: "Accountancy", chapter_id: null, chapter: null,
    started_at: "2026-10-09T10:00:00Z", submitted_at: "2026-10-09T10:50:00Z", auto_submitted: false, seconds_taken: 3000,
    total: questions.length, seen_before: 0, correct: 0, wrong: 0, unanswered: 0, voided: 0, score: 0, max_score: 0,
    marks_correct: 5, marks_wrong: -1, questions,
  });

  it("carries the answer, the key, the time, the chapter and the topic of each question", () => {
    const [row] = mockResultToAttemptRows(result([question({})]));
    expect(row).toMatchObject({
      bank_question_id: "q1",
      subject: "Accountancy",
      chapter: "Ratio Analysis",
      difficulty: "medium",
      correct_answer: { index: 1, text: "4" },
      selected_answer: { index: 1, text: "4" },
      is_correct: true,
      skipped: false,
      excluded_from_accuracy: false,
      time_taken_ms: 40_000,
      created_at: "2026-10-09T10:50:00Z",
    });
    expect(row.generated_question).toMatchObject({
      question: "What is 2 + 2?", options: ["3", "4", "5", "6"], topic: "Liquidity ratios", bank_question_id: "q1",
    });
  });

  it("reads the guess tap as practice records it", () => {
    const rows = mockResultToAttemptRows(result([
      question({ id: "a", guessed: true }),
      question({ id: "b", guessed: false }),
      question({ id: "c", guessed: null }),
    ]));
    expect(rows.map((r) => r.confidence)).toEqual([MARKED_AS_GUESS, ANSWERED_UNMARKED, null]);
    // CONTROL: the two values differ, so a swap would fail above.
    expect(MARKED_AS_GUESS).not.toBe(ANSWERED_UNMARKED);
  });

  it("reads a blank as a skip, and a withdrawn answer as left out of accuracy rather than wrong", () => {
    const [blank, withdrawn] = mockResultToAttemptRows(result([
      question({ id: "a", choice: null, is_correct: null, guessed: null }),
      question({ id: "b", choice: 2, is_correct: null, available: false, question: null, correct: null }),
    ]));
    expect(blank).toMatchObject({ skipped: true, selected_answer: null, excluded_from_accuracy: false });
    expect(withdrawn).toMatchObject({ skipped: false, excluded_from_accuracy: true, correct_answer: {} });
  });
});
