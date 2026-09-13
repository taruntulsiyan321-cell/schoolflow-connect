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
import type {
  TestAnswerSheet,
  TestClassReport,
  TestQuestionBreakdown,
  TestStudentReport,
} from "./testService";

/**
 * Milliseconds as seconds, to one decimal — or an EMPTY CELL when the answer
 * carries no clock at all.
 *
 * `0` here would be a claim that the student answered instantly. Every timing
 * column below goes through this, so an untimed row reads as untimed in the
 * spreadsheet exactly as it does on screen (§7, G4).
 */
function secondsCell(ms: number | null | undefined): string {
  return ms == null ? "" : (ms / 1000).toFixed(1);
}

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
 * Every question of one test with what it cost the class — the sheet form of
 * the per-question breakdown a teacher reads on screen (20260921000000).
 *
 * The four outcome states stay four columns. Collapsing "blank" into "wrong"
 * would tell a teacher the class misunderstood a question when what actually
 * happened is that nobody reached it.
 */
export function questionBreakdownCsvRows(b: TestQuestionBreakdown): Record<string, unknown>[] {
  return b.questions.map((q, i) => ({
    "#": q.order_index != null ? q.order_index + 1 : i + 1,
    Question: q.question,
    Topic: displayTopic(q.topic) || q.topic,
    Marks: q.marks ?? "",
    Correct: q.correct_count,
    Wrong: q.wrong_count,
    "Left blank": q.blank_count,
    "Average seconds": secondsCell(q.avg_time_ms),
    "Longest seconds": secondsCell(q.max_time_ms),
    "Longest taken by": q.slowest_student_name
      ? toPersonName(q.slowest_student_name, { kind: "student" })
      : "",
    "Answers timed": q.timed_count,
  }));
}

/**
 * One student's whole paper, question by question — the sheet behind the
 * teacher's drill-down and the student's own review.
 *
 * Every question, not only the wrong ones: a performance is what they got
 * right, what they got wrong, what they never reached, and how long each took.
 */
export function answerSheetCsvRows(d: TestAnswerSheet): Record<string, unknown>[] {
  return d.questions.map((q, i) => ({
    "#": q.order_index != null ? q.order_index + 1 : i + 1,
    Question: q.question,
    Topic: displayTopic(q.topic) || q.topic,
    Outcome: !q.answered ? "Left blank" : q.is_correct ? "Correct" : "Wrong",
    "Their answer": q.answered ? (answerToText(q.their_answer, q.options) ?? "") : "Left blank",
    "Correct answer": answerToText(q.correct_answer, q.options) ?? "",
    Marks: q.marks ?? "",
    "Marks awarded": q.marks_awarded ?? "",
    Seconds: secondsCell(q.time_ms),
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
