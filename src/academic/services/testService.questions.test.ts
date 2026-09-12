import { describe, it, expect } from "vitest";
import { toQuestionRow } from "./testService";
import { ValidationFailedError } from "../repository/errors";

/**
 * Each refusal here mirrors a database rule, and says which one. The client
 * check exists so the teacher is told WHICH question is wrong out of twenty
 * rather than being handed a constraint name; the database check exists because
 * a client is not a fence. They must agree, and these are the assertions that
 * keep them agreeing.
 *
 *   shape            test_questions_shape_matches_format  (20260914050000)
 *   key addresses    trg_test_question_key_addresses_an_option (20260914110000)
 *   MCQ + whole      trg_test_question_is_a_markable_mcq  (20260920020000)
 */
const TEST = "11111111-1111-4111-8111-111111111111";
const SCHOOL = "22222222-2222-4222-8222-222222222222";

const valid = {
  question: "  What is the HCF of 12 and 18?  ",
  options: ["2", "4", "6", "12"],
  correctIndex: 2,
  marks: 1,
  explanation: "  12 = 2^2*3, 18 = 2*3^2  ",
  chapter: " Real Numbers ",
  topic: " HCF and LCM ",
};

describe("toQuestionRow", () => {
  it("shapes a question the way rpc_test_submit can mark it", () => {
    const row = toQuestionRow(valid, 0, TEST, SCHOOL);
    expect(row.test_id).toBe(TEST);
    expect(row.school_id).toBe(SCHOOL);
    expect(row.order_index).toBe(0);
    // An online test holds MCQs only, and the key is a POSITION: the marker is
    // `a.response = q.correct` as jsonb, and the renderer can only ever send an
    // index it drew.
    expect(row.question_format).toBe("mcq");
    expect(row.correct).toEqual({ indexes: [2] });
    // `answer` is for written questions, and the shape constraint requires it
    // to be NULL when `correct` is present.
    expect(row.answer).toBeNull();
    expect(row.question).toBe("What is the HCF of 12 and 18?");
    expect(row.options).toEqual(["2", "4", "6", "12"]);
    expect(row.explanation).toBe("12 = 2^2*3, 18 = 2*3^2");
    expect(row.chapter).toBe("Real Numbers");
    // §10.22: the topic travels per question, and the class report ranks
    // weakest topics off this field.
    expect(row.concept).toBe("HCF and LCM");
  });

  it("defaults marks to 1 and blank prose to null rather than empty strings", () => {
    const row = toQuestionRow(
      { question: "Q", options: ["a", "b"], correctIndex: 0, explanation: "   ", chapter: "", topic: "" },
      3,
      TEST,
      SCHOOL,
    );
    expect(row.marks).toBe(1);
    expect(row.explanation).toBeNull();
    expect(row.chapter).toBeNull();
    expect(row.concept).toBeNull();
  });

  it("refuses a question with no text", () => {
    expect(() => toQuestionRow({ ...valid, question: "   " }, 0, TEST, SCHOOL)).toThrow(
      ValidationFailedError,
    );
  });

  it("refuses fewer than two options, and any blank one", () => {
    expect(() => toQuestionRow({ ...valid, options: ["only one"], correctIndex: 0 }, 0, TEST, SCHOOL)).toThrow(
      ValidationFailedError,
    );
    expect(() => toQuestionRow({ ...valid, options: ["a", "  "], correctIndex: 0 }, 0, TEST, SCHOOL)).toThrow(
      ValidationFailedError,
    );
  });

  /**
   * The defect this replaced: the correct answer used to be typed as the
   * option's TEXT, and a typo produced `{indexes: []}` — a key naming no
   * option — so every student's answer marked wrong with nothing on screen to
   * explain it.
   */
  it("refuses a key that names no option", () => {
    expect(() => toQuestionRow({ ...valid, correctIndex: 4 }, 0, TEST, SCHOOL)).toThrow(
      ValidationFailedError,
    );
    expect(() => toQuestionRow({ ...valid, correctIndex: -1 }, 0, TEST, SCHOOL)).toThrow(
      ValidationFailedError,
    );
    expect(() =>
      toQuestionRow({ ...valid, correctIndex: undefined as unknown as number }, 0, TEST, SCHOOL),
    ).toThrow(ValidationFailedError);
  });

  /**
   * `tests.max_mark` and `test_marks.mark` are integer columns, so a half mark
   * is rounded into the mark a parent and a principal read.
   */
  it("refuses a fractional or zero mark", () => {
    expect(() => toQuestionRow({ ...valid, marks: 0.5 }, 0, TEST, SCHOOL)).toThrow(ValidationFailedError);
    expect(() => toQuestionRow({ ...valid, marks: 0 }, 0, TEST, SCHOOL)).toThrow(ValidationFailedError);
  });

  it("names the question in every message, because a paper has twenty", () => {
    // 1-indexed for a human: question 7, not index 6. A message that says
    // "invalid question" on a twenty-question paper sends the teacher hunting.
    expect(() => toQuestionRow({ ...valid, correctIndex: 9 }, 6, TEST, SCHOOL)).toThrow(/Question 7\b/);
    expect(() => toQuestionRow({ ...valid, question: " " }, 0, TEST, SCHOOL)).toThrow(/Question 1\b/);
    expect(() => toQuestionRow({ ...valid, marks: 2.5 }, 11, TEST, SCHOOL)).toThrow(/Question 12\b/);
  });
});
