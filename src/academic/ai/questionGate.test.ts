import { describe, expect, it } from "vitest";
import type { Think } from "../../../supabase/functions/_shared/answerCheck.ts";
import { gateQuestion, tallyGate, type GateDraft, type GateOutcome } from "../../../supabase/functions/_shared/questionGate.ts";
import { CRITERION_IDS } from "../../../supabase/functions/_shared/questionRubric.ts";

/**
 * The quality gate every AI-written question passes before the bank (TODO A2).
 * The model is a fake that answers the solve and the review as each test says,
 * so every branch runs — and the rule that nothing is kept when a call fails
 * is proved, not assumed.
 */
const DRAFT: GateDraft = {
  subject: "Accountancy",
  chapter: "Admission of a New Partner",
  topic: "Goodwill",
  form: "mcq",
  question: "When a new partner brings premium for goodwill in cash, it is credited to the capital accounts of the:",
  options: ["The new partner in the ratio of capitals", "Gaining partners in their gaining ratio", "Sacrificing partners in their sacrificing ratio", "All partners in their old profit-sharing ratio"],
  correctIndex: 2,
};

type Reply = { ok: true; text: string; finish_reason: string | null } | { ok: false; error: string };
const text = (t: string): Reply => ({ ok: true, text: t, finish_reason: "stop" });
const solved = (letter: string) => text(JSON.stringify({ answers: [{ n: 1, working: "Premium goes to the sacrificers.", answer: letter }] }));
const marks = (failing: Record<string, string> = {}, difficulty = "medium") =>
  text(JSON.stringify({
    marks: CRITERION_IDS.map((criterion) => (failing[criterion]
      ? { criterion, pass: false, note: failing[criterion] }
      : { criterion, pass: true, note: "" })),
    difficulty,
  }));

/** A fake model: the review is the call whose system prompt is the chief examiner's. */
function fake(answer: { solve: Reply | Reply[]; review: Reply }) {
  const calls: Array<{ kind: "solve" | "review"; temperature: number | undefined }> = [];
  let s = 0;
  const think: Think = async (input) => {
    if (input.system.includes("chief examiner")) {
      calls.push({ kind: "review", temperature: input.temperature });
      return answer.review;
    }
    calls.push({ kind: "solve", temperature: input.temperature });
    const solves = Array.isArray(answer.solve) ? answer.solve : [answer.solve];
    return solves[Math.min(s++, solves.length - 1)];
  };
  return { think, calls };
}

const gate = (think: Think) => ({ think, model: "qwen/qwen3.7-flash", now: () => new Date("2026-10-09T10:00:00Z") });

describe("what the gate keeps", () => {
  it("solved to its key and passed on every criterion: kept, with its review", async () => {
    const { think, calls } = fake({ solve: solved("C"), review: marks() });
    const o = await gateQuestion(gate(think), "CUET (UG)", DRAFT);
    expect(o).toMatchObject({ kept: true, review: { passed: true, solved: ["C"], difficulty: "medium", model: "qwen/qwen3.7-flash", reviewed_at: "2026-10-09T10:00:00.000Z" } });
    if (!o.kept) throw new Error("kept");
    expect(o.review.marks.every((m) => m.pass)).toBe(true);
    // One solve and one review, each its own call.
    expect(calls.map((c) => c.kind).sort()).toEqual(["review", "solve"]);
  });

  it("a rewrite is solved at every temperature asked, and must reach its key at each", async () => {
    const both = fake({ solve: [solved("C"), solved("C")], review: marks() });
    expect((await gateQuestion(gate(both.think), "CUET (UG)", DRAFT, { solveTemperatures: [0, 0.4] })).kept).toBe(true);
    expect(both.calls.filter((c) => c.kind === "solve").map((c) => c.temperature)).toEqual([0, 0.4]);

    const one = fake({ solve: [solved("C"), solved("B")], review: marks() });
    const o = await gateQuestion(gate(one.think), "CUET (UG)", DRAFT, { solveTemperatures: [0, 0.4] });
    expect(o).toMatchObject({ kept: false, stage: "answer", reason: "solved without the key as (C), then (B); the key is (C)" });
  });

  it("a difficulty asked for must be the difficulty judged", async () => {
    const asked = fake({ solve: solved("C"), review: marks({}, "easy") });
    expect(await gateQuestion(gate(asked.think), "CUET (UG)", DRAFT, { difficulty: "hard" }))
      .toMatchObject({ kept: false, stage: "review", reason: "hard was asked for; the review judged it easy" });
    const same = fake({ solve: solved("C"), review: marks({}, "hard") });
    expect((await gateQuestion(gate(same.think), "CUET (UG)", DRAFT, { difficulty: "hard" })).kept).toBe(true);
  });
});

