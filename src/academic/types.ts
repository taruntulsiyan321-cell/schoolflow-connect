/**
 * Domain types for the Academic Engine (Phase 1).
 * These are application-level shapes — not a second database.
 */

export interface AcademicYear {
  id: string;
  schoolId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: "planned" | "active" | "closed" | "archived";
  isCurrent: boolean;
}

export interface StudentAcademicProfile {
  id: string;
  schoolId: string;
  studentId: string;
  academicYearId: string | null;
  attendancePresent: number;
  attendanceTotal: number;
  attendancePct: number;
  homeworkAssigned: number;
  homeworkSubmitted: number;
  homeworkCompletionPct: number;
  /** EIE-computed risk bands (server-persisted, src/academic/eie/riskProducts.ts thresholds). */
  attendanceRiskBand: "low" | "moderate" | "elevated" | "high" | "unknown";
  homeworkConsistencyBand: "low" | "moderate" | "elevated" | "high" | "unknown";
  testsAttempted: number;
  testsAvgPct: number;
  examsRecorded: number;
  examsAvgPct: number;
  practiceSessions: number;
  practiceAccuracyPct: number;
  doubtsAsked: number;
  doubtsResolved: number;
  remarksCount: number;
  metrics: Record<string, unknown>;
  lastEventType: string | null;
  lastEventAt: string | null;
  refreshedAt: string;
}

export interface TeacherRemark {
  id: string;
  schoolId: string;
  studentId: string;
  teacherId: string;
  classId: string | null;
  subjectId: string | null;
  academicYearId: string | null;
  remarkType: string;
  body: string;
  visibility: string;
  createdBy: string | null;
  createdAt: string;
}

export interface AcademicAuditEntry {
  id: string;
  schoolId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Structured summaries consumed by the AI layer (never raw multi-table dumps). */
export interface StudentAiSummary {
  studentId: string;
  schoolId: string;
  attendancePct: number;
  homeworkCompletionPct: number;
  testsAvgPct: number;
  examsAvgPct: number;
  practiceAccuracyPct: number;
  doubtsAsked: number;
  doubtsResolved: number;
  weakTopics: string[];
  strongTopics: string[];
  trends: Record<string, unknown>;
}

export interface ClassAiSummary {
  classId: string;
  schoolId: string;
  studentCount: number;
  avgAttendancePct: number;
  avgHomeworkCompletionPct: number;
  avgMarksPct: number;
}

export interface SchoolAiSummary {
  schoolId: string;
  classCount: number;
  studentCount: number;
  teacherCount: number;
  avgAttendancePct: number;
  avgHomeworkCompletionPct: number;
  avgMarksPct: number;
}

export type ValidationIssue = {
  field: string;
  code: string;
  message: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };
