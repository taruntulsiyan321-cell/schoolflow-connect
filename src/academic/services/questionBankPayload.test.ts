import { describe, expect, it } from "vitest";
import {
  assertQuestionRowsAreKeyed,
  buildQuestionBankInsertPayload,
  type QuestionBankInsertRow,
} from "@/academic/services/questionBankService";

/**
 * The bug this pins: every row sent to `question_bank` carried
 * `school_id: r.school_id ?? ctx.schoolId`, and `public.question_bank` has no
 * `school_id` column. Both teacher write paths — the "Save to bank" button and
 * the CSV import — go through this builder.
 *
 * WHY A TEST AND NOT A TYPE. Measured 2026-09-07: with `.insert(payload as
 * never)`'s cast removed and `school_id` deliberately re-added,
 * `npx tsc --noEmit` still exits 0 with no output. Excess-property checking
 * does not apply to a mapped variable, only to an object literal, so the
 * generated `Database` type cannot catch this. The compiler was never going to
 * be the guard.
 */

const ctx = { userId: "teacher-1" };

function row(over: Partial<QuestionBankInsertRow> = {}): QuestionBankInsertRow {
  return {
    subject: "Accountancy",
    question: "What is the current ratio?",
    options: ["a", "b", "c", "d"],
    correct_index: 0,
    ...over,
  };
}

describe("buildQuestionBankInsertPayload", () => {
  it("never emits school_id — question_bank has no such column", () => {
    const payload = buildQuestionBankInsertPayload([row(), row()], ctx);

    for (const r of payload) {
      expect(Object.keys(r)).not.toContain("school_id");
    }
  });

  it("does not let a caller smuggle school_id in through the row", () => {
    // The old signature accepted `school_id` on QuestionBankInsertRow, so a
    // caller passing one must not reach the wire either.
    const payload = buildQuestionBankInsertPayload(
      [{ ...row(), school_id: "00000000-0000-4000-8000-000000000001" } as QuestionBankInsertRow],
      ctx,
    );

    expect(Object.keys(payload[0])).not.toContain("school_id");
  });

  it("still sends every column question_bank does have (positive control)", () => {
    // Without this, a builder that returned {} would pass the assertion above.
    const payload = buildQuestionBankInsertPayload([row({ chapter: "Ratios", class_level: 12 })], ctx);

    expect(payload[0]).toMatchObject({
      subject: "Accountancy",
      question: "What is the current ratio?",
      correct_index: 0,
      chapter: "Ratios",
      class_level: 12,
    });
    expect(payload[0].options).toEqual(["a", "b", "c", "d"]);
  });

  it("attributes the row to the caller, which the author fence requires", () => {
    // 20260906030000 fences writes on created_by = auth.uid(); a row without it
    // is refused outright.
    const payload = buildQuestionBankInsertPayload([row()], ctx);
    expect(payload[0].created_by).toBe("teacher-1");
  });

  it("does not force is_approved true — the column defaults false", () => {
    // The override `is_approved: r.is_approved ?? true` is what made a
    // contribution student-visible at every school the instant it saved.
    // Measured before 20260907000000: another teacher, a student, and a
    // student at a DIFFERENT school all retrieved an unapproved contribution.
    const payload = buildQuestionBankInsertPayload([row()], ctx);

    expect(Object.keys(payload[0])).not.toContain("is_approved");
  });

  it("still lets a caller set is_approved explicitly, for a future approval path", () => {
    const payload = buildQuestionBankInsertPayload([row({ is_approved: true })], ctx);
    expect(payload[0].is_approved).toBe(true);
  });

  it("lets an explicit created_by win over the context", () => {
    const payload = buildQuestionBankInsertPayload([row({ created_by: "someone-else" })], ctx);
    expect(payload[0].created_by).toBe("someone-else");
  });

  it("carries chapter_id through to the wire", () => {
    // Without this the builder could drop the one column the CHECK constraint
    // requires and every test above would still pass.
    const payload = buildQuestionBankInsertPayload(
      [row({ chapter_id: "c0000000-0000-4000-8000-000000000001", class_level: 12 })],
      ctx,
    );
    expect(payload[0].chapter_id).toBe("c0000000-0000-4000-8000-000000000001");
  });
});

/**
 * `question_bank_active_must_be_keyed` is
 * `CHECK (NOT is_active OR (chapter_id IS NOT NULL AND class_level IS NOT NULL))`
 * and `is_active` defaults TRUE. Measured as a real teacher on 2026-09-07, an
 * insert with neither key returned:
 *   23514 new row for relation "question_bank" violates check constraint
 *         "question_bank_active_must_be_keyed"
 * These pin the refusal to something a teacher can act on, and — the part that
 * matters — pin that a properly keyed row is NOT refused.
 */
describe("assertQuestionRowsAreKeyed", () => {
  const keyed = (over: Partial<QuestionBankInsertRow> = {}) =>
    row({ chapter_id: "c0000000-0000-4000-8000-000000000001", class_level: 12, ...over });

  it("accepts a fully keyed row (positive control)", () => {
    expect(() => assertQuestionRowsAreKeyed([keyed(), keyed()])).not.toThrow();
  });

  it("refuses a row with no chapter_id", () => {
    expect(() => assertQuestionRowsAreKeyed([keyed({ chapter_id: null })]))
      .toThrow(/pick a chapter/i);
  });

  it("refuses a row with no class_level", () => {
    expect(() => assertQuestionRowsAreKeyed([keyed({ class_level: null })]))
      .toThrow(/pick a class/i);
  });

  it("names the offending row, so a 20-question batch is actionable", () => {
    expect(() => assertQuestionRowsAreKeyed([keyed(), keyed({ chapter_id: null })]))
      .toThrow(/Question 2/);
  });

  it("accepts an empty batch — insert short-circuits before it", () => {
    expect(() => assertQuestionRowsAreKeyed([])).not.toThrow();
  });
});
