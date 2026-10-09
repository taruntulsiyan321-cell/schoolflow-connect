import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAPTERS_NOT_WRITTEN,
  CRITERION_IDS,
  DIFFICULTY_DEFINITIONS,
  DIFFICULTY_LEVELS,
  failedCriteria,
  FORMS_NOT_WRITTEN,
  isWrittenForm,
  readRubricReview,
  reviewRecord,
  reviewSystemPrompt,
  reviewUserPrompt,
  RUBRIC,
  RUBRIC_VERSION,
  ruleRefusal,
  whyChapterNotWritten,
  whyNotWritten,
} from "../../../supabase/functions/_shared/questionRubric.ts";
import { QUESTION_FORMS } from "../../../supabase/functions/_shared/questionForms.ts";

/**
 * The CBT rubric (TODO A2): its rules, how a reviewer's marks are read, and
 * the contract with the database door that refuses an AI-written question
 * without a passing review (20261148000000).
 */
const MIGRATION = readFileSync("supabase/migrations/20261148000000_every_ai_question_passes_the_quality_gate.sql", "utf8");

const allPass = () => ({
  marks: CRITERION_IDS.map((criterion) => ({ criterion, pass: true, note: "" })),
  difficulty: "medium",
});

describe("the rubric and the database agree", () => {
  it("the database's criteria are the rubric's, in order", () => {
    const listed = MIGRATION.match(/_question_rubric_ids\(\)[\s\S]*?SELECT ARRAY\[([^\]]*)\]/)?.[1];
    expect(listed).toBeDefined();
    expect(listed!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))).toEqual([...CRITERION_IDS]);
  });

  it("the review the gate stores has the fields the door reads", () => {
    const body = MIGRATION.match(/CREATE FUNCTION public\._quality_review_passes[\s\S]*?END \$\$;/)?.[0] ?? "";
    for (const read of ["_review->'passed'", "_review->'marks'", "m->'pass'", "m->>'criterion'"]) expect(body).toContain(read);
    const review = readRubricReview(allPass())!;
    const record = reviewRecord(review, [2], "qwen/qwen3.7-flash", new Date("2026-10-09T10:00:00Z"));
    expect(record).toMatchObject({ rubric: RUBRIC_VERSION, passed: true, difficulty: "medium", solved: ["C"], model: "qwen/qwen3.7-flash" });
    expect(record.marks.map((m) => [m.criterion, m.pass])).toEqual(CRITERION_IDS.map((id) => [id, true]));
  });

  it("criterion ids are unique and each has words a reviewer can grade by", () => {
    expect(new Set(CRITERION_IDS).size).toBe(RUBRIC.length);
    for (const c of RUBRIC) expect(c.test.length).toBeGreaterThan(80);
  });
});

describe("the rules, decided with no model", () => {
  const direct = { form: "mcq" as const, options: ["Goodwill", "Capital reserve", "Revaluation reserve", "General reserve"], correctIndex: 0 };

  it("a sound question breaks no rule", () => {
    expect(ruleRefusal(direct)).toBeNull();
    // The paper's own combination options are answers, not crutches.
    expect(ruleRefusal({ form: "statements", options: ["(A), (B) and (D) only", "(A) and (C) only", "(B), (C) and (D) only", "(A) and (D) only"], correctIndex: 1 })).toBeNull();
  });

  it("assertion–reason is never written (A1, ruled 2026-10-09)", () => {
    expect(ruleRefusal({ ...direct, form: "assertion_reason" })).toBe(FORMS_NOT_WRITTEN.assertion_reason);
    expect(isWrittenForm("assertion_reason")).toBe(false);
    expect(whyNotWritten("assertion_reason")).toContain("does not set assertion–reason");
    for (const f of QUESTION_FORMS.filter((f) => f !== "assertion_reason")) {
      expect(isWrittenForm(f)).toBe(true);
      expect(whyNotWritten(f)).toBeNull();
    }
  });

  it("a chapter no AI writes for is named exactly as the app names it (the blueprint's checked list)", () => {
    const blueprint = readFileSync("docs/cuet-blueprint.md", "utf8");
    for (const name of Object.keys(CHAPTERS_NOT_WRITTEN)) {
      expect(blueprint).toContain(`| ${name} |`);
      expect(whyChapterNotWritten(name)).toBe(CHAPTERS_NOT_WRITTEN[name]);
    }
    expect(whyChapterNotWritten("Quantitative Reasoning")).toBeNull();
  });

  it.each(["All of the above", "None of these", "(d) None of the above", "Both of the above", "All the above"])(
    "an option that is a crutch is refused: %s",
    (crutch) => {
      expect(ruleRefusal({ ...direct, options: [...direct.options.slice(0, 3), crutch] })).toMatch(/crutch/);
    },
  );

  it("a right option far longer than every other gives itself away", () => {
    const long = "The amount of goodwill brought in by the incoming partner in cash";
    expect(ruleRefusal({ ...direct, options: [long, "Capital", "Reserve", "Premium"], correctIndex: 0 })).toMatch(/gives it away/);
    // Long, but so is a wrong one: no giveaway.
    expect(ruleRefusal({ ...direct, options: [long, "The amount of capital brought in by the incoming partner", "Reserve", "Premium"], correctIndex: 0 })).toBeNull();
    // Long only next to very short ones, but itself short: numbers, terms.
    expect(ruleRefusal({ ...direct, options: ["₹1,20,000 (credit)", "₹12", "₹20", "₹2"], correctIndex: 0 })).toBeNull();
  });
});

