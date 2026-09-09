import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";
import {
  buildQuestionGenerationRequest,
  generationTokenBudget,
  normalizeGeneratedQuestions,
  rejectionReason,
  MCQ_OPTION_COUNT,
  MIN_GENERATION_TOKENS,
  MAX_GENERATION_TOKENS,
  TOKENS_PER_QUESTION,
} from "./questionGeneration";

const MARKER = "// ── SHARED BODY (parity-checked";

function bodyOf(path: string): string {
  const text = readFileSync(join(process.cwd(), path), "utf8");
  const ix = text.indexOf(MARKER);
  if (ix < 0) throw new Error(`${path}: the SHARED BODY marker is missing`);
  // Rule 29: strip comments in BOTH directions before comparing, so a comment
  // edit in one copy is not reported as drift and a real edit hiding behind a
  // comment cannot pass.
  return stripComments(text.slice(ix))
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");
}

describe("the generator pair cannot drift", () => {
  const CLIENT = "src/academic/ai/questionGeneration.ts";
  const DENO = "supabase/functions/_shared/questionGenerator.ts";

  it("the Deno copy is identical to the client copy below the marker", () => {
    expect(bodyOf(DENO)).toBe(bodyOf(CLIENT));
  });

  // Without this, a stripper that silently returned "" would make the
  // comparison above pass on two completely different files (G11).
  it("the comparison is looking at real code, not an empty string", () => {
    const body = bodyOf(CLIENT);
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("buildQuestionGenerationRequest");
    expect(body).toContain("rejectionReason");
  });
});

describe("generationTokenBudget", () => {
  it("gives a long answer materially more room than an MCQ", () => {
    expect(TOKENS_PER_QUESTION.long).toBeGreaterThan(TOKENS_PER_QUESTION.mcq * 3);
  });

  it("never asks for less than the floor or more than the ceiling", () => {
    expect(generationTokenBudget("mcq", 1)).toBe(MIN_GENERATION_TOKENS);
    expect(generationTokenBudget("long", 1000)).toBe(MAX_GENERATION_TOKENS);
  });

  it("scales with the count once past the floor", () => {
    expect(generationTokenBudget("long", 10)).toBe(7000);
  });

  it("treats a nonsense count as one question rather than throwing", () => {
    expect(generationTokenBudget("mcq", 0)).toBe(MIN_GENERATION_TOKENS);
    expect(generationTokenBudget("mcq", Number.NaN)).toBe(MIN_GENERATION_TOKENS);
  });
});

describe("buildQuestionGenerationRequest", () => {
  const base = {
    subject: "Science",
    chapter: "Chemical Reactions",
    difficulty: "medium",
    count: 5,
    boardPhrase: "RBSE",
    classPhrase: "class 10",
  } as const;

  it("asks for options only in the MCQ schema", () => {
    const mcq = buildQuestionGenerationRequest({ ...base, format: "mcq" });
    expect(JSON.stringify(mcq.schema)).toContain("correct_index");
    expect(mcq.system).toContain(`Exactly ${MCQ_OPTION_COUNT} options`);

    const long = buildQuestionGenerationRequest({ ...base, format: "long" });
    expect(JSON.stringify(long.schema)).not.toContain("correct_index");
    expect(JSON.stringify(long.schema)).toContain("answer");
    expect(long.system).toContain("Do NOT produce options");
  });

  it("carries the board and class into the prompt", () => {
    const r = buildQuestionGenerationRequest({ ...base, format: "mcq" });
    expect(r.system).toContain("RBSE class 10");
  });

  // The board used to be hardcoded and pitched every question at one board and
  // class. An unknown board must leave the phrase out, not invent one.
  it("leaves the phrase clean when board and class are unknown", () => {
    const r = buildQuestionGenerationRequest({
      ...base,
      format: "mcq",
      boardPhrase: null,
      classPhrase: null,
    });
    expect(r.system).toContain("You are an expert question setter");
    expect(r.system).not.toContain("  ");
  });

  it("omits the chapter and source lines when there are none", () => {
    const r = buildQuestionGenerationRequest({
      format: "short",
      subject: "Science",
      difficulty: "easy",
      count: 2,
    });
    expect(r.user).not.toContain("Chapter:");
    expect(r.user).not.toContain("Source URL:");
    expect(r.user).toContain("Subject: Science");
  });
});

