/**
 * CHUNK 10 batch 2 — golden numbers for homework, marks, activity, comparison.
 *
 * Every family carries at least one test for the SHAPE of the batch-1 defect,
 * because it is the same mistake wearing different clothes each time:
 *
 *   attendance   averaging per-student percentages instead of dividing totals
 *   homework     counting not-yet-due work as incomplete
 *   marks        averaging per-exam percentages across different max_marks
 *   activity     "days since never" rendering as 0
 *   comparison   an unmeasured section ranked alongside measured ones
 */
import { describe, it, expect } from "vitest";
import { valueOr, isOk } from "./types";
import {
  completionRate,
  currentCompletion,
  completionBySubject,
  missedWhileAbsent,
  pastDue,
  type HomeworkTask,
} from "./homework";
import {
  markAverage,
  averageBySubject,
  distribution,
  belowPassCount,
  sectionFlaggedOnMarks,
  movement,
  rankWithinSection,
  marksPending,
  marksOverdue,
  type MarkRow,
  type ExamRow,
} from "./marks";
import {
  homeworkAssigned,
  testsConducted,
  markingRecord,
  daysSinceLastActivity,
  subjectsTaught,
} from "./activity";
import { compare, standing, type SectionMetric } from "./comparison";
import { ok, noData, notMarked } from "./types";

const TODAY = "2026-09-01";

const task = (o: Partial<HomeworkTask> = {}): HomeworkTask => ({
  homeworkId: "h1",
  studentId: "s1",
  dueOn: "2026-08-25",
  submitted: false,
  ...o,
});

const mark = (o: Partial<MarkRow> = {}): MarkRow => ({
  studentId: "s1",
  examId: "e1",
  scored: 50,
  maxMarks: 100,
  passingMarks: 33,
  ...o,
});

describe("homework counts only past-due work", () => {
  it("excludes work that is not yet due", () => {
    const m = completionRate(
      [
        task({ homeworkId: "a", dueOn: "2026-08-25", submitted: true }),
        task({ homeworkId: "b", dueOn: "2026-09-30", submitted: false }), // future
      ],
      TODAY,
    );
    expect(valueOr(m, null)).toBe(100); // 1 of 1 past-due, not 1 of 2
  });

  it("treats work due TODAY as not yet late", () => {
    expect(pastDue(task({ dueOn: TODAY }), TODAY)).toBe(false);
  });

  it("never treats a null due date as overdue since the epoch", () => {
    expect(pastDue(task({ dueOn: null }), TODAY)).toBe(false);
  });

  it("is not_marked, not 0%, when tasks exist but none is due yet", () => {
    const m = completionRate([task({ dueOn: "2026-12-01" })], TODAY);
    expect(m.state).toBe("not_marked");
    expect(m.value).toBeNull();
  });

  it("is no_data when there are no tasks at all", () => {
    expect(completionRate([], TODAY).state).toBe("no_data");
  });

  it("scopes the rolling window to due dates, not set dates", () => {
    const m = currentCompletion(
      [
        task({ homeworkId: "a", dueOn: "2026-08-28", submitted: true }), // in 7d
        task({ homeworkId: "b", dueOn: "2026-06-01", submitted: false }), // outside
      ],
      TODAY,
    );
    expect(valueOr(m, null)).toBe(100);
    expect(m.basis).toContain("last 7 day(s)");
  });

  it("ranks subjects worst-first and omits those with nothing due", () => {
    const m = completionBySubject(
      [
        task({ homeworkId: "a", subject: "Maths", submitted: true }),
        task({ homeworkId: "b", subject: "Maths", submitted: false }),
        task({ homeworkId: "c", subject: "Hindi", submitted: false }),
        task({ homeworkId: "d", subject: "Science", dueOn: "2026-12-01" }), // not due
      ],
      TODAY,
    );
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value.map((s) => s.subject)).toEqual(["Hindi", "Maths"]);
    expect(m.value.find((s) => s.subject === "Science")).toBeUndefined();
  });

  it("separates absence-explained gaps from ordinary non-submission", () => {
    const m = missedWhileAbsent(
      [
        task({ homeworkId: "a", submitted: false, absentOnDueDate: true }),
        task({ homeworkId: "b", submitted: false, absentOnDueDate: false }),
        task({ homeworkId: "c", submitted: true, absentOnDueDate: false }),
      ],
      TODAY,
    );
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value).toEqual({ missed: 1, ofIncomplete: 2 });
  });

  it("is no_data — not zero — when absence on the due date was never supplied", () => {
    const m = missedWhileAbsent([task({ submitted: false })], TODAY);
    expect(m.state).toBe("no_data");
  });
});

