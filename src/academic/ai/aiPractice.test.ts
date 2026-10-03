import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUESTIONS,
  MAX_DRAFTS,
  MAX_QUESTIONS,
  readModelJson,
  repairStrings,
  readRequestReply,
  readSolveReply,
  readSolveText,
  readTopicDraft,
  readWrittenQuestion,
  relevantFromBank,
  writePlan,
  writeUserPrompt,
} from "../../../supabase/functions/_shared/aiPractice.ts";
import type { SyllabusChapter } from "../../../supabase/functions/_shared/syllabusTag.ts";

/**
 * AI Practice's pure half (owner's ruling 2026-10-02): what a request is read
 * as, which written questions are kept, and what the independent check says.
 * The written-question checks are the faults measured in the 41 AI questions
 * already in the bank: options repeated in the question, chapter labels left
 * in it, explanations addressed to "the student", one-line explanations.
 */
const SYLLABUS: SyllabusChapter[] = [
  { code: "C1", chapter_id: "ch-1", chapter: "Accounting for Partnership", subject: "Accountancy",
    topics: [{ id: "t-deed", name: "Partnership Deed" }, { id: "t-int", name: "Interest on Capital" }] },
  { code: "C2", chapter_id: "ch-2", chapter: "Production and Costs", subject: "Economics", topics: [] },
];
const TOPICS = SYLLABUS[0].topics;

const good = {
  topic: "T2",
  difficulty: "medium",
  question: "A and B are partners with capitals of ₹2,00,000 and ₹1,00,000. Interest on capital is allowed at 10% p.a. What is A's interest on capital for the year?",
  options: ["₹10,000", "₹20,000", "₹30,000", "₹2,000"],
  answer: "B",
  working: "Interest on capital is calculated on each partner's own capital at the agreed rate for the period. A's capital is ₹2,00,000 and the rate is 10% per annum for a full year, so A's interest is ₹2,00,000 × 10/100 = ₹20,000.",
  wrong: [
    { option: "A", reason: "₹10,000 is B's interest, worked out on B's capital of ₹1,00,000, not A's." },
    { option: "C", reason: "₹30,000 is interest on the firm's total capital of ₹3,00,000, not on A's share of it." },
    { option: "D", reason: "₹2,000 takes the rate as 1% instead of 10%, a slip in placing the decimal." },
  ],
};

describe("reading the request", () => {
  it("names a chapter and topic by their codes, and keeps the count and difficulty said", () => {
    const r = readRequestReply({ kind: "practice", chapter: "c1", topic: "T2", focus: "interest on capital sums", count: 20, difficulty: "Hard" }, SYLLABUS);
    expect(r).toEqual({ kind: "practice", chapter: SYLLABUS[0], topicId: "t-int", focus: "interest on capital sums", count: 20, difficulty: "hard", form: null });
  });

  it(`holds a count to 1–${MAX_QUESTIONS}, and asks ${DEFAULT_QUESTIONS} when none is said`, () => {
    const at = (count: unknown) => readRequestReply({ kind: "practice", chapter: "C1", count }, SYLLABUS);
    expect([at(100), at(0), at(null), at(7.4)].map((r) => (r.kind === "practice" ? r.count : null)))
      .toEqual([MAX_QUESTIONS, DEFAULT_QUESTIONS, DEFAULT_QUESTIONS, 7]);
  });

  it("a topic code from another chapter, or none, means the whole chapter", () => {
    const r = readRequestReply({ kind: "practice", chapter: "C1", topic: "T9" }, SYLLABUS);
    expect(r.kind === "practice" && r.topicId).toBeNull();
  });

  it("a refusal names chapters, never the codes the reader was given", () => {
    expect(readRequestReply({ kind: "refuse", reason: "Goodwill is covered in C1 and C2, so please choose one." }, SYLLABUS))
      .toEqual({ kind: "refuse", message: "Goodwill is covered in “Accounting for Partnership” and “Production and Costs”, so please choose one." });
  });

  it("refuses what is not a chapter of the syllabus, in a sentence for the student", () => {
    expect(readRequestReply({ kind: "practice", chapter: "C9" }, SYLLABUS).kind).toBe("refuse");
    expect(readRequestReply({ kind: "refuse", reason: "Physics isn't one of your subjects." }, SYLLABUS))
      .toEqual({ kind: "refuse", message: "Physics isn't one of your subjects." });
    expect(readRequestReply(null, SYLLABUS).kind).toBe("refuse");
  });
});

