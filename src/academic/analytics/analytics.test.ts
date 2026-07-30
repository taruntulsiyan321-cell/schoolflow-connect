import { describe, expect, it } from "vitest";
import {
  attendanceFromProfile,
  homeworkCompletionFromProfile,
  averageMarksFromProfile,
} from "@/academic/analytics";
import type { StudentAcademicProfile } from "@/academic";

const sample: StudentAcademicProfile = {
  id: "p1",
  schoolId: "s1",
  studentId: "st1",
  academicYearId: null,
  attendancePresent: 18,
  attendanceTotal: 20,
  attendancePct: 90,
  homeworkAssigned: 10,
  homeworkSubmitted: 8,
  homeworkCompletionPct: 80,
  testsAttempted: 3,
  testsAvgPct: 70,
  examsRecorded: 2,
  examsAvgPct: 85,
  practiceSessions: 5,
  practiceAccuracyPct: 72,
  doubtsAsked: 4,
  doubtsResolved: 2,
  remarksCount: 1,
  metrics: { weakTopics: ["Algebra"], strongTopics: ["Geometry"] },
  lastEventType: "marks.published",
  lastEventAt: null,
  refreshedAt: new Date().toISOString(),
};

describe("analytics foundation", () => {
  it("derives attendance/homework/marks from profile without duplicating facts", () => {
    expect(attendanceFromProfile(sample)).toEqual({ present: 18, total: 20, pct: 90 });
    expect(homeworkCompletionFromProfile(sample).pct).toBe(80);
    expect(averageMarksFromProfile(sample).averagePct).toBe(85);
  });
});
