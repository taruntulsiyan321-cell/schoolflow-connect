import { describe, expect, it } from "vitest";
import {
  closestSimilarity,
  cosineSimilarity,
  guardQuestion,
  normaliseChapter,
  type GuardContext,
} from "@/academic/paper/questionGuard";
import {
  paperTotalMarks,
  planSources,
  sectionTotalMarks,
  summariseSection,
} from "@/academic/paper/sectionComposition";
import { NEAR_DUPLICATE_SIMILARITY } from "@/academic/metrics/thresholds";

const mcqCtx: GuardContext = { format: "mcq", chapters: [] };
const shortCtx: GuardContext = { format: "short", chapters: [] };

function mcq(over: Record<string, unknown> = {}) {
  return {
    question: "Which ratio measures short-term liquidity?",
    options: ["Current", "Debt-equity", "Gross profit", "Stock turnover"],
    correct_index: 0,
    ...over,
  };
}

describe("guardQuestion — malformed", () => {
  it("rejects a question with no text", () => {
    const v = guardQuestion(mcq({ question: "   " }), mcqCtx);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.kind).toBe("malformed");
  });

  it("rejects an MCQ without four options", () => {
    const v = guardQuestion(mcq({ options: ["a", "b"] }), mcqCtx);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.detail).toContain("4 non-empty options");
  });

  it("rejects an MCQ whose correct_index is outside the options", () => {
    const v = guardQuestion(mcq({ correct_index: 7 }), mcqCtx);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.kind).toBe("malformed");
  });

  it("accepts a well-formed MCQ (positive control)", () => {
    // Without this, a guard that rejected everything would pass every test above.
    expect(guardQuestion(mcq(), mcqCtx).ok).toBe(true);
  });
});

describe("guardQuestion — answerless", () => {
  it("rejects a short-answer question with no answer", () => {
    const v = guardQuestion({ question: "Define working capital.", answer: "  " }, shortCtx);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.kind).toBe("answerless");
  });

  it("accepts one that has an answer (positive control)", () => {
    const v = guardQuestion(
      { question: "Define working capital.", answer: "Current assets less current liabilities." },
      shortCtx,
    );
    expect(v.ok).toBe(true);
  });

  it("does not demand options of a written-answer question", () => {
    const v = guardQuestion({ question: "Explain.", answer: "Because." }, { format: "long", chapters: [] });
    expect(v.ok).toBe(true);
  });
});

describe("guardQuestion — off chapter", () => {
  const ctx: GuardContext = { format: "mcq", chapters: ["Accounting Ratios"] };

  it("rejects a question from a chapter the section did not ask for", () => {
    const v = guardQuestion(mcq({ chapter: "Cash Flow Statement" }), ctx);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.kind).toBe("off_chapter");
  });

  it("rejects a question carrying no chapter at all", () => {
    const v = guardQuestion(mcq({ chapter: null }), ctx);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.detail).toContain("no chapter");
  });

  it("matches across the spellings the bank actually holds", () => {
    // The bank holds inconsistent casing and spacing; an exact match would
    // reject correct questions.
    expect(guardQuestion(mcq({ chapter: "accounting  ratios" }), ctx).ok).toBe(true);
    expect(normaliseChapter("  Accounting   RATIOS ")).toBe("accounting ratios");
  });

  it("does not filter when the section named no chapters", () => {
    expect(guardQuestion(mcq({ chapter: "Anything" }), mcqCtx).ok).toBe(true);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical direction and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns null rather than 0 when it cannot be measured", () => {
    // 0 would read as "completely different" and let a duplicate through.
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
  });

  it("closestSimilarity ignores unmeasurable pairs instead of scoring them", () => {
    expect(closestSimilarity([1, 0], [[1, 0, 0], [0, 0]])).toBeNull();
    expect(closestSimilarity([1, 0], [[0, 1], [1, 0]])).toBeCloseTo(1);
  });
});

