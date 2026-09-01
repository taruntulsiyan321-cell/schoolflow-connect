/**
 * CHUNK 10 — golden-number tests. Fixed inputs, known expected values.
 *
 * The first fixture is the real demo school, and the first assertion is the
 * defect: the old arithmetic produced 85.94 and the answer is 92.41. Both
 * numbers are asserted, so this test fails if anyone reintroduces the mean —
 * a test that only checked 92.41 would also pass on a function that returned
 * 92.41 for the wrong reason.
 */
import { describe, it, expect } from "vitest";
import {
  ok,
  noData,
  notMarked,
  pct,
  flag,
  valueOr,
  isOk,
  type Metric,
} from "./types";
import {
  groupAttendance,
  studentAttendance,
  schoolAttendanceToday,
  consecutiveAbsence,
  belowAttendanceThreshold,
  absenceConcentration,
  attendanceByDayOfWeek,
  attendanceTrend,
  type AttendanceCounts,
} from "./attendance";
import { rollupFromProfiles, type ProfileCounts } from "./rollup";
import { reportingWindow, belowPass, ATTENDANCE_LOW } from "./thresholds";

/**
 * The demo school as it actually stands: 13 students, 146 present of 158
 * marked, and one student who has never been marked at all.
 *
 * Verified against the database before this file was written — the profile
 * counts and the raw attendance table agree, 146/158 both ways.
 */
// Copied from the database, not reconstructed. The first version of this
// fixture was built backwards from the reported percentages and came to 85.43
// under the old formula rather than 85.94 — close enough to look right and
// wrong enough to prove nothing. A golden number invented to match a golden
// number is the same defect this chunk is about, one level up.
const DEMO: AttendanceCounts[] = [
  { studentId: "never-marked", present: 0, total: 0 }, //   0.00
  { studentId: "s2", present: 9, total: 9 }, // 100.00
  { studentId: "s3", present: 10, total: 11 }, //  90.91
  { studentId: "s4", present: 10, total: 11 }, //  90.91
  { studentId: "s5", present: 10, total: 11 }, //  90.91
  { studentId: "s6", present: 11, total: 11 }, // 100.00
  { studentId: "s7", present: 11, total: 12 }, //  91.67
  { studentId: "s8", present: 11, total: 12 }, //  91.67
  { studentId: "s9", present: 11, total: 12 }, //  91.67
  { studentId: "s10", present: 11, total: 12 }, //  91.67
  { studentId: "s11", present: 12, total: 12 }, // 100.00
  { studentId: "s12", present: 20, total: 22 }, //  90.91
  { studentId: "s13", present: 20, total: 23 }, //  86.96
];

describe("the defect this chunk exists to fix", () => {
  it("computes school attendance as present ÷ marked, not the mean of percentages", () => {
    const present = DEMO.reduce((a, r) => a + r.present, 0);
    const total = DEMO.reduce((a, r) => a + r.total, 0);
    expect(present).toBe(146);
    expect(total).toBe(158);

    const m = groupAttendance(DEMO);
    expect(m.state).toBe("ok");
    expect(valueOr(m, null)).toBe(92.4);
  });

  it("does NOT produce the old mean-of-percentages figure", () => {
    // The old arithmetic: sum(pct) / count, with the never-marked student's
    // 0.00 averaged in. It came to 85.94. If this ever passes, the mean is back.
    const oldWay =
      DEMO.reduce((a, r) => a + (r.total === 0 ? 0 : (r.present / r.total) * 100), 0) / DEMO.length;
    expect(Math.round(oldWay * 100) / 100).toBeCloseTo(85.94, 1);
    expect(valueOr(groupAttendance(DEMO), null)).not.toBeCloseTo(oldWay, 1);
  });

  it("excludes a never-marked student rather than counting them absent", () => {
    const without = DEMO.filter((r) => r.total > 0);
    // Removing the never-marked student changes nothing, because they were
    // never in the calculation. Under the old mean they moved it by 7 points.
    expect(valueOr(groupAttendance(without), null)).toBe(valueOr(groupAttendance(DEMO), null));
  });

  it("weights by marked days, so a student with 2 days does not equal one with 60", () => {
    const rows: AttendanceCounts[] = [
      { studentId: "a", present: 0, total: 2 }, // 0%, barely observed
      { studentId: "b", present: 60, total: 60 }, // 100%, heavily observed
    ];
    // Mean of percentages says 50. present ÷ marked says 96.8.
    expect(valueOr(groupAttendance(rows), null)).toBe(96.8);
  });
});