describe("a written question is kept only when it is clean", () => {
  it("a good one is kept, tagged to its topic, with the ruled explanation", () => {
    const r = readWrittenQuestion(good, TOPICS, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.question.topicId).toBe("t-int");
    expect(r.question.correctIndex).toBe(1);
    expect(r.question.explanation.startsWith("Answer: (B) ₹20,000\n\n")).toBe(true);
    expect(r.question.explanation).toContain("\n\nWhy the other options are wrong:\n(A) ");
  });

  it("the student's chosen topic wins over the model's", () => {
    const r = readWrittenQuestion(good, TOPICS, "t-deed");
    expect(r.ok && r.question.topicId).toBe("t-deed");
  });

  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    ["options repeated in the question", { question: good.question + " (a) ₹10,000 (b) ₹20,000 (c) ₹30,000 (d) ₹2,000" }, /repeated/],
    ["a chapter label left in it", { question: good.question + " [Accounting for Partnership]" }, /label/],
    ["a question about 'the student'", { question: "The student missed the rule — what is A's interest on a capital of ₹2,00,000 at 10%?" }, /student/],
    ["an explanation addressed to the student", { working: good.working + " The student confused the two capitals." }, /student/],
    ["three options", { options: good.options.slice(0, 3) }, /4 options/],
    ["the same option twice", { options: ["₹10,000", "₹20,000", "₹20,000", "₹2,000"] }, /repeat/],
    ["no answer", { answer: "E" }, /answer/],
    ["a topic of another chapter", { topic: "T7" }, /topic/],
    ["a one-line working", { working: "It is 10% of A's capital." }, /working/],
    ["a wrong option with no reason", { wrong: good.wrong.slice(0, 2) }, /option D/],
  ];
  for (const [what, change, why] of bad) {
    it(`refused: ${what}`, () => {
      const r = readWrittenQuestion({ ...good, ...change }, TOPICS, null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(why);
    });
  }
});

describe("the independent check", () => {
  it("reads each answer by its question number, and 'none' as no answer", () => {
    expect(readSolveReply({ answers: [{ n: 2, answer: "C" }, { n: 1, answer: "a" }, { n: 3, answer: "none" }] }, 3)).toEqual([0, 2, null]);
  });

  it("a reply that is not the shape asked for keeps nothing", () => {
    expect(readSolveReply("B", 2)).toEqual([null, null]);
    expect(readSolveReply({ answers: [{ n: 9, answer: "A" }] }, 2)).toEqual([null, null]);
  });
});

describe("reading a reply the way models actually write it", () => {
  it("maths with backslashes is not a broken reply (measured: most early 'disputes')", () => {
    // \cdot and \% are not JSON escapes (\f and \t would be, by accident).
    const raw = '{"answers":[{"n":1,"working":"Interest = 2,00,000 \\cdot 10\\% = 20,000","answer":"B"}]}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(readSolveText(raw, 1)).toEqual([1]);
    expect(readModelJson<{ answers: unknown[] }>(raw).answers).toHaveLength(1);
  });

  it("when the JSON is broken past repair, the answer letters are still read in order", () => {
    const raw = '{"answers":[{"n":1,"working":"…unterminated, "answer":"C"},{"n":2,"answer":"none"},{"n":3,"answer":"a"}';
    expect(readSolveText(raw, 3)).toEqual([2, null, 0]);
  });

  it("a reply cut off before any answer reads as no answer, not as a guess", () => {
    expect(readSolveText('{"answers":[{"n":1,"working":"Step 1: the capital is', 1)).toEqual([null]);
  });
});

