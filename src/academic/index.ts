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
