import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AR_OPTIONS,
  canonicalMatch,
  canonicalOrder,
  composeQuestion,
  FORM_JSON_GUIDE,
  formOf,
  isMatchCode,
  isOrderOf,
  QUESTION_FORMS,
  type QuestionParts,
  questionOneLine,
  readQuestionLayout,
  readQuestionParts,
} from "../../../supabase/functions/_shared/questionForms.ts";
import { readRequestReply, readWrittenQuestion } from "../../../supabase/functions/_shared/aiPractice.ts";
import type { SyllabusChapter } from "../../../supabase/functions/_shared/syllabusTag.ts";

/**
 * Every MCQ form CUET uses, laid out properly (owner, 2026-10-03). The layout
 * lives in the question's text: writers compose it, the app reads it, the
 * database classifies it (question_form_of). The FIXTURES are 20261141000000's
 * own — its PROOF holds question_form_of to them, and this holds the writer
 * and the reader to the same.
 */
type Fixture = { form: string; text: string; options: string[]; parts?: QuestionParts };
const MIGRATION = readFileSync("supabase/migrations/20261141000000_every_question_form_is_laid_out.sql", "utf8");
const FIXTURES: Fixture[] = JSON.parse(MIGRATION.match(/_fixtures constant jsonb := \$json\$([\s\S]*?)\$json\$/)![1]);
const fixture = (form: string) => FIXTURES.find((f) => f.form === form && f.parts)!;

describe("the migration's fixtures", () => {
  it("cover every form", () => {
    expect(new Set(FIXTURES.filter((f) => f.parts).map((f) => f.form))).toEqual(new Set(QUESTION_FORMS));
  });

  it.each(FIXTURES.filter((f) => f.parts).map((f) => [f.form, f] as const))("a %s question is composed exactly as stored", (_form, f) => {
    expect(composeQuestion(f.parts!)).toBe(f.text);
  });

  it.each(FIXTURES.map((f, i) => [`${i}: ${f.form}`, f] as const))("fixture %s is read as its form", (_label, f) => {
    expect(formOf(f.text, f.options)).toBe(f.form);
  });
});

describe("how each form is shown", () => {
  it("assertion and reason as two statements", () => {
    expect(readQuestionLayout(fixture("assertion_reason").text)).toEqual([{
      kind: "assertion_reason",
      assertion: "Goodwill is an intangible asset of a firm.",
      reason: "Goodwill cannot be seen or touched but has a value.",
    }]);
  });

  it("the older one-line assertion–reason questions too", () => {
    const legacy = FIXTURES.find((f) => f.form === "assertion_reason" && !f.parts)!;
    expect(readQuestionLayout(legacy.text)).toEqual([{
      kind: "assertion_reason",
      assertion: "On dissolution, goodwill is transferred to the Realisation Account.",
      reason: "Goodwill is treated like other assets on dissolution.",
    }]);
  });

  it("statements as a numbered list between their introduction and the question", () => {
    const b = readQuestionLayout(fixture("statements").text);
    expect(b.map((x) => x.kind)).toEqual(["paragraph", "list", "paragraph"]);
    expect(b[1]).toMatchObject({ style: "roman", items: [{ label: "I" }, { label: "II" }, { label: "III", text: "It settles the ratio in which profits are shared." }] });
  });

  it("the two lists of a match side by side, with their titles", () => {
    const b = readQuestionLayout(fixture("match").text);
    expect(b.map((x) => x.kind)).toEqual(["paragraph", "match", "paragraph"]);
    expect(b[1]).toMatchObject({
      kind: "match", list1Title: "Ratio", list2Title: "Type",
      list1: [{ label: "A", text: "Current ratio" }, { label: "B" }, { label: "C" }],
      list2: [{ label: "I", text: "Solvency ratio" }, { label: "II" }, { label: "III" }],
    });
  });

  it("a case in its own block above its question", () => {
    const b = readQuestionLayout(fixture("case_based").text);
    expect(b.map((x) => x.kind)).toEqual(["case", "paragraph"]);
    expect(b[1]).toEqual({ kind: "paragraph", lines: ["In what ratio will Asha and Binu share the premium brought in by Chetan?"] });
  });

  it("an older question's options, printed again in its text, are not shown twice", () => {
    const f = FIXTURES.find((x) => x.text.startsWith("If a company's Proprietors' Funds"))!;
    expect(readQuestionLayout(f.text, f.options).map((x) => x.kind)).toEqual(["paragraph"]);
    // Without its options there is nothing to compare against, so nothing is dropped.
    expect(readQuestionLayout(f.text).map((x) => x.kind)).toEqual(["paragraph", "list"]);
    // A lettered list that is NOT the options stays.
    expect(readQuestionLayout(f.text, ["a", "b", "c", "d"]).map((x) => x.kind)).toEqual(["paragraph", "list"]);
  });

  it("on one line for a card", () => {
    expect(questionOneLine(fixture("assertion_reason").text))
      .toBe("Assertion (A): Goodwill is an intangible asset of a firm. Reason (R): Goodwill cannot be seen or touched but has a value.");
    expect(questionOneLine(fixture("statements").text)).toContain("I. It may be oral or written. II. It must be registered");
  });
});

