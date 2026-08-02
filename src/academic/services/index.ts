import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { AttendanceService } from "./attendanceService";
import { HomeworkService, AssignmentService } from "./homeworkService";
import { MarksService } from "./marksService";
import { RemarksService } from "./remarksService";
import { AcademicProfileService } from "./academicProfileService";
import { TestService } from "./testService";
import { PracticeService } from "./practiceService";
import { DoubtService } from "./doubtService";
import { XpService } from "./xpService";
import { BadgeService } from "./badgeService";
import { ProgressionService } from "./progressionService";
import { BattleExperienceService } from "./battleExperienceService";
import { QuestionBankService } from "./questionBankService";
import { AnnouncementService } from "./announcementService";
import { TimetableService } from "./timetableService";
import { ResourceService } from "./resourceService";
import { resolveStudentServiceContext } from "./resolveStudentContext";
import {
  progressionXpForLevel,
  progressionLevelProgress,
} from "./progressionMath";

/**
 * Facade used by panels — single entry to academic write/read APIs.
 * Prefer importing named services; this object documents the public surface.
 */
export const AcademicServices = {
  attendance: AttendanceService,
  homework: HomeworkService,
  assignment: AssignmentService,
  marks: MarksService,
  remarks: RemarksService,
  profile: AcademicProfileService,
  test: TestService,
  practice: PracticeService,
  doubt: DoubtService,
  xp: XpService,
  badge: BadgeService,
  progression: ProgressionService,
  battle: BattleExperienceService,
  questionBank: QuestionBankService,
  announcement: AnnouncementService,
  timetable: TimetableService,
  resource: ResourceService,
} as const;

export {
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
  TimetableService,
  ResourceService,
  resolveStudentServiceContext,
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  progressionXpForLevel,
  progressionLevelProgress,
  type ServiceContext,
};

export { ForbiddenError, isSchoolOperator } from "./context";
export { AnalyticsService, AiSummaryService, AuditReadService } from "./readServices";
export {
  WORK_KINDS,
  WORK_KIND_LABELS,
  TEST_KIND_LABELS,
  EXAM_TYPE_LABELS,
  assertTeacherMayManageAcademicWork,
  isPastDue,
  normalizeWorkKind,
  type WorkKind,
  type TestKind,
  type ExamType,
} from "./workLifecycle";