describe("what the gate refuses, and why", () => {
  it("a rule broken: refused before any model is paid for", async () => {
    const { think, calls } = fake({ solve: solved("C"), review: marks() });
    const o = await gateQuestion(gate(think), "CUET (UG)", { ...DRAFT, options: [...DRAFT.options.slice(0, 3), "None of the above"] });
    expect(o).toMatchObject({ kept: false, stage: "rule", review: null });
    expect(calls).toHaveLength(0);
    const ar = await gateQuestion(gate(think), "CUET (UG)", { ...DRAFT, form: "assertion_reason" });
    expect(ar).toMatchObject({ kept: false, stage: "rule", reason: expect.stringContaining("assertion–reason") });
    expect(calls).toHaveLength(0);
  });

  it("solved to another option: refused at the answer, the review still kept for the record", async () => {
    const o = await gateQuestion(gate(fake({ solve: solved("B"), review: marks({ one_answer: "Option B is also defensible." }) }).think), "CUET (UG)", DRAFT);
    expect(o).toMatchObject({ kept: false, stage: "answer", failed: ["one_answer"], review: { passed: false, solved: ["B"] } });
  });

  it("no single answer found: refused at the answer", async () => {
    const o = await gateQuestion(gate(fake({ solve: solved("none"), review: marks() }).think), "CUET (UG)", DRAFT);
    expect(o).toMatchObject({ kept: false, stage: "answer", reason: expect.stringContaining("no single answer") });
  });

  it("the key holds but a criterion fails: refused at the review, naming it", async () => {
    const o = await gateQuestion(
      gate(fake({ solve: solved("C"), review: marks({ distractors: "Option A, the new partner, is plainly wrong.", register: "The right option is the only long one." }) }).think),
      "CUET (UG)",
      DRAFT,
    );
    expect(o).toMatchObject({ kept: false, stage: "review", failed: ["distractors", "register"] });
    if (o.kept) throw new Error("refused");
    expect(o.reason).toBe("failed the rubric: distractors — Option A, the new partner, is plainly wrong.; register — The right option is the only long one.");
  });

  it.each([
    ["the review's call fails", { solve: solved("C"), review: { ok: false as const, error: "OpenRouter error 503" } }, "review"],
    ["the review cannot be read", { solve: solved("C"), review: text("Looks fine to me.") }, "review"],
    ["the review leaves a criterion out", { solve: solved("C"), review: text(JSON.stringify({ marks: [{ criterion: "one_answer", pass: true }], difficulty: "easy" })) }, "review"],
    ["the solve's call fails", { solve: { ok: false as const, error: "cut off while thinking" }, review: marks() }, "answer"],
  ])("%s: nothing is kept", async (_, answers, stage) => {
    const o = await gateQuestion(gate(fake(answers).think), "CUET (UG)", DRAFT);
    expect(o).toMatchObject({ kept: false, stage });
  });
});

describe("a batch, counted", () => {
  it("kept, and refused by stage, rule and criterion", () => {
    const refusals: GateOutcome[] = [
      { kept: false, stage: "rule", reason: "r1", failed: [], review: null },
      { kept: false, stage: "rule", reason: "r1", failed: [], review: null },
      { kept: false, stage: "answer", reason: "a", failed: ["one_answer"], review: null },
      { kept: false, stage: "review", reason: "v", failed: ["distractors", "register"], review: null },
      { kept: false, stage: "review", reason: "v", failed: ["distractors"], review: null },
    ];
    const kept = { kept: true, review: {} } as GateOutcome;
    expect(tallyGate([kept, ...refusals, kept])).toEqual({
      gated: 7, kept: 2, rule: { r1: 2 }, answer: 1, review: 2, criteria: { one_answer: 1, distractors: 2, register: 1 },
    });
  });
});
