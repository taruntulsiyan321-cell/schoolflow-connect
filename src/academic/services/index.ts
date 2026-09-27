import {
  type ServiceContext,
} from "./context";
import { AttendanceService } from "./attendanceService";
import { HomeworkService } from "./homeworkService";
import { MarksService } from "./marksService";
import { RemarksService } from "./remarksService";
import { AcademicProfileService } from "./academicProfileService";
import { TestService } from "./testService";
import { PracticeService } from "./practiceService";
import { RecoveryEngineService } from "./recoveryEngineService";
import { DoubtService } from "./doubtService";
import { XpService } from "./xpService";
import { BadgeService } from "./badgeService";
import { ProgressionService } from "./progressionService";
import { BattleExperienceService } from "./battleExperienceService";
import { QuestionBankService } from "./questionBankService";
import { QuestionPaperService } from "./questionPaperService";
import { CurriculumService } from "./curriculumService";
import { AnnouncementService } from "./announcementService";
import { LeaveService } from "./leaveService";
import { TimetableService } from "./timetableService";
import { CalendarEventsService } from "./calendarEventsService";
import { ResourceService } from "./resourceService";
import { resolveStudentServiceContext } from "./resolveStudentContext";


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
  type ServiceContext,
};
export {
  WORK_KINDS,
  WORK_KIND_LABELS,
  TEST_KIND_LABELS,
  EXAM_TYPE_LABELS,
  type WorkKind,
  type TestKind,
} from "./workLifecycle";