describe("guardQuestion — near duplicate", () => {
  it("rejects a question at or above the duplicate threshold", () => {
    const v = guardQuestion(
      { ...mcq(), embedding: [1, 0] },
      { ...mcqCtx, existingEmbeddings: [[1, 0]] },
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.kind).toBe("near_duplicate");
  });

  it("accepts a merely relevant question (positive control)", () => {
    // Everything in a chapter is relevant to that chapter. If the guard
    // rejected at relevance it would reject the whole section, so this is the
    // control that matters most.
    const v = guardQuestion(
      { ...mcq(), embedding: [1, 1] },
      { ...mcqCtx, existingEmbeddings: [[1, 0]] },
    );
    expect(v.ok).toBe(true);
    expect(cosineSimilarity([1, 1], [1, 0])!).toBeLessThan(NEAR_DUPLICATE_SIMILARITY);
  });

  it("says when the duplicate check could not run, rather than implying it passed", () => {
    const noVec = guardQuestion(mcq(), { ...mcqCtx, existingEmbeddings: [[1, 0]] });
    expect(noVec.ok).toBe(true);
    if (noVec.ok) expect(noVec.duplicateCheck).toBe("skipped_no_embedding");

    const noCorpus = guardQuestion({ ...mcq(), embedding: [1, 0] }, mcqCtx);
    expect(noCorpus.ok).toBe(true);
    if (noCorpus.ok) expect(noCorpus.duplicateCheck).toBe("skipped_no_corpus");

    const ran = guardQuestion(
      { ...mcq(), embedding: [1, 1] },
      { ...mcqCtx, existingEmbeddings: [[1, 0]] },
    );
    if (ran.ok) expect(ran.duplicateCheck).toBe("ran");
  });
});

describe("planSources", () => {
  it("takes MCQs from the bank first and generates only the shortfall", () => {
    expect(planSources({ format: "mcq", targetCount: 20 }, 6)).toEqual({ fromBank: 6, toGenerate: 14 });
  });

  it("generates nothing when the bank covers the section", () => {
    expect(planSources({ format: "mcq", targetCount: 5 }, 9)).toEqual({ fromBank: 5, toGenerate: 0 });
  });

  it("generates written-answer sections outright — the bank is MCQ-shaped", () => {
    expect(planSources({ format: "short", targetCount: 5 }, 99)).toEqual({ fromBank: 0, toGenerate: 5 });
    expect(planSources({ format: "long", targetCount: 3 }, 99)).toEqual({ fromBank: 0, toGenerate: 3 });
  });
});

describe("summariseSection", () => {
  it("reports a shortfall rather than pretending the section is full", () => {
    expect(summariseSection({ format: "mcq", targetCount: 20 }, 6, 8)).toMatchObject({
      retrieved: 6, generated: 8, shortfall: 6, short: true,
    });
  });

  it("is not short when the blueprint is met", () => {
    expect(summariseSection({ format: "mcq", targetCount: 10 }, 6, 4)).toMatchObject({
      shortfall: 0, short: false,
    });
  });

  it("never reports a negative shortfall when more arrived than asked", () => {
    expect(summariseSection({ format: "short", targetCount: 3 }, 0, 5).shortfall).toBe(0);
  });
});

describe("marks are computed, never stored", () => {
  it("uses the section rate for questions with no override", () => {
    expect(sectionTotalMarks(3, [{ marks: null }, { marks: null }, { marks: null }])).toBe(9);
  });

  it("lets a per-question override win", () => {
    expect(sectionTotalMarks(3, [{ marks: null }, { marks: 5 }])).toBe(8);
  });

  it("adds the sections up into the paper total", () => {
    const total = paperTotalMarks([
      { marksPerQuestion: 1, questions: [{ marks: null }, { marks: null }] },
      { marksPerQuestion: 3, questions: [{ marks: null }, { marks: 4 }] },
    ]);
    expect(total).toBe(2 + 3 + 4);
  });
});
