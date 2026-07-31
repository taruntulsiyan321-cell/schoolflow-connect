/**
 * Gurukul Academic Engine
 *
 * Phase 1 (this package): schema contracts, ownership, events, tenant helpers, validation.
 * Later phases add repositories, domain services, sync processor, analytics/AI facades.
 */

export {
  ENTITY_REGISTRY,
  tableFor,
  assertTenantScoped,
  type AcademicEntityKey,
  type EntityMapping,
} from "./entities";

export {
  ENTITY_OWNERSHIP,
  canOwn,
  canConsume,
  type EntityOwnership,
  type OwnerRole,
} from "./ownership";

export {
  ACADEMIC_EVENT_TYPES,
  EVENT_SYNC_TARGETS,
  isAcademicEventType,
  syncTargetsFor,
  type AcademicEventType,
  type AcademicEventStatus,
  type AcademicEventRecord,
  type SyncTarget,
} from "./events";

export type {
  AcademicYear,
  StudentAcademicProfile,
  TeacherRemark,
  AcademicAuditEntry,
  StudentAiSummary,
  ClassAiSummary,
  SchoolAiSummary,
  ValidationIssue,
  ValidationResult,
} from "./types";

export {
  requireSchoolId,
  resolveSchoolId,
  scopeBySchool,
  MissingSchoolContextError,
} from "./tenant";

export {
  validateMarks,
  validateAttendanceDate,
  validateAcademicYearRange,
  validateRemarkBody,
  validateTeacherSubjectAssignment,
} from "./validation/rules";

export * as academicRepo from "./repository";

export {
  AcademicServices,
  AttendanceService,
  HomeworkService,
  AssignmentService,
  MarksService,
  RemarksService,
  AcademicProfileService,
  TestService,
  PracticeService,
  DoubtService,
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./services";

export type {
  AttendanceRecord,
  AttendanceStatus,
  UpsertAttendanceInput,
  AssignedClass,
  ClassStudentRow,
  ParentChildRow,
} from "./services/attendanceService";

export type { StudentHomeworkRow, SchoolHomeworkSummary, HomeworkClassStatsRow } from "./services/homeworkService";

export { AnalyticsService, AiSummaryService, AuditReadService } from "./services/readServices";

export { useAcademicContext } from "./hooks/useAcademicContext";

export {
  SyncEngine,
  processPendingEvents,
  processEvent,
  refreshStudentProfile,
  plannedTargets,
  type SyncRunResult,
} from "./sync";

export {
  AnalyticsFoundation,
  getStudentAnalytics,
  getClassPerformance,
  getSchoolPerformance,
} from "./analytics";

export {
  AiDataLayer,
  buildStudentAiSummary,
  buildClassAiSummary,
  buildSchoolAiSummary,
  buildTeacherAiSummary,
} from "./ai";

export { AuditService, listAuditForEntity, listRecentAudit } from "./audit";