describe("reading what a writer sends", () => {
  it("each form's parts, with the usual introduction and question when none is given", () => {
    expect(readQuestionParts({ form: "statements", statements: ["First statement here.", "Second statement here."] }))
      .toEqual({ ok: true, parts: { form: "statements", intro: "Consider the following statements:", statements: ["First statement here.", "Second statement here."], ask: "Which of the statements given above are correct?" } });
    expect(readQuestionParts({ question: "A plain question?" })).toEqual({ ok: true, parts: { form: "mcq", stem: "A plain question?" } });
  });

  it("refuses a form it cannot lay out properly", () => {
    expect(readQuestionParts({ form: "statements", statements: ["Only one statement."] })).toMatchObject({ ok: false });
    expect(readQuestionParts({ form: "match", list1: ["a1", "b1", "c1"], list2: ["x", "y"] })).toMatchObject({ ok: false });
    expect(readQuestionParts({ form: "case_based", passage: "Too short.", ask: "What?" })).toMatchObject({ ok: false, reason: "a case too short to be one" });
    expect(readQuestionParts({ form: "essay", question: "Q" })).toMatchObject({ ok: false, reason: "unknown form essay" });
    expect(readQuestionParts({ form: "assertion_reason", assertion: "Short", reason: "Also short" })).toMatchObject({ ok: false });
  });

  it("a match option is a full matching, a sequence option an order of every item", () => {
    expect(isMatchCode("A-II, B-III, C-I", 3)).toBe(true);
    expect(isMatchCode("A–II B–III C–I", 3)).toBe(true);
    expect(isMatchCode("A-II, B-III", 3)).toBe(false);
    expect(isMatchCode("B-II, A-III, C-I", 3)).toBe(false);
    expect(isOrderOf("III, II, I, IV", 4)).toBe(true);
    expect(isOrderOf("III → II → I → IV", 4)).toBe(true);
    expect(isOrderOf("III, II, I", 4)).toBe(false);
    expect(isOrderOf("III, III, I, IV", 4)).toBe(false);
    expect(isOrderOf("I and II only", 2)).toBe(false);
  });

  it("a matching or an order is stored one way, however it is written", () => {
    expect(canonicalMatch("A – ii, B – i, C – iv, D – iii", 4)).toBe("A-II, B-I, C-IV, D-III");
    expect(canonicalMatch("(A)-(II) (B)-(I) (C)-(IV) (D)-(III)", 4)).toBe("A-II, B-I, C-IV, D-III");
    expect(canonicalMatch("A→II, B→I, C→IV, D→III", 4)).toBe("A-II, B-I, C-IV, D-III");
    expect(canonicalMatch("A-II, B-II, C-IV, D-III", 4)).toBeNull(); // List II's II used twice
    expect(canonicalMatch("A-V, B-I, C-IV, D-III", 4)).toBeNull(); // no fifth item
    expect(canonicalOrder("ii → i → iv → iii", 4)).toBe("II, I, IV, III");
    expect(canonicalOrder("II, I, IV", 4)).toBeNull();
  });

  it("the guide every writer is given names every form", () => {
    for (const f of QUESTION_FORMS) expect(FORM_JSON_GUIDE).toContain(`"${f}"`);
  });
});

