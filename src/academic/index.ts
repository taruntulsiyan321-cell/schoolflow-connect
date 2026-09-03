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
  ProgressionService,
  BattleExperienceService,
  QuestionBankService,
  AnnouncementService,
  LeaveService,
  MessageService,
  TimetableService,
  CalendarEventsService,
  ResourceService,
  resolveStudentServiceContext,
  assertStudentContext,
  assertStudentClassContext,
  evaluateStudentContext,
  studentShellReady,
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  progressionXpForLevel,
  progressionLevelProgress,
  progressionLeagueFromXp,
  progressionLeagueFromCodeOrXp,
  PROGRESSION_LEAGUES,
  WORK_KINDS,
  WORK_KIND_LABELS,
  TEST_KIND_LABELS,
  EXAM_TYPE_LABELS,
  assertTeacherMayManageAcademicWork,
  isPastDue,
  normalizeWorkKind,
  loadStudentAcademicIdentity,
  identityToServiceContext,
  type ServiceContext,
  type WorkKind,
  type TestKind,
  type ExamType,
  type StudentAcademicIdentity,
} from "./services";

export type { StudentXpRow } from "./services/xpService";
export type { EarnedBadgeRow } from "./services/badgeService";
export type {
  DoubtRow,
  DoubtAnswerRow,
  DoubtAttachmentRow,
  DoubtStatus,
  TeacherDoubtDashboard,
} from "./services/doubtService";

export type {
  ProgressionSnapshot,
  ProgressionApplyResult,
  TeacherProgressionInsights,
  ProgressionLeaderboard,
} from "./services/progressionService";
export type { BattleCreateOpts } from "./services/battleExperienceService";
export type { CurriculumScope } from "./services/practiceService";
export type { PracticeSessionRow } from "./services/practiceService";
export type { QuestionBankInsertRow } from "./services/questionBankService";
export type {
  TeacherAnnouncementRow,
  UpsertAnnouncementInput,
  AnnouncementPriority,
  AnnouncementStatus,
} from "./services/announcementService";
export type { LeaveRequestRow, SchoolLeaveRequestRow, LeaveDecisionRow } from "./services/leaveService";
export { decisionAttribution, matchesStatus } from "./services/leaveService";
export type {
  ChatContact,
  ChatMessage,
  ChatAttachment,
  ChatSearchHit,
} from "./services/messageService";

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
export type { ClassTimetableSnapshot } from "./services/timetableService";
export type { CalendarEvent, CalendarEventType, CalendarEventAudience } from "./services/calendarEventsService";
export type { LearningResourceRow } from "./services/resourceService";
export {
  uploadDoubtAttachment,
  signedDoubtUrl,
  DOUBT_FILE_ACCEPT,
  type DoubtUploadMeta,
} from "./storage/doubtFileUpload";

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
  buildSchoolHealthBrief,
  type SchoolHealthBrief,
  type SchoolHealthAggregateInput,
  buildParentScheduledNarrative,
  type ParentNarrative,
  type ParentNarrativeInput,
} from "./ai";

export {
  buildStudentEducationalIntelligence,
  bandFromScore,
  EIE_ALGORITHM_ID,
  MASTERY_THRESHOLDS,
  WEAK_CONCEPT_THRESHOLD,
  computeAttendanceRisk,
  computeHomeworkConsistency,
  buildSchoolRiskRollups,
  computeDoubtUrgency,
  RiskBadge,
  riskReasonText,
  type RiskBand,
  type ProfileRollupRow,
  type SchoolRiskRollup,
  type DoubtUrgencyProduct,
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
