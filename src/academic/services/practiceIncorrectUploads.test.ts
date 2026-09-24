/**
 * Incorrect Practice must include upload mistakes, not only bank ids.
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────
 *
 * listMistakeQuestions used to call listQuestionIdsByStatus("wrong"), which
 * filtered `.not("question_id", "is", null)` and then loaded those ids from
 * question_bank. Upload wrongs (§9.1 source=upload) have no bank id, so they
 * vanished from Incorrect mode even when the Mistake Book showed them.
 *
 * Fix: read open student_mistakes directly; bank rows still go through
 * question_bank; upload rows load student_upload_questions via
 * upload_question_id when present, else the snapshotted text on the mistake.
 *
 * ── WHY A SOURCE ASSERTION ────────────────────────────────────────────────
 *
 * Without a live DB, the regression that matters is the choice of tables and
 * the upload branch existing. Each assertion below fails against the old
 * bank-only path.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const SERVICE = join(__dirname, "practiceService.ts");
const SOURCE = stripComments(readFileSync(SERVICE, "utf8"));

function listMistakeBody(): string {
  const start = SOURCE.indexOf("async listMistakeQuestions");
  expect(start, "listMistakeQuestions has been renamed or removed").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("async listSkippedBankQuestions", start);
  expect(end, "listSkippedBankQuestions marker missing after listMistakeQuestions").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("incorrect mode includes upload mistakes", () => {
  it("reads open student_mistakes rather than bank ids alone", () => {
    const body = listMistakeBody();
    expect(body).toContain('.from("student_mistakes")');
    expect(body).toContain('.eq("status", "open")');
    // The old path only asked listQuestionIdsByStatus for wrong bank ids.
    expect(body, "must not collapse to bank-id-only listing").not.toMatch(
      /listQuestionIdsByStatus\(\s*ctx,\s*"wrong"/,
    );
  });

  it("loads private upload questions and falls back to snapshotted text", () => {
    const body = listMistakeBody();
    expect(body).toContain('source === "upload"');
    expect(body).toContain('.from("student_upload_questions")');
    expect(body).toContain("upload_question_id");
    expect(body).toContain("answerToIndex");
    expect(body).toContain("from_upload: true");
  });

  it("still loads bank mistakes through listBankQuestions", () => {
    const body = listMistakeBody();
    expect(body).toContain("listBankQuestions");
  });
});