describe("marks average over summed maximums, never a mean of percentages", () => {
  it("does not let a 10-mark test outweigh a 100-mark exam", () => {
    const m = markAverage([
      mark({ examId: "small", scored: 5, maxMarks: 10 }), //  50%
      mark({ examId: "big", scored: 90, maxMarks: 100 }), //  90%
    ]);
    // Mean of percentages: 70. Summed: 95 of 110 = 86.4.
    expect(valueOr(m, null)).toBe(86.4);
  });

  it("ignores unentered marks rather than scoring them zero", () => {
    const m = markAverage([
      mark({ scored: 80, maxMarks: 100 }),
      mark({ examId: "e2", scored: null, maxMarks: 100 }),
    ]);
    expect(valueOr(m, null)).toBe(80);
  });

  it("is not_marked when rows exist but nothing is entered", () => {
    const m = markAverage([mark({ scored: null })]);
    expect(m.state).toBe("not_marked");
  });

  it("bands the distribution on fixed boundaries", () => {
    const m = distribution([
      mark({ scored: 39, maxMarks: 100 }),
      mark({ scored: 40, maxMarks: 100 }),
      mark({ scored: 90, maxMarks: 100 }),
    ]);
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value.find((b) => b.label === "below 40")?.count).toBe(1);
    expect(m.value.find((b) => b.label === "40–59")?.count).toBe(1);
    expect(m.value.find((b) => b.label === "90+")?.count).toBe(1);
  });
});

describe("below pass excludes exams with no passing_marks", () => {
  it("counts only answerable marks and reports the exclusions", () => {
    const m = belowPassCount([
      mark({ studentId: "a", scored: 10, passingMarks: 33 }), // below
      mark({ studentId: "b", scored: 90, passingMarks: 33 }), // above
      mark({ studentId: "c", scored: 10, passingMarks: null }), // unanswerable
    ]);
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value).toEqual({ below: 1, answerable: 2, excludedNoPassMark: 1 });
    expect(m.basis).toContain("passing_marks not set");
  });

  it("is not_marked — and flags nothing — when no exam has a pass mark", () => {
    const m = belowPassCount([mark({ passingMarks: null })]);
    expect(m.state).toBe("not_marked");
    const f = sectionFlaggedOnMarks([mark({ passingMarks: null })]);
    expect(f.state).toBe("not_marked");
    expect(f.value).not.toBe(false); // "checked, and fine" would be the lie
  });

  it("flags a section at or above 25% below pass", () => {
    const rows = [
      mark({ studentId: "a", scored: 10 }),
      mark({ studentId: "b", scored: 90 }),
      mark({ studentId: "c", scored: 90 }),
      mark({ studentId: "d", scored: 90 }),
    ];
    expect(valueOr(sectionFlaggedOnMarks(rows), null)).toBe(true); // exactly 25%
  });
});

describe("movement and rank", () => {
  it("needs both sides answerable, and does not treat a missing exam as zero", () => {
    const earlier = [mark({ studentId: "a", scored: 50, maxMarks: 100 })];
    const later = [mark({ studentId: "a", examId: "e2", scored: null })];
    expect(movement(earlier, later, "a").state).toBe("no_data");
  });

  it("reports movement in percentage points", () => {
    const earlier = [mark({ studentId: "a", scored: 50, maxMarks: 100 })];
    const later = [mark({ studentId: "a", examId: "e2", scored: 62, maxMarks: 100 })];
    expect(valueOr(movement(earlier, later, "a"), null)).toBe(12);
  });

  it("shares a rank on ties and leaves unanswerable students UNRANKED", () => {
    const m = rankWithinSection([
      mark({ studentId: "a", scored: 90, maxMarks: 100 }),
      mark({ studentId: "b", scored: 90, maxMarks: 100 }),
      mark({ studentId: "c", scored: 50, maxMarks: 100 }),
      mark({ studentId: "d", scored: null }),
    ]);
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value.ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(m.value.unranked).toEqual(["d"]);
    expect(m.value.ranked.map((r) => r.studentId)).not.toContain("d");
  });
});

describe("marks pending and overdue", () => {
  const exam = (o: Partial<ExamRow> = {}): ExamRow => ({
    examId: "e1",
    examDate: "2026-08-01",
    expected: 30,
    entered: 30,
    ...o,
  });

  it("lists only exams whose marks are incomplete", () => {
    const m = marksPending([exam(), exam({ examId: "e2", entered: 10 })], TODAY);
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value).toHaveLength(1);
    expect(m.value[0]).toMatchObject({ examId: "e2", missing: 20 });
  });

  it("ages against the exam date and says when it cannot", () => {
    const m = marksOverdue(
      [
        exam({ examId: "old", entered: 0, examDate: "2026-08-01" }), // 31 days
        exam({ examId: "fresh", entered: 0, examDate: "2026-08-30" }), // 2 days
        exam({ examId: "undated", entered: 0, examDate: null }),
      ],
      TODAY,
    );
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value.map((e) => e.examId)).toEqual(["old"]);
    expect(m.basis).toContain("no exam_date");
  });
});

