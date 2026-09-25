/**
 * Every uploaded or captured question is filed under a chapter of the
 * student's stream syllabus, or recognised as outside the stream — never left
 * without a chapter (ruled 2026-09-25).
 */
import { describe, expect, it } from "vitest";
import {
  OUTSIDE,
  outsideMessage,
  readTagReply,
  streamSubjects,
  taggingSystemPrompt,
  withCodes,
} from "../../../supabase/functions/_shared/syllabusTag.ts";

const SYLLABUS = withCodes([
  { chapter_id: "ch-partnership", chapter: "Accounting for Partnership", subject: "Accountancy", topics: [{ id: "t-deed", name: "Partnership Deed" }] },
  { chapter_id: "ch-money", chapter: "Money and Banking", subject: "Economics", topics: [] },
  { chapter_id: "ch-verbal", chapter: "Verbal Ability", subject: "English", topics: [{ id: "t-syn", name: "Synonyms and Antonyms" }] },
]);

describe("the syllabus the model chooses from", () => {
  it("numbers the chapters in syllabus order, and names the stream's subjects", () => {
    expect(SYLLABUS.map((c) => c.code)).toEqual(["C1", "C2", "C3"]);
    expect(streamSubjects(SYLLABUS)).toEqual(["Accountancy", "Economics", "English"]);
    const prompt = taggingSystemPrompt("CUET Commerce", SYLLABUS);
    expect(prompt).toContain("C2 · Economics › Money and Banking");
    expect(prompt).toContain('exactly one of "Accountancy", "Economics", "English"');
  });
});

describe("reading the model's answer", () => {
  it("files a question under the chapter its code names, with a listed topic", () => {
    const { tags, unanswered } = readTagReply(
      { tags: [{ index: 0, subject: "Accountancy", code: "C1", topic: "partnership deed" }, { index: 1, subject: "economics", code: "c2", topic: "not a topic" }] },
      SYLLABUS, [0, 1],
    );
    expect(unanswered).toEqual([]);
    expect(tags.get(0)).toEqual({ kind: "tagged", chapter_id: "ch-partnership", topic_id: "t-deed", subject: "Accountancy", chapter: "Accounting for Partnership" });
    expect(tags.get(1)).toMatchObject({ kind: "tagged", chapter_id: "ch-money", topic_id: null });
  });

  it("recognises a question from outside the stream", () => {
    const { tags } = readTagReply({ tags: [{ index: 0, subject: "Chemistry", code: OUTSIDE }] }, SYLLABUS, [0]);
    expect(tags.get(0)).toEqual({ kind: "outside", subject: "Chemistry" });
  });

  it("goes by the subject when the model still names a chapter for a Chemistry question", () => {
    // Live 2026-09-25: a first-order rate-constant question was filed under
    // Mathematics › Differential Equations.
    const { tags } = readTagReply({ tags: [{ index: 0, subject: "Chemistry", code: "C2" }] }, SYLLABUS, [0]);
    expect(tags.get(0)).toEqual({ kind: "outside", subject: "Chemistry" });
  });

  it("asks again when a stream subject comes with another subject's chapter, or with OUTSIDE", () => {
    const { tags, unanswered } = readTagReply(
      { tags: [{ index: 0, subject: "Economics", code: "C1" }, { index: 1, subject: "Economics", code: OUTSIDE }] },
      SYLLABUS, [0, 1],
    );
    expect(tags.size).toBe(0);
    expect(unanswered).toEqual([0, 1]);
  });

  it("never files under a code that is not in the syllabus, without a subject, or for a question it was not asked", () => {
    const { tags, unanswered } = readTagReply(
      { tags: [{ index: 0, subject: "Accountancy", code: "C9" }, { index: 7, subject: "Accountancy", code: "C1" }, { index: 1, code: "C1" }] },
      SYLLABUS, [0, 1],
    );
    expect(tags.size).toBe(0);
    expect(unanswered).toEqual([0, 1]);
  });

  it("CONTROL: a reply with nothing in it leaves every question unanswered, not filed", () => {
    expect(readTagReply(null, SYLLABUS, [0, 1]).unanswered).toEqual([0, 1]);
    expect(readTagReply({ tags: "nope" }, SYLLABUS, [0]).unanswered).toEqual([0]);
  });

  it("takes the first answer for an index the model repeats", () => {
    const { tags } = readTagReply({ tags: [{ index: 0, subject: "English", code: "C3" }, { index: 0, subject: "Accountancy", code: "C1" }] }, SYLLABUS, [0]);
    expect(tags.get(0)).toMatchObject({ chapter_id: "ch-verbal" });
  });
});

describe("what the student is told", () => {
  it("names the subject that is not theirs", () => {
    expect(outsideMessage("Chemistry", "CUET Commerce")).toBe("Chemistry isn't one of your CUET Commerce subjects, so it wasn't saved.");
    expect(outsideMessage(null, "CUET Commerce")).toBe("This isn't from one of your CUET Commerce subjects, so it wasn't saved.");
  });
});
