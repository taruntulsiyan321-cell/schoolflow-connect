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
  XpService,
  BadgeService,
  BattleExperienceService,
  resolveStudentServiceContext,
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  WORK_KINDS,
  WORK_KIND_LABELS,
  TEST_KIND_LABELS,
  EXAM_TYPE_LABELS,
  assertTeacherMayManageAcademicWork,
  isPastDue,
  normalizeWorkKind,
  type ServiceContext,
  type WorkKind,
  type TestKind,
  type ExamType,
} from "./services";

export type { StudentXpRow } from "./services/xpService";
export type { EarnedBadgeRow } from "./services/badgeService";
export type { BattleCreateOpts } from "./services/battleExperienceService";
export type { CurriculumScope } from "./services/practiceService";

export { AcademicLiveProvider, useAcademicLive, useAcademicLiveBump, broadcastAcademicWrite } from "./live";
export {
  academicQueryKeys,
  invalidateAcademicQueries,
  notifyAcademicChange,
  subscribeAcademicChange,
  type AcademicDomain,
} from "./live";

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
  bindEnvelope,
  CAPABILITY_CATALOG,
  getCapability,
  planRoute,
  wouldCallModel,
  AiContextApis,
  askAiCoach,
  invokeAiGateway,
  AI_BILLING_UNAVAILABLE_MSG,
  isAiBillingOrCreditsIssue,
  resolveCoachCapability,
} from "./ai";

export {
  buildStudentEducationalIntelligence,
  bandFromScore,
  EIE_ALGORITHM_ID,
  MASTERY_THRESHOLDS,
} from "./eie";

export { AuditService, listAuditForEntity, listRecentAudit } from "./audit";

export {
  presentAcademicLabel,
  fixMojibake,
  displayChapter,
  displayConcept,
  displayTopic,
  displaySubject,
  canonicalizeConceptId,
  normalizeIncomingAcademicTerm,
  resolveTaxonomyDisplayPath,
  formatTaxonomyBreadcrumb,
  toPresentedTerm,
  type AcademicLabelKind,
  type TaxonomyTermRef,
  type TaxonomyPath,
} from "./taxonomy";
