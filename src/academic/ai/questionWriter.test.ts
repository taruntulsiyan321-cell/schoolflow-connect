import { describe, expect, it } from "vitest";
import type { Think } from "../../../supabase/functions/_shared/answerCheck.ts";
import { CRITERION_IDS } from "../../../supabase/functions/_shared/questionRubric.ts";
import {
  ensureTopics,
  GATE_CONCURRENCY,
  type GateRecord,
  type StoreItem,
  type StoreResult,
  type WriteRequest,
  writeForChapter,
  type WriterDb,
  type WriterDeps,
} from "../../../supabase/functions/_shared/questionWriter.ts";

/**
 * The chapter writer (TODO A2): AI Practice and chapter supply write through
 * it. What it must never do is offer the bank door a draft the quality gate
 * refused — and it must record every draft it gated. Every model call, vector
 * and database call here is a fake the test controls.
 */
const TOPICS = [{ id: "t-1", name: "Goodwill" }, { id: "t-2", name: "Sacrificing ratio" }];
const SCOPE = { syllabus: "Admission of a Partner: Accounting treatment for goodwill, Revaluation of assets.", asks: null };

/** A draft the writer would send. Its text decides what the fakes do with it: WEAK fails the review, WRONGKEY the solve, TWIN is in the bank, SAME is one meaning written twice. */
function draft(text: string) {
  return {
    topic: "T1",
    difficulty: "medium",
    form: "mcq",
    question: `${text}: which account is credited with the premium for goodwill brought in by a new partner?`,
    options: ["Capital accounts of the sacrificing partners", "Capital accounts of the gaining partners", "Revaluation account of the reconstituted firm", "Goodwill account of the reconstituted firm"],
    answer: "A",
    working: "The premium compensates the partners who give up a share of profit. It is credited to the capital accounts of the sacrificing partners in their sacrificing ratio, as the NCERT treatment requires.",
    wrong: [
      { option: "B", reason: "Gaining partners pay for goodwill; they are not compensated by it." },
      { option: "C", reason: "Revaluation records changes in assets and liabilities, not goodwill premium." },
      { option: "D", reason: "Goodwill is not raised in the books when the premium is brought in cash." },
    ],
  };
}

