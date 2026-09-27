/**
 * Gurukul Academic Engine
 *
 * Phase 1 (this package): schema contracts, ownership, events, tenant helpers, validation.
 * Later phases add repositories, domain services, sync processor, analytics/AI facades.
 */

export {
  ENTITY_REGISTRY,
  tableFor,
} from "./entities";

export {
  ENTITY_OWNERSHIP,
  canOwn,
  canConsume,
} from "./ownership";

export {
  ACADEMIC_EVENT_TYPES,
  syncTargetsFor,
} from "./events";

export type {
  StudentAcademicProfile,
  TeacherRemark,
} from "./types";

export {
  requireSchoolId,
  MissingSchoolContextError,
} from "./tenant";

export {
  validateMarks,
  validateAttendanceDate,
  validateAcademicYearRange,
} from "./validation/rules";

export * as academicRepo from "./repository";

export {
  AttendanceService,
  HomeworkService,
  MarksService,
  RemarksService,
  AcademicProfileService,
  TestService,
  PracticeService,
  RecoveryEngineService,
  DoubtService,
  XpService,
  BadgeService,
  ProgressionService,
  BattleExperienceService,
  QuestionBankService,
  QuestionPaperService,
  CurriculumService,
  AnnouncementService,
  LeaveService,
  TimetableService,
  CalendarEventsService,
  ResourceService,
  resolveStudentServiceContext,
  WORK_KINDS,
  WORK_KIND_LABELS,
  TEST_KIND_LABELS,
  EXAM_TYPE_LABELS,
  type ServiceContext,
  type WorkKind,
  type TestKind,
} from "./services";
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
  TeacherProgressionInsights,
} from "./services/progressionService";
export type { CurriculumScope } from "./services/practiceService";
export type { PracticeSessionRow } from "./services/practiceService";
export {
  StudentUploadService,
} from "./services/studentUploadService";
export type {
  ChapterStateRow,
  RecoveryQueueRow,
  RecoverySessionOutcome,
  ClearAnywayOutcome,
  RevisionSessionOutcome,
  RevisionHistoryRow,
} from "./services/recoveryEngineService";
export type { QuestionReviewRow } from "./services/questionBankService";
export type {
  QuestionPaperRow,
  QuestionPaperSectionRow,
  QuestionPaperQuestionRow,
  PaperSectionFormat,
  PaperDifficulty,
  SectionFillResult,
  GenerationOutcome,
} from "./services/questionPaperService";
export type { CurriculumChapter, CurriculumTopic } from "./services/curriculumService";
export type {
  TeacherAnnouncementRow,
  AnnouncementPriority,
  AnnouncementStatus,
} from "./services/announcementService";
export type { SchoolLeaveRequestRow } from "./services/leaveService";
export { decisionAttribution, matchesStatus } from "./services/leaveService";
export { useAcademicLive } from "./live";

export type {
  AttendanceRecord,
  AttendanceStatus,
  AssignedClass,
  ClassStudentRow,
  ParentChildRow,
} from "./services/attendanceService";

export type {
  StudentHomeworkRow,
  ReviewRow,
  ClassHomeworkRow,
  ManagedHomeworkRow,
  SchoolHomeworkRow,
  HomeworkStanding,
} from "./services/homeworkService";
export {
  homeworkStanding,
  homeworkOutcome,
  homeworkHasClosed,
  canHandIn,
  HOMEWORK_STANDING_LABELS,
  HOMEWORK_QUESTION_FILE_PICKER,
  HOMEWORK_HAND_IN_FILE_PICKER,
} from "./services/homeworkService";
export type { CalendarEvent, CalendarEventType, CalendarEventAudience } from "./services/calendarEventsService";
export type { LearningResourceRow, ResourceKind } from "./services/resourceService";
export { RESOURCE_KINDS } from "./services/resourceService";
export {
  uploadDoubtAttachment,
  signedDoubtUrl,
  DOUBT_FILE_ACCEPT,
  type DoubtUploadMeta,
} from "./storage/doubtFileUpload";

export { AnalyticsService, AiSummaryService } from "./services/readServices";

export { useAcademicContext } from "./hooks/useAcademicContext";

export {
  buildParentScheduledNarrative,
  type ParentNarrative,
} from "./ai";

export {
  WEAK_CONCEPT_THRESHOLD,
  computeAttendanceRisk,
  computeDoubtUrgency,
  RiskBadge,
  riskReasonText,
} from "./eie";
