/**
 * KNOWN_ISSUES 91 — a mistake whose question can no longer be asked.
 *
 * Measured on production 2026-09-28: a student was 7-times and 8-times wrong on
 * two questions whose bank rows are now is_active = false. Those mistakes keep
 * counting towards the open total and the recovery trigger, but nothing can ever
 * serve them again — and the card still offered "Retry", which opened a session
 * with nothing in it. The rule below is what the book and the runner now share.
 */
import { describe, expect, it } from "vitest";
import { mapRowToMistake, mistakeIsAskable, type MistakeRow } from "./mistakeRow";

const live = (over: Partial<{ bankActive: string[]; uploadAlive: string[]; captureAlive: string[] }> = {}) => ({
  bankActive: new Set(over.bankActive ?? []),
  uploadAlive: new Set(over.uploadAlive ?? []),
  captureAlive: new Set(over.captureAlive ?? []),
});

describe("can this mistake's question still be asked?", () => {
  it("a bank question can, while it is still live", () => {
    expect(mistakeIsAskable({ question_id: "q1" }, live({ bankActive: ["q1"] }))).toBe(true);
  });

  it("a bank question that has been deactivated or withdrawn cannot", () => {
    // Not in the set = either inactive, or gone from the student's own view
    // (unapproved, or outside their board or exam). Both are unaskable.
    expect(mistakeIsAskable({ question_id: "q1" }, live({ bankActive: ["q2"] }))).toBe(false);
    expect(mistakeIsAskable({ question_id: "q1" }, live())).toBe(false);
  });

  it("an upload question can while its row exists, and not after it is deleted", () => {
    expect(mistakeIsAskable({ upload_question_id: "u1" }, live({ uploadAlive: ["u1"] }))).toBe(true);
    expect(mistakeIsAskable({ upload_question_id: "u1" }, live())).toBe(false);
  });

  it("a screen capture can while its row exists, and not after the student deletes it", () => {
    expect(mistakeIsAskable({ capture_question_id: "c1" }, live({ captureAlive: ["c1"] }))).toBe(true);
    expect(mistakeIsAskable({ capture_question_id: "c1" }, live())).toBe(false);
  });

  it("a legacy row that links to nothing stays askable — its own text is the question", () => {
    expect(mistakeIsAskable({}, live())).toBe(true);
    expect(mistakeIsAskable({ question_id: null, upload_question_id: null, capture_question_id: null }, live()))
      .toBe(true);
  });

  it("prefers the bank id when a row carries more than one", () => {
    // A repointed variant mistake can carry both; the bank question is what
    // would be served, so it is what decides.
    expect(mistakeIsAskable(
      { question_id: "q1", capture_question_id: "c1" },
      live({ captureAlive: ["c1"] }),
    )).toBe(false);
  });
});

describe("the row the Mistake Book renders", () => {
  const row = (over: Partial<MistakeRow> = {}): MistakeRow => ({
    id: "m1",
    question_text: "What is a partnership deed?",
    options: ["a", "b", "c", "d"],
    correct_answer: { index: 1 } as never,
    student_answer: { index: 0 } as never,
    subject: "Accountancy",
    chapter: "Accounting for Partnership",
    concept: null,
    topic: null,
    source: "practice",
    assessment_type: "practice",
    last_wrong_at: "2026-09-20T10:00:00Z",
    times_wrong: 2,
    explanation: null,
    status: "open",
    ...over,
  });

  it("is askable unless the reader says otherwise", () => {
    expect(mapRowToMistake(row(), false).askable).toBe(true);
    expect(mapRowToMistake(row({ askable: true }), false).askable).toBe(true);
    expect(mapRowToMistake(row({ askable: false }), false).askable).toBe(false);
  });
});
