import { describe, expect, it } from "vitest";
import { readLabelledLink } from "./practiceLink";
import { MISTAKE_DRILLS } from "@/lib/questionMarks";

const link = (q: string) => readLabelledLink(new URLSearchParams(q));

describe("what a practice link starts", () => {
  it("a chapter is chapter mode; a topic without one is topic mode; a subject alone is subject mode", () => {
    expect(link("subject=Accountancy&chapter=Ratio+Analysis")).toMatchObject({ kind: "session", mode: "chapter", chapter: "Ratio Analysis", subject: "Accountancy" });
    expect(link("subject=Accountancy&topic=Liquidity")).toMatchObject({ kind: "session", mode: "topic", topic: "Liquidity", chapter: null });
    expect(link("subject=Accountancy")).toMatchObject({ kind: "session", mode: "subject", chapter: null, topic: null });
  });

  it("is not a labelled link at all without a subject, chapter or topic — even with a drill", () => {
    expect(link("")).toEqual({ kind: "none" });
    expect(link("mode=incorrect")).toEqual({ kind: "none" });
    expect(link("drill=calculation_error")).toEqual({ kind: "none" });
  });

  it("names nothing real when every label is a placeholder", () => {
    expect(link("subject=General&chapter=Mixed")).toEqual({ kind: "placeholder" });
  });

  it("carries a mistake type's drill, and no drill for an unknown type (C5)", () => {
    const drilled = link("subject=Accountancy&drill=calculation_error");
    expect(drilled).toMatchObject({ kind: "session", mode: "subject", drill: MISTAKE_DRILLS.calculation_error });
    expect(link("subject=Accountancy&drill=misread_question")).toMatchObject({ drill: MISTAKE_DRILLS.misread_question });
    // CONTROL: a type that drives no drill, and a made-up one, carry none.
    expect(link("subject=Accountancy&drill=recall")).toMatchObject({ kind: "session", drill: null });
    expect(link("subject=Accountancy&drill=__proto__")).toMatchObject({ kind: "session", drill: null });
    expect(link("subject=Accountancy")).toMatchObject({ drill: null });
  });
});