function fakes(opts: { batch: (call: number, n: number) => string[]; store?: (items: StoreItem[]) => StoreResult; topics?: Array<{ id: string; name: string }> }) {
  const stored: StoreItem[][] = [];
  const recorded: GateRecord[] = [];
  /** Every prompt the writer and the reviewer were given. */
  const writerPrompts: string[] = [];
  const reviewPrompts: string[] = [];
  let calls = 0;
  const topicRows = [...(opts.topics ?? TOPICS)];
  const db: WriterDb = {
    examples: async () => [],
    twinOf: async (v) => (v[0] === 99 ? "bank-twin" : null),
    store: async (items) => {
      stored.push(items);
      return opts.store ? opts.store(items) : { ok: true, inserted: items.map((_, index) => ({ index, id: `bank-${stored.length}-${index}` })), skipped: [] };
    },
    record: async (rows) => { recorded.push(...rows); },
    topicsOf: async () => topicRows,
    scopeOf: async () => SCOPE,
    addTopic: async (_c, name) => { topicRows.push({ id: `t-${name}`, name }); },
  };
  const think: Think = async (input) => {
    const q = input.user;
    if (input.system.includes("chief examiner")) {
      reviewPrompts.push(q);
      const weak = q.includes("WEAK");
      return { ok: true, finish_reason: "stop", text: JSON.stringify({
        marks: CRITERION_IDS.map((criterion) => ({ criterion, pass: !(weak && criterion === "distractors"), note: weak && criterion === "distractors" ? "Option D is plainly wrong." : "" })),
        difficulty: "medium",
      }) };
    }
    return { ok: true, finish_reason: "stop", text: JSON.stringify({ answers: [{ n: 1, working: "…", answer: q.includes("WRONGKEY") ? "C" : "A" }] }) };
  };
  const deps: WriterDeps = {
    complete: async (input) => {
      writerPrompts.push(input.user);
      const n = Number(input.user.match(/Write (\d+) question/)?.[1] ?? 0);
      return { ok: true, text: JSON.stringify({ questions: opts.batch(calls++, n).map(draft) }), finish_reason: "stop" };
    },
    think,
    // A vector per meaning: TWIN is the bank's, SAME twice is one meaning.
    embed: async (text) => {
      if (text.includes("TWIN")) return { ok: true, embedding: [99, 0, 0] };
      if (text.includes("SAME")) return { ok: true, embedding: [0, 7, 0] };
      const k = Number(text.match(/#(\d+)/)?.[1] ?? 0);
      const v = new Array(64).fill(0);
      v[k % 64] = 1;
      v[(k * 7 + 3) % 64] += 0.5;
      return { ok: true, embedding: v };
    },
    model: "qwen/qwen3.7-flash",
    db,
  };
  return { deps, stored, recorded, writerPrompts, reviewPrompts };
}

const request = (over: Partial<WriteRequest> = {}): WriteRequest => ({
  writer: "chapter_supply",
  source: "chapter_supply",
  ref: "run-1",
  examId: "exam-cuet",
  examLabel: "CUET (UG)",
  chapter: { chapter_id: "ch-1", chapter: "Admission of a New Partner", subject: "Accountancy" },
  topics: TOPICS,
  topicId: null,
  focus: "goodwill",
  difficulty: null,
  form: "mcq",
  shortfall: 5,
  stillNeeded: () => 5,
  avoid: [],
  onTwin: () => {},
  ...over,
});

describe("only what passed the gate reaches the bank door", () => {
  it("a refused draft is never offered to the store; every gated draft is recorded", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => (call === 0 && i === 0 ? "WEAK #1" : call === 0 && i === 1 ? "WRONGKEY #2" : `Fine #${call * 10 + i + 3}`)) });
    const r = await writeForChapter(f.deps, request());
    const offered = f.stored.flat().map((s) => s.question);
    expect(offered.some((q) => q.includes("WEAK") || q.includes("WRONGKEY"))).toBe(false);
    expect(offered.length).toBe(r.written.length);
    expect(f.stored.flat().every((s) => s.quality_review.passed && s.quality_review.marks.length === CRITERION_IDS.length)).toBe(true);

    const weak = f.recorded.find((x) => x.question.includes("WEAK"))!;
    const wrong = f.recorded.find((x) => x.question.includes("WRONGKEY"))!;
    expect(weak).toMatchObject({ stage: "review", failed: ["distractors"], question_id: null, writer: "chapter_supply", ref: "run-1" });
    expect(wrong).toMatchObject({ stage: "answer", question_id: null });
    expect(f.recorded.filter((x) => x.stage === "kept").map((x) => x.question_id)).toEqual(r.written);
    expect(r.gate).toMatchObject({ gated: f.recorded.length, answer: 1, review: 1, criteria: { distractors: 1 } });
  });

  it("the stored difficulty is the review's, and the source is the writer's", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => `Fine #${call * 10 + i}`) });
    await writeForChapter(f.deps, request({ source: "ai_practice", writer: "ai_practice" }));
    expect(f.stored.flat().every((s) => s.difficulty === "medium" && s.source === "ai_practice")).toBe(true);
  });

  it("when the door cannot be reached, nothing is counted as written and the notes say why", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => `Fine #${call * 10 + i}`), store: () => ({ ok: false, error: "connection reset" }) });
    const r = await writeForChapter(f.deps, request());
    expect(r.written).toEqual([]);
    expect(r.notes.store_failed).toBe("connection reset");
    expect(f.recorded.every((x) => x.question_id === null)).toBe(true);
  });

  it("a question the door finds already in the bank is offered back as a twin, not counted as written", async () => {
    const twins: string[] = [];
    const f = fakes({
      batch: (call, n) => Array.from({ length: n }, (_, i) => `Fine #${call * 10 + i}`),
      store: (items) => ({ ok: true, inserted: items.slice(1).map((_, k) => ({ index: k + 1, id: `bank-${k + 1}` })), skipped: [{ index: 0, reason: "already in the bank", existing_id: "bank-old" }] }),
    });
    const r = await writeForChapter(f.deps, request({ onTwin: (id) => twins.push(id) }));
    expect(twins).toEqual(["bank-old"]);
    expect(r.written).not.toContain("bank-old");
  });
});