describe("activity distinguishes a measured zero from never", () => {
  it("is no_data for days-since when there has been no activity ever", () => {
    const m = daysSinceLastActivity([], [], TODAY);
    expect(m.state).toBe("no_data");
    expect(m.value).not.toBe(0); // "last active 0 days ago" would be the lie
  });

  it("measures days since the most recent of homework or tests", () => {
    const m = daysSinceLastActivity(
      [{ homeworkId: "h", teacherId: "t", sectionId: "s", createdOn: "2026-08-20" }],
      [{ testId: "x", teacherId: "t", sectionId: "s", conductedOn: "2026-08-30" }],
      TODAY,
    );
    expect(valueOr(m, null)).toBe(2);
  });

  it("reports a real zero for a teacher who set nothing in the window", () => {
    const m = homeworkAssigned(
      [{ homeworkId: "h", teacherId: "t", sectionId: "s", createdOn: "2026-01-01" }],
      { from: "2026-08-01", to: TODAY },
    );
    expect(m.state).toBe("ok");
    expect(m.value).toBe(0);
  });

  it("says how many tests it could not count for want of a date", () => {
    const m = testsConducted(
      [
        { testId: "a", teacherId: "t", sectionId: "s", conductedOn: "2026-08-15" },
        { testId: "b", teacherId: "t", sectionId: "s", conductedOn: null },
      ],
      { from: "2026-08-01", to: TODAY },
    );
    expect(valueOr(m, null)).toBe(1);
    expect(m.basis).toContain("no date");
  });

  it("is not_marked, not 0%, when no day was expected in the window", () => {
    const m = markingRecord(
      [{ sectionId: "s", date: "2026-01-01", submitted: false }],
      { from: "2026-08-01", to: TODAY },
    );
    expect(m.state).toBe("not_marked");
  });

  it("computes the marking record over expected days", () => {
    const m = markingRecord(
      [
        { sectionId: "s", date: "2026-08-10", submitted: true },
        { sectionId: "s", date: "2026-08-11", submitted: true },
        { sectionId: "s", date: "2026-08-12", submitted: false },
      ],
      { from: "2026-08-01", to: TODAY },
    );
    expect(valueOr(m, null)).toBe(66.7);
  });

  it("does not invent subjects for a teacher whose tasks carry none", () => {
    const m = subjectsTaught([
      { homeworkId: "h", teacherId: "t", sectionId: "s", createdOn: TODAY },
    ]);
    expect(m.state).toBe("not_marked");
  });
});

describe("sibling comparison never ranks an unmeasured section", () => {
  const s = (id: string, name: string, m: SectionMetric["metric"]): SectionMetric => ({
    sectionId: id,
    sectionName: name,
    metric: m,
  });

  it("keeps unmeasured sections out of the ranking and lists them with a reason", () => {
    const c = compare([
      s("1", "A", ok(92, "fixture")),
      s("2", "B", ok(85, "fixture")),
      s("3", "C", notMarked("nobody has submitted attendance for C")),
    ]);
    expect(isOk(c)).toBe(true);
    if (!isOk(c)) return;
    expect(c.value.ranked.map((r) => r.sectionName)).toEqual(["A", "B"]);
    expect(c.value.unmeasured).toHaveLength(1);
    expect(c.value.unmeasured[0]).toMatchObject({ sectionName: "C", state: "not_marked" });
    expect(c.value.spread).toBe(7);
  });

  it("does NOT place an unmeasured section last", () => {
    const c = compare([
      s("1", "A", ok(50, "fixture")),
      s("2", "B", noData("no students")),
    ]);
    if (!isOk(c)) throw new Error("expected ok");
    expect(c.value.ranked).toHaveLength(1);
    expect(c.value.worst).toBe(50); // not 0, and not B
  });

  it("inverts the ranking where lower is better", () => {
    const c = compare(
      [s("1", "A", ok(10, "days pending")), s("2", "B", ok(2, "days pending"))],
      false,
    );
    if (!isOk(c)) throw new Error("expected ok");
    expect(c.value.ranked[0].sectionName).toBe("B");
    expect(c.value.best).toBe(2);
  });

  it("is no_data when no sibling is measured", () => {
    expect(compare([s("1", "A", noData("x"))]).state).toBe("no_data");
  });

  it("standing is no_data for a section that is itself unmeasured", () => {
    const st = standing(
      [s("1", "A", ok(90, "fixture")), s("2", "B", notMarked("nobody marked B"))],
      "2",
    );
    expect(st.state).toBe("no_data");
    expect(st.basis).toContain("nobody marked B");
  });

  it("places a measured section against its siblings", () => {
    const st = standing(
      [s("1", "A", ok(90, "f")), s("2", "B", ok(70, "f")), s("3", "C", ok(80, "f"))],
      "2",
    );
    expect(isOk(st)).toBe(true);
    if (!isOk(st)) return;
    expect(st.value).toMatchObject({ rank: 3, of: 3, value: 70, spreadToBest: 20 });
  });
});