describe("a written question in each form", () => {
  const TOPICS = [{ id: "t1", name: "Goodwill" }];
  const explained = (wrong: string[]) => ({
    working: "The working runs through the idea step by step, naming the rule first and then applying it carefully to the facts given in the question.",
    wrong: wrong.map((option) => ({ option, reason: `Option ${option} rests on a misreading of the rule the question tests.` })),
  });

  it("an assertion–reason question gets the four standard options, whatever was sent", () => {
    const r = readWrittenQuestion({
      topic: "T1", form: "assertion_reason", assertion: "Goodwill is an intangible asset of a firm.",
      reason: "Goodwill cannot be seen or touched but has a value.", options: ["x", "y", "z", "w"], answer: "A", ...explained(["B", "C", "D"]),
    }, TOPICS, null);
    expect(r).toMatchObject({ ok: true, question: { form: "assertion_reason", options: [...AR_OPTIONS], question: fixture("assertion_reason").text } });
  });

  it("a match question whose options are not matchings is thrown away", () => {
    const m = fixture("match").parts as Extract<QuestionParts, { form: "match" }>;
    const base = { topic: "T1", form: "match", intro: m.intro, list1_title: "Ratio", list1: m.list1, list2_title: "Type", list2: m.list2, ask: m.ask, answer: "A", ...explained(["B", "C", "D"]) };
    expect(readWrittenQuestion({ ...base, options: ["A-II, B-III, C-I", "A-I, B-II, C-III", "A-III, B-II, C-I", "A-II, B-I, C-III"] }, TOPICS, null))
      .toMatchObject({ ok: true, question: { form: "match", question: fixture("match").text } });
    expect(readWrittenQuestion({ ...base, options: ["Liquidity", "Solvency", "Activity", "Profitability"] }, TOPICS, null))
      .toMatchObject({ ok: false, reason: "a match option is not a full matching (A-?, B-?, …): \"Liquidity\"" });
  });

  // What the writer sent on 2026-10-03 for "4 match the following questions on
  // dissolution": labels inside the items, "List I" inside the titles, and
  // List II in List I's order with the identity matching as the key.
  const asSent = {
    topic: "T1", form: "match",
    intro: "Match List I with List II regarding the treatment of various accounts during the dissolution of a partnership firm:",
    list1_title: "List I (Account)", list1: ["I. Goodwill Account", "II. Bills Payable", "III. Workmen Compensation Reserve", "IV. Buildings"],
    list2_title: "List II (Treatment on Dissolution)",
    list2: ["A. Transferred to Partners' Capital Accounts", "B. Paid by the firm's assets", "C. Distributed among partners", "D. Realised through sale"],
    options: ["A-I, B-II, C-III, D-IV", "A-IV, B-III, C-II, D-I", "A-II, B-I, C-IV, D-III", "A-III, B-IV, C-I, D-II"],
    answer: "A", ...explained(["B", "C", "D"]),
  };

  it("labels and list names the writer put in are taken out, so the layout holds", () => {
    const r = readQuestionParts(asSent);
    expect(r).toMatchObject({ ok: true, parts: {
      list1Title: "Account", list1: ["Goodwill Account", "Bills Payable", "Workmen Compensation Reserve", "Buildings"],
      list2Title: "Treatment on Dissolution", list2: ["Transferred to Partners' Capital Accounts", "Paid by the firm's assets", "Distributed among partners", "Realised through sale"],
    } });
    if (!r.ok) return;
    const text = composeQuestion(r.parts);
    expect(text).toContain("\nList I (Account):\nA. Goodwill Account\n");
    expect(formOf(text, asSent.options)).toBe("match");
  });

  it("a match keyed to the two lists in the same order is thrown away; shuffled, it is kept", () => {
    expect(readWrittenQuestion(asSent, TOPICS, null)).toMatchObject({ ok: false, reason: "the right matching is the two lists in the same order — List II must be shuffled" });
    expect(readWrittenQuestion({ ...asSent, answer: "C", ...explained(["A", "B", "D"]) }, TOPICS, null)).toMatchObject({ ok: true, question: { form: "match" } });
  });

  it("a sequence keyed to the items as listed is thrown away", () => {
    const seq = { topic: "T1", form: "sequence", items: ["First step taken", "Second step taken", "Third step taken"], options: ["I, II, III", "II, I, III", "III, II, I", "II, III, I"] };
    expect(readWrittenQuestion({ ...seq, answer: "A", ...explained(["B", "C", "D"]) }, TOPICS, null)).toMatchObject({ ok: false, reason: "the right order is the items as listed — list them out of order" });
    expect(readWrittenQuestion({ ...seq, answer: "D", ...explained(["A", "B", "C"]) }, TOPICS, null)).toMatchObject({ ok: true, question: { form: "sequence" } });
  });

  it("a student can ask for one form, and nothing else is read as one", () => {
    const syllabus: SyllabusChapter[] = [{ code: "C1", chapter_id: "ch-1", chapter: "Goodwill", subject: "Accountancy", topics: [] }];
    expect(readRequestReply({ kind: "practice", chapter: "C1", form: "case_based" }, syllabus)).toMatchObject({ form: "case_based" });
    expect(readRequestReply({ kind: "practice", chapter: "C1", form: "long answer" }, syllabus)).toMatchObject({ form: null });
  });
});