describe("no_data is distinguishable from zero", () => {
  it("returns not_marked, not 0%, when nobody has been marked", () => {
    const m = groupAttendance([
      { studentId: "a", present: 0, total: 0 },
      { studentId: "b", present: 0, total: 0 },
    ]);
    expect(m.state).toBe("not_marked");
    expect(m.value).toBeNull();
    expect(valueOr(m, "—")).toBe("—");
  });

  it("returns no_data when there are no students at all", () => {
    expect(groupAttendance([]).state).toBe("no_data");
  });

  it("returns ok(0) when everyone was marked and everyone was absent", () => {
    // This is the case that MUST be zero: a real, measured 0%.
    const m = groupAttendance([{ studentId: "a", present: 0, total: 10 }]);
    expect(m.state).toBe("ok");
    expect(m.value).toBe(0);
  });

  it("keeps the two apart at the type level", () => {
    const measured = groupAttendance([{ studentId: "a", present: 0, total: 10 }]);
    const missing = groupAttendance([{ studentId: "a", present: 0, total: 0 }]);
    expect(measured.value).toBe(0);
    expect(missing.value).toBeNull();
    expect(measured.state).not.toBe(missing.state);
  });
});

describe("no threshold fires on absent data", () => {
  it("does not flag a not_marked metric as below the threshold", () => {
    const m = groupAttendance([{ studentId: "a", present: 0, total: 0 }]);
    const f = flag(m, ATTENDANCE_LOW, "below");
    expect(f.state).toBe("not_marked");
    expect(f.value).toBeNull();
    expect(f.value).not.toBe(false); // "checked, and fine" would be the lie
  });

  it("flags a real figure below the threshold", () => {
    const f = flag(pct(70, 100, "fixture"), ATTENDANCE_LOW, "below");
    expect(f.state).toBe("ok");
    expect(f.value).toBe(true);
  });

  it("leaves a never-marked student out of the below-threshold list", () => {
    const m = belowAttendanceThreshold(DEMO);
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value.below.map((b) => b.studentId)).not.toContain("never-marked");
    expect(m.value.neverMarked).toEqual(["never-marked"]);
  });
});

describe("school attendance today is driven by submissions", () => {
  it("counts only sections that submitted, in both numerator and denominator", () => {
    const m = schoolAttendanceToday([
      { sectionId: "a", submitted: true, present: 18, enrolled: 20 },
      { sectionId: "b", submitted: true, present: 27, enrolled: 30 },
      { sectionId: "c", submitted: false, present: 0, enrolled: 40 },
    ]);
    expect(valueOr(m, null)).toBe(90); // 45 of 50, not 45 of 90
    expect(m.basis).toContain("2 of 3 section(s)");
  });

  it("is not_marked, not 0%, when no section has submitted", () => {
    const m = schoolAttendanceToday([
      { sectionId: "a", submitted: false, present: 0, enrolled: 20 },
    ]);
    expect(m.state).toBe("not_marked");
  });
});

describe("consecutive absence", () => {
  const days = (statuses: string[]) =>
    statuses.map((s, i) => ({
      studentId: "a",
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      status: s,
    }));

  it("finds the longest run, not the last one", () => {
    const m = consecutiveAbsence(days(["absent", "absent", "absent", "present", "absent"]));
    expect(valueOr(m, null)).toBe(3);
  });

  it("counts a late arrival as present, breaking the run", () => {
    const m = consecutiveAbsence(days(["absent", "late", "absent"]));
    expect(valueOr(m, null)).toBe(1);
  });

  it("is no_data with no records rather than a run of zero", () => {
    expect(consecutiveAbsence([]).state).toBe("no_data");
  });
});

describe("absence concentration", () => {
  it("reports the share of absence held by the worst students", () => {
    const m = absenceConcentration(
      [
        { studentId: "a", present: 0, total: 10 }, // 10 absences
        { studentId: "b", present: 10, total: 10 },
        { studentId: "c", present: 10, total: 10 },
      ],
      1,
    );
    expect(valueOr(m, null)).toBe(100);
  });

  it("is ok(0) when nobody was absent, not no_data", () => {
    const m = absenceConcentration([{ studentId: "a", present: 10, total: 10 }]);
    expect(m.state).toBe("ok");
    expect(m.value).toBe(0);
  });
});