describe("the bank first", () => {
  it("takes the bank's questions near what was asked — within the band of the nearest", () => {
    const c = [{ id: "a", similarity: 0.61 }, { id: "b", similarity: 0.55 }, { id: "c", similarity: 0.47 }, { id: "d", similarity: 0.3 }];
    expect(relevantFromBank(c, 10).map((x) => x.id)).toEqual(["a", "b"]);
    expect(relevantFromBank(c, 1).map((x) => x.id)).toEqual(["a"]);
  });

  it("with nothing to rank by, takes them in the order the bank gave", () => {
    const c = [{ id: "a", similarity: null }, { id: "b", similarity: null }];
    expect(relevantFromBank(c, 1).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("a chapter's drafted topic list", () => {
  it("is tidied: numbering gone, repeats gone, 3 to 12 kept", () => {
    expect(readTopicDraft({ topics: ["1. Production Function", "Short Run Costs", "short run costs", "Long Run Costs", "x"] }))
      .toEqual(["Production Function", "Short Run Costs", "Long Run Costs"]);
    expect(readTopicDraft({ topics: ["Only one"] })).toBeNull();
    expect(readTopicDraft({ topics: Array.from({ length: 20 }, (_, i) => `Topic number ${i + 1}`) })).toHaveLength(12);
  });
});

describe("a writer's reply that is not quite JSON", () => {
  it("is read when a quote or a line break was left inside a string", () => {
    const reply = '{"questions":[{"question":"Explain the "sacrificing" ratio","working":"Step one.\nStep two."}]}';
    expect(() => JSON.parse(reply)).toThrow();
    expect(readModelJson<{ questions: Array<{ question: string; working: string }> }>(reply).questions[0])
      .toEqual({ question: 'Explain the "sacrificing" ratio', working: "Step one.\nStep two." });
  });

  it("leaves real JSON exactly as it was", () => {
    const ok = '{"a":"He said \\"yes\\".","b":["x","y"],"c":{"d":"e"}}';
    expect(repairStrings(ok)).toBe(ok);
    expect(readModelJson(ok)).toEqual(JSON.parse(ok));
  });
});

describe("how the shortfall is written", () => {
  it("a form gets more room per question and smaller calls than a direct question", () => {
    const direct = writePlan("mcq", 5), match = writePlan("match", 5);
    expect(direct.batches).toEqual([5, 4]);
    expect(match.batches.every((n) => n <= 3)).toBe(true);
    // Five match questions at the room that cut them off on 2026-10-03 (5,400 tokens) now get far more.
    expect(match.maxTokens(3) / 3).toBeGreaterThan(direct.maxTokens(5) / 5 + 500);
  });

  it("writes more spare drafts for a form, and never more than the cap", () => {
    expect(writePlan("match", 5).batches.reduce((a, b) => a + b, 0)).toBe(14);
    expect(writePlan("mcq", 5).batches.reduce((a, b) => a + b, 0)).toBe(9);
    expect(writePlan(null, 30).batches.reduce((a, b) => a + b, 0)).toBe(MAX_DRAFTS);
  });
});

describe("what the writer is told", () => {
  it("names one topic when the student chose one, and lists what not to repeat", () => {
    const text = writeUserPrompt({
      subject: "Accountancy", chapter: "Accounting for Partnership", topics: TOPICS, topicId: "t-int",
      focus: "interest on capital", difficulty: "hard", form: null, count: 5, examples: [], avoid: ["An existing question?"],
    });
    expect(text).toContain("Every question is on topic T2.");
    expect(text).toContain("Write 5 questions, all hard.");
    expect(text).toContain("as the real exam mixes them");
    expect(text).toContain("- An existing question?");
  });
});