describe("reading a reviewer's marks", () => {
  it("every criterion passed, in the rubric's order whatever order it came in", () => {
    const r = readRubricReview({ ...allPass(), marks: [...allPass().marks].reverse() });
    expect(r).toMatchObject({ passed: true, difficulty: "medium" });
    expect(r!.marks.map((m) => m.criterion)).toEqual([...CRITERION_IDS]);
  });

  it("one criterion failed, with what is wrong", () => {
    const raw = allPass();
    raw.marks[1] = { criterion: "distractors", pass: false, note: "Option D, 'Profit and Loss Account', is plainly wrong." };
    const r = readRubricReview(raw)!;
    expect(r.passed).toBe(false);
    expect(failedCriteria(r)).toBe("distractors — Option D, 'Profit and Loss Account', is plainly wrong.");
  });

  it.each([
    ["a failure with no note", (r: ReturnType<typeof allPass>) => { r.marks[0] = { criterion: "one_answer", pass: false, note: "" }; }],
    ["a criterion missing", (r: ReturnType<typeof allPass>) => { r.marks.pop(); }],
    ["a criterion twice", (r: ReturnType<typeof allPass>) => { r.marks[5] = { criterion: "one_answer", pass: true, note: "" }; }],
    ["a criterion the rubric does not have", (r: ReturnType<typeof allPass>) => { r.marks[5] = { criterion: "elegance" as never, pass: true, note: "" }; }],
    ["a mark that is not true or false", (r: ReturnType<typeof allPass>) => { (r.marks[2] as { pass: unknown }).pass = "true"; }],
    ["no difficulty", (r: ReturnType<typeof allPass>) => { r.difficulty = "tricky"; }],
  ])("%s is no review at all", (_, spoil) => {
    const raw = allPass();
    spoil(raw);
    expect(readRubricReview(raw)).toBeNull();
  });

  it("anything that is not a reply is no review", () => {
    expect(readRubricReview(null)).toBeNull();
    expect(readRubricReview("passed")).toBeNull();
    expect(readRubricReview({ marks: "all good", difficulty: "easy" })).toBeNull();
  });
});

describe("what the reviewer is told", () => {
  it("that the chapter is in the exam's syllabus, so it judges the question, not the syllabus", () => {
    expect(reviewSystemPrompt("CUET (UG)")).toContain("part of the CUET (UG) syllabus: for \"syllabus\", judge whether the question stays inside that chapter");
  });

  it("judges the syllabus by the chapter's official text when it is given (20261149000000)", () => {
    expect(reviewSystemPrompt("CUET (UG)")).toContain("anything it does not list is outside the syllabus");
    const q = { subject: "Mathematics", chapter: "Relations and Functions", topic: null, question: "Q?", options: ["a", "b", "c", "d"], correctIndex: 0 };
    const withScope = reviewUserPrompt({ ...q, scope: { syllabus: "Types of relations. One to one and onto functions.", asks: "Only these." } });
    expect(withScope).toContain("Official syllabus for this chapter: Types of relations. One to one and onto functions.");
    expect(withScope).toContain("What the real paper asks in this chapter: Only these.");
    expect(reviewUserPrompt({ ...q, scope: { syllabus: "Types of relations.", asks: null } })).not.toContain("What the real paper asks");
    expect(reviewUserPrompt(q)).not.toContain("Official syllabus");
  });

  it("every criterion and every difficulty, and the JSON to answer in", () => {
    const text = reviewSystemPrompt("CUET (UG)");
    for (const c of RUBRIC) expect(text).toContain(c.test);
    for (const d of DIFFICULTY_LEVELS) expect(text).toContain(DIFFICULTY_DEFINITIONS[d]);
    for (const id of CRITERION_IDS) expect(text).toContain(`"criterion":"${id}"`);
  });

  it("the question, its options lettered, and the writer's answer", () => {
    const text = reviewUserPrompt({
      subject: "Accountancy", chapter: "Admission of a New Partner", topic: null,
      question: "Premium for goodwill brought in cash is credited to:", options: ["A", "B", "Sacrificing partners' capital accounts", "D"], correctIndex: 2,
    });
    expect(text).toContain("Chapter: Admission of a New Partner");
    expect(text).not.toContain("Topic:");
    expect(text).toContain("C. Sacrificing partners' capital accounts");
    expect(text).toContain("The writer's answer: (C)");
  });

  it("a solve that found no single answer is recorded as such", () => {
    const record = reviewRecord(readRubricReview(allPass())!, [1, null], "m", new Date("2026-10-09T00:00:00Z"));
    expect(record.solved).toEqual(["B", "none"]);
    expect(record.reviewed_at).toBe("2026-10-09T00:00:00.000Z");
  });
});