describe("the reporting window comes from academic_years", () => {
  const year = (over: Partial<Parameters<typeof reportingWindow>[0][number]> = {}) => ({
    id: "y1",
    name: "2026-27",
    starts_on: "2026-04-01",
    ends_on: "2027-03-31",
    is_current: true,
    ...over,
  });

  it("uses the row marked is_current", () => {
    const m = reportingWindow([year(), year({ id: "y0", is_current: false })], "2026-09-01");
    expect(isOk(m)).toBe(true);
    if (!isOk(m)) return;
    expect(m.value.startsOn).toBe("2026-04-01");
    expect(m.value.academicYearId).toBe("y1");
  });

  it("is no_data when no year is current — never a silent fallback", () => {
    const m = reportingWindow([year({ is_current: false })], "2026-09-01");
    expect(m.state).toBe("no_data");
  });

  it("is no_data when two years claim to be current, rather than picking one", () => {
    const m = reportingWindow([year(), year({ id: "y2" })], "2026-09-01");
    expect(m.state).toBe("no_data");
    expect(m.basis).toContain("ambiguous");
  });
});

describe("below pass uses exams.passing_marks and never a literal", () => {
  it("is below pass when the score is under the exam's own pass mark", () => {
    const m = belowPass(7, 8, 25);
    expect(m.state).toBe("ok");
    expect(m.value).toBe(true);
  });

  it("is not below pass at exactly the pass mark", () => {
    expect(valueOr(belowPass(8, 8, 25), null)).toBe(false);
  });

  it("is no_data — and fires no flag — when passing_marks is NULL", () => {
    const m = belowPass(7, null, 25);
    expect(m.state).toBe("no_data");
    expect(m.value).toBeNull();
    expect(m.value).not.toBe(true);
    expect(m.value).not.toBe(false);
  });

  it("is no_data when the student has no mark recorded", () => {
    expect(belowPass(null, 8, 25).state).toBe("no_data");
  });
});

describe("group rollup over profile counts", () => {
  const p = (over: Partial<ProfileCounts> = {}): ProfileCounts => ({
    attendancePresent: 0,
    attendanceTotal: 0,
    homeworkSubmitted: 0,
    homeworkAssigned: 0,
    testsAttempted: 0,
    testsAvgPct: 0,
    examsRecorded: 0,
    examsAvgPct: 0,
    ...over,
  });

  it("divides summed homework totals rather than averaging rates", () => {
    const r = rollupFromProfiles([
      p({ homeworkSubmitted: 1, homeworkAssigned: 2 }), // 50%
      p({ homeworkSubmitted: 90, homeworkAssigned: 100 }), // 90%
    ]);
    // Mean of rates: 70. Summed: 91 of 102 = 89.2.
    expect(valueOr(r.homework, null)).toBe(89.2);
  });

  it("weights test averages by how many tests each rests on", () => {
    const r = rollupFromProfiles([
      p({ testsAttempted: 1, testsAvgPct: 100 }),
      p({ testsAttempted: 9, testsAvgPct: 50 }),
    ]);
    // Mean of averages: 75. Weighted: (100 + 450) / 10 = 55.
    expect(valueOr(r.tests, null)).toBe(55);
  });

  it("says in its basis that tests and exams are weighted, not exact", () => {
    const r = rollupFromProfiles([p({ examsRecorded: 2, examsAvgPct: 60 })]);
    expect(r.exams.basis).toContain("weighted by");
  });

  it("is not_marked, not 0, where a whole group has no records", () => {
    const r = rollupFromProfiles([p(), p()]);
    expect(r.attendance.state).toBe("not_marked");
    expect(r.homework.state).toBe("not_marked");
    expect(r.tests.state).toBe("not_marked");
    expect(r.exams.state).toBe("not_marked");
  });

  it("is no_data for an empty group", () => {
    const r = rollupFromProfiles([]);
    expect(r.attendance.state).toBe("no_data");
    expect(r.studentCount).toBe(0);
  });
});

describe("every metric carries a basis", () => {
  const all: Metric<unknown>[] = [
    groupAttendance(DEMO),
    studentAttendance(DEMO[1]),
    schoolAttendanceToday([{ sectionId: "a", submitted: true, present: 1, enrolled: 2 }]),
    consecutiveAbsence([{ studentId: "a", date: "2026-01-01", status: "absent" }]),
    belowAttendanceThreshold(DEMO),
    absenceConcentration(DEMO),
    attendanceByDayOfWeek([{ studentId: "a", date: "2026-01-01", status: "present" }]),
    attendanceTrend([{ studentId: "a", date: "2026-01-01", status: "present" }]),
    ok(1, "fixture"),
    noData("fixture"),
    notMarked("fixture"),
  ];

  it("states what it was computed from, never just a number", () => {
    for (const m of all) {
      expect(typeof m.basis).toBe("string");
      expect(m.basis.length).toBeGreaterThan(0);
    }
  });

  it("names the denominator in the group attendance basis", () => {
    expect(groupAttendance(DEMO).basis).toBe(
      "146 of 158 marked day(s) across 12 of 13 student(s)",
    );
  });
});