describe("the chapter's official syllabus", () => {
  it("is given to the writer and to every review (20261149000000)", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => `Fine #${call * 10 + i}`) });
    await writeForChapter(f.deps, request());
    const line = `Official syllabus for this chapter: ${SCOPE.syllabus}`;
    expect(f.writerPrompts.length).toBeGreaterThan(0);
    expect(f.writerPrompts.every((p) => p.includes(line) && p.includes("Write nothing outside that syllabus."))).toBe(true);
    expect(f.reviewPrompts.length).toBe(f.recorded.length);
    expect(f.reviewPrompts.every((p) => p.includes(line))).toBe(true);
  });
});

describe("what is not paid for twice", () => {
  it("a draft the bank holds by meaning is never gated, and its twin is offered", async () => {
    const twins: string[] = [];
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => (call === 0 && i === 0 ? "TWIN #0" : `Fine #${call * 10 + i + 1}`)) });
    await writeForChapter(f.deps, request({ onTwin: (id) => twins.push(id) }));
    expect(twins).toEqual(["bank-twin"]);
    expect(f.recorded.some((x) => x.question.includes("TWIN"))).toBe(false);
  });

  it("one meaning written twice is gated once", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => (call === 0 && i < 2 ? `SAME ${i}` : `Fine #${call * 10 + i + 1}`)) });
    await writeForChapter(f.deps, request());
    expect(f.recorded.filter((x) => x.question.includes("SAME"))).toHaveLength(1);
  });

  it("gating stops at the first wave that keeps enough", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => `Fine #${call * 10 + i}`) });
    const r = await writeForChapter(f.deps, request({ form: null, shortfall: 30, stillNeeded: () => 5 }));
    expect(r.notes.drafted).toBeGreaterThan(GATE_CONCURRENCY);
    expect(r.notes.gated).toBe(GATE_CONCURRENCY);
    expect(f.recorded).toHaveLength(GATE_CONCURRENCY);
  });
});

describe("a chapter no AI writes for", () => {
  it("current affairs: nothing written, no model called, the reason given (A1 decision 6)", async () => {
    const f = fakes({ batch: () => { throw new Error("the writer must not be called"); } });
    const r = await writeForChapter(f.deps, request({
      chapter: { chapter_id: "ch-gk", chapter: "General Knowledge and Current Affairs", subject: "General Aptitude Test" },
    }));
    expect(r.notWritten).toMatch(/dated, sourced list of facts/);
    expect(r.written).toEqual([]);
    expect(f.stored).toEqual([]);
    expect(f.recorded).toEqual([]);
  });

  it("every other General Test area is written as usual", async () => {
    const f = fakes({ batch: (call, n) => Array.from({ length: n }, (_, i) => `Fine #${call * 10 + i}`) });
    const r = await writeForChapter(f.deps, request({
      chapter: { chapter_id: "ch-qr", chapter: "Quantitative Reasoning", subject: "General Aptitude Test" },
    }));
    expect(r.notWritten).toBeNull();
    expect(r.written.length).toBeGreaterThan(0);
  });
});

describe("a chapter with no topics", () => {
  it("gets its topics drafted once, and keeps them", async () => {
    const f = fakes({ batch: () => [], topics: [] });
    const deps = { ...f.deps, complete: async () => ({ ok: true as const, text: JSON.stringify({ topics: ["Goodwill", "Sacrificing ratio", "Capital adjustment"] }) }) };
    const topics = await ensureTopics(deps, "CUET (UG)", { chapter_id: "ch-1", chapter: "Admission of a New Partner", subject: "Accountancy" });
    expect(topics.map((t) => t.name)).toEqual(["Goodwill", "Sacrificing ratio", "Capital adjustment"]);
  });
});