describe("the quality guard", () => {
  const goodMcq = {
    question: "Which is an ionic compound?",
    options: ["NaCl", "CH4", "O2", "H2"],
    correct_index: 0,
    explanation: "Sodium donates an electron to chlorine.",
  };

  it("accepts a well-formed MCQ and a well-formed written answer", () => {
    expect(rejectionReason(goodMcq, "mcq")).toBeNull();
    expect(
      rejectionReason(
        {
          question: "Explain ionic bonding.",
          answer: "Electrons transfer from metal to non-metal, forming ions that attract.",
          explanation: "Tests the transfer mechanism.",
        },
        "short",
      ),
    ).toBeNull();
  });

  it("refuses an MCQ that does not have exactly four options", () => {
    expect(rejectionReason({ ...goodMcq, options: ["a", "b", "c"] }, "mcq")).toContain(
      "3 options",
    );
    expect(
      rejectionReason({ ...goodMcq, options: ["a", "b", "c", "d", "e"] }, "mcq"),
    ).toContain("5 options");
  });

  it("refuses an MCQ whose options repeat — two answers would be correct", () => {
    expect(
      rejectionReason({ ...goodMcq, options: ["NaCl", "NaCl", "O2", "H2"] }, "mcq"),
    ).toContain("two options are the same");
  });

  it("refuses an answer key that points past the options", () => {
    expect(rejectionReason({ ...goodMcq, correct_index: 9 }, "mcq")).toContain(
      "does not point at an option",
    );
    expect(rejectionReason({ ...goodMcq, correct_index: -1 }, "mcq")).toContain(
      "does not point at an option",
    );
    expect(
      rejectionReason({ ...goodMcq, correct_index: undefined }, "mcq"),
    ).toContain("does not point at an option");
  });

  it("refuses a blank option, a missing question and a missing explanation", () => {
    expect(rejectionReason({ ...goodMcq, options: ["NaCl", "", "O2", "H2"] }, "mcq")).toBe(
      "an option is blank",
    );
    expect(rejectionReason({ ...goodMcq, question: "   " }, "mcq")).toBe("no question text");
    expect(rejectionReason({ ...goodMcq, explanation: "" }, "mcq")).toBe("no explanation");
  });

  it("refuses a one-word 'answer', which is a hint", () => {
    expect(
      rejectionReason(
        { question: "Define an ion.", answer: "charged", explanation: "definition" },
        "short",
      ),
    ).toContain("too short to mark against");
  });
});

describe("normalizeGeneratedQuestions", () => {
  const ok = (n: number) => ({
    question: `Q${n}`,
    options: ["a", "b", "c", "d"],
    correct_index: n % 4,
    explanation: "because",
  });

  it("stamps the format and trims to the requested count", () => {
    const out = normalizeGeneratedQuestions([ok(1), ok(2), ok(3)], "mcq", 2);
    expect(out.questions).toHaveLength(2);
    expect(out.questions.every((q) => q.question_format === "mcq")).toBe(true);
    expect(out.rejected).toEqual([]);
  });

  it("drops what the guard refuses and says why, instead of returning fewer silently", () => {
    const out = normalizeGeneratedQuestions(
      [ok(1), { ...ok(2), options: ["a", "b"] }, ok(3)],
      "mcq",
      5,
    );
    expect(out.questions).toHaveLength(2);
    expect(out.rejected).toEqual(["2 options, expected 4"]);
  });

  it("never carries options into a written-answer question", () => {
    const out = normalizeGeneratedQuestions(
      [
        {
          question: "Explain.",
          answer: "A complete answer that is long enough.",
          explanation: "why",
          options: ["a", "b", "c", "d"],
        },
      ],
      "long",
      1,
    );
    expect(out.questions[0]?.options).toBeUndefined();
    expect(out.questions[0]?.answer).toBe("A complete answer that is long enough.");
  });

  it("returns nothing at all rather than throwing on junk input", () => {
    expect(normalizeGeneratedQuestions(null, "mcq", 3).questions).toEqual([]);
    expect(normalizeGeneratedQuestions([null, 7, "x"], "mcq", 3).questions).toEqual([]);
    expect(normalizeGeneratedQuestions(undefined, "short", 3).rejected).toEqual([]);
  });
});
