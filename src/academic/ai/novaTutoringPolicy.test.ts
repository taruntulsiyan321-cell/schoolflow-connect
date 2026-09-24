import { describe, expect, it } from "vitest";
import {
  expandSubjectsForMatch,
  pickExactSemanticMatch,
  resolveCacheSubject,
  resolveNovaTutoringMode,
  NOVA_CHAT_SYSTEM_V3,
} from "./novaTutoringPolicy";
import { getBuiltinPrompt } from "./promptLibrary";

function numbersMatch(a: string, b: string): boolean {
  const extract = (t: string) =>
    (t.match(/\d+(?:[.,]\d+)*/g) ?? [])
      .map((m) => parseFloat(m.replace(/,/g, "")))
      .filter((n) => Number.isFinite(n))
      .sort((x, y) => x - y);
  const na = extract(a);
  const nb = extract(b);
  if (na.length !== nb.length) return false;
  return na.every((n, i) => Math.abs(n - nb[i]!) < 0.005);
}

describe("novaTutoringPolicy", () => {
  it("expands Maths aliases for match filters", () => {
    const exp = expandSubjectsForMatch(["Maths"]);
    expect(exp).toEqual(expect.arrayContaining(["Mathematics", "Math", "Maths"]));
  });

  it("prefers subject-aligned exact over higher-sim wrong subject", () => {
    const picked = pickExactSemanticMatch(
      [
        {
          similarity: 0.95,
          question: "Find 2 + 2",
          subject: "Physics",
          __source: "ai_answer_cache",
        },
        {
          similarity: 0.9,
          question: "Find 2 + 2",
          subject: "Mathematics",
          __source: "question_bank",
        },
      ],
      "Find 2 + 2",
      ["Mathematics", "Math"],
      numbersMatch,
    );
    expect(picked?.subject).toBe("Mathematics");
    expect(picked?.__source).toBe("question_bank");
  });

  it("resolves cache subject from single profile subject", () => {
    expect(
      resolveCacheSubject({ matchedSubjectHint: null, profileSubjects: ["Chemistry"] }),
    ).toBe("Chemistry");
    expect(
      resolveCacheSubject({
        matchedSubjectHint: "maths",
        profileSubjects: ["Chemistry", "Physics"],
      }),
    ).toBe("Mathematics");
  });

  it("defaults to socratic, opens full on ask / after tries", () => {
    expect(
      resolveNovaTutoringMode({
        question: "Why does ice float?",
        hasQuestionContext: false,
        sessionTurnCount: 0,
        priorSocraticAttempts: 0,
      }).mode,
    ).toBe("socratic");
    expect(
      resolveNovaTutoringMode({
        question: "Just tell me the answer",
        hasQuestionContext: false,
        sessionTurnCount: 0,
        priorSocraticAttempts: 0,
      }).mode,
    ).toBe("full");
    expect(
      resolveNovaTutoringMode({
        question: "Why does ice float?",
        hasQuestionContext: false,
        sessionTurnCount: 2,
        priorSocraticAttempts: 0,
      }).mode,
    ).toBe("full");
    expect(
      resolveNovaTutoringMode({
        question: "Why?",
        hasQuestionContext: true,
        sessionTurnCount: 0,
        priorSocraticAttempts: 0,
      }).mode,
    ).toBe("mistake_review");
  });

  it("builtin nova prompt is v3 socratic learning-only", () => {
    const p = getBuiltinPrompt("student.nova.chat");
    expect(p?.version).toBe("v3");
    expect(p?.system_template).toMatch(/facts\.tutoring\.mode/);
    expect(p?.system_template).toMatch(/socratic/);
    expect(p?.system_template).toMatch(/Refuse attendance/);
    expect(NOVA_CHAT_SYSTEM_V3).toMatch(/socratic/);
  });
});
