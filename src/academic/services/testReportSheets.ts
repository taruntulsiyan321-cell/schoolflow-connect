/**
 * The test report as rows a spreadsheet can hold (§10.25 "Downloadable").
 *
 * One home for both sheets, because two portals download the same report: the
 * teacher takes the class list and any student's drill-down out of
 * `LiveTestsTab`, and the student takes their own out of `TestResult`. A copy
 * per portal is how the two would start disagreeing about what a blank cell
 * means.
 *
 * The rendering rules here are not cosmetic:
 *
 *   - a student who did not sit the test gets an EMPTY mark cell, never a 0.
 *     The database returns NULL there on purpose, and a spreadsheet is exactly
 *     where that distinction dies — a column of zeroes averages, sorts and
 *     prints as if the whole class had failed.
 *   - "left blank" is written out as words, because an empty cell in the
 *     answer column would read as a broken export rather than as a fact about
 *     what the student did.
 */
import { displayTopic } from "@/academic/taxonomy";
import { toPersonName } from "@/lib/presentation";
import { answerToText } from "./answerText";
import type { TestClassReport, TestStudentReport } from "./testService";

export function classReportCsvRows(r: TestClassReport): Record<string, unknown>[] {
  return r.students.map((s) => ({
    "Roll number": s.roll_number ?? "",
    Student: toPersonName(s.full_name, { kind: "student" }),
    Submitted: s.submitted ? "Yes" : "No",
    Mark: s.mark ?? "",
    "Out of": r.max_mark ?? "",
    Correct: s.correct_count ?? "",
    Questions: s.total_count ?? "",
    "Submitted at": s.submitted_at ?? "",
  }));
}

export function studentReportCsvRows(d: TestStudentReport): Record<string, unknown>[] {
  return d.wrong_answers.map((w) => ({
    Question: w.question,
    Topic: displayTopic(w.topic) || w.topic,
    Marks: w.marks ?? "",
    "Their answer": w.answered ? (answerToText(w.their_answer, w.options) ?? "") : "Left blank",
    "Correct answer": answerToText(w.correct_answer, w.options) ?? "",
  }));
}

/**
 * Wrong answers collapsed to "how many did I get wrong in each topic",
 * heaviest first — the actionable form of §10.25's "with the topic on each".
 *
 * Weaknesses only. §10.8: the product never shows a student what they are good
 * at, so a topic with nothing wrong in it does not appear here at all — it
 * cannot, because the report only carries what went wrong.
 */
export function wrongAnswersByTopic(d: TestStudentReport): { topic: string; wrong: number }[] {
  const counts = new Map<string, number>();
  for (const w of d.wrong_answers) {
    const label = displayTopic(w.topic) || w.topic;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([topic, wrong]) => ({ topic, wrong }))
    .sort((a, b) => b.wrong - a.wrong || a.topic.localeCompare(b.topic));
}
