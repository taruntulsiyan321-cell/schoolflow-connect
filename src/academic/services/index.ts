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
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
};

export { ForbiddenError, isSchoolOperator } from "./context";
export { AnalyticsService, AiSummaryService, AuditReadService } from "./readServices";
