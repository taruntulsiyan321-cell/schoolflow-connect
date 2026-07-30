import type { AcademicEntityKey } from "./entities";
import type { AppRole } from "@/auth/types";

/** Who may create / mutate the entity (owner module). */
export type OwnerRole = Extract<
  AppRole,
  "admin" | "principal" | "teacher" | "student" | "parent"
>;

export interface EntityOwnership {
  entity: AcademicEntityKey;
  /** Roles allowed to create/update the source record */
  owners: readonly OwnerRole[];
  /** Roles that may read (consumers) */
  consumers: readonly OwnerRole[];
  /** Human description */
  description: string;
}

/**
 * Data ownership map — every academic entity has exactly one write owner set.
 * Consumers must go through services, never write into another module's tables.
 */
export const ENTITY_OWNERSHIP: Record<AcademicEntityKey, EntityOwnership> = {
  school: {
    entity: "school",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "Tenant root; platform/admin manages",
  },
  academic_year: {
    entity: "academic_year",
    owners: ["admin", "principal"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "School calendar year",
  },
  class: {
    entity: "class",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "Class + section row",
  },
  section: {
    entity: "section",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "classes.section field",
  },
  subject: {
    entity: "subject",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "Subject catalog",
  },
  teacher: {
    entity: "teacher",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "Teacher master",
  },
  student: {
    entity: "student",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "Student master",
  },
  parent: {
    entity: "parent",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "parent"],
    description: "Parent master + links",
  },
  teacher_class_subject: {
    entity: "teacher_class_subject",
    owners: ["admin", "principal"],
    consumers: ["admin", "principal", "teacher"],
    description: "Teaching assignment",
  },
  attendance: {
    entity: "attendance",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Daily attendance — teacher creates; others consume",
  },
  homework: {
    entity: "homework",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Homework / assignment — teacher creates",
  },
  homework_submission: {
    entity: "homework_submission",
    owners: ["student", "teacher"],
    consumers: ["student", "teacher", "parent", "principal"],
    description: "Student submits; teacher grades",
  },
  assignment: {
    entity: "assignment",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Alias of homework",
  },
  assignment_submission: {
    entity: "assignment_submission",
    owners: ["student", "teacher"],
    consumers: ["student", "teacher", "parent", "principal"],
    description: "Alias of homework_submission",
  },
  test: {
    entity: "test",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Class test / DPP",
  },
  question: {
    entity: "question",
    owners: ["teacher", "admin"],
    consumers: ["teacher", "student", "admin"],
    description: "Questions attached to tests / bank",
  },
  student_test_attempt: {
    entity: "student_test_attempt",
    owners: ["student"],
    consumers: ["student", "teacher", "parent", "principal"],
    description: "Student attempt at a test",
  },
  marks: {
    entity: "marks",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Exam marks published by teacher",
  },
  examination: {
    entity: "examination",
    owners: ["teacher", "admin", "principal"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Exam definition",
  },
  examination_marks: {
    entity: "examination_marks",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Same as marks",
  },
  practice: {
    entity: "practice",
    owners: ["student"],
    consumers: ["student", "teacher", "parent", "principal"],
    description: "Practice session",
  },
  practice_attempt: {
    entity: "practice_attempt",
    owners: ["student"],
    consumers: ["student", "teacher", "parent"],
    description: "Per-question practice attempt",
  },
  student_doubt: {
    entity: "student_doubt",
    owners: ["student"],
    consumers: ["student", "teacher", "principal"],
    description: "Student-created doubt",
  },
  teacher_reply: {
    entity: "teacher_reply",
    owners: ["teacher"],
    consumers: ["teacher", "student", "principal"],
    description: "Teacher answer to a doubt",
  },
  announcement: {
    entity: "announcement",
    owners: ["admin", "principal", "teacher"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "School / class notice",
  },
  message: {
    entity: "message",
    owners: ["teacher", "student", "parent", "admin", "principal"],
    consumers: ["teacher", "student", "parent", "admin", "principal"],
    description: "Direct messages",
  },
  notification: {
    entity: "notification",
    owners: ["admin"],
    consumers: ["admin", "principal", "teacher", "student", "parent"],
    description: "System-generated; writers are sync/services (security definer)",
  },
  leave_request: {
    entity: "leave_request",
    owners: ["student", "teacher", "parent"],
    consumers: ["student", "teacher", "parent", "principal", "admin"],
    description: "Leave requests",
  },
  teacher_remark: {
    entity: "teacher_remark",
    owners: ["teacher"],
    consumers: ["teacher", "student", "parent", "principal", "admin"],
    description: "Teacher remarks on a student",
  },
  student_academic_profile: {
    entity: "student_academic_profile",
    owners: ["admin"],
    consumers: ["student", "parent", "teacher", "principal", "admin"],
    description: "Sync engine writes only; never manual UI edits",
  },
  student_performance_summary: {
    entity: "student_performance_summary",
    owners: ["admin"],
    consumers: ["student", "parent", "teacher", "principal", "admin"],
    description: "Derived from academic profile",
  },
  ai_insights: {
    entity: "ai_insights",
    owners: ["admin"],
    consumers: ["student", "teacher", "parent", "principal", "admin"],
    description: "Generated by AI services from summaries",
  },
  reports: {
    entity: "reports",
    owners: ["admin", "principal"],
    consumers: ["admin", "principal", "teacher"],
    description: "Computed reports — no fact duplication",
  },
  analytics: {
    entity: "analytics",
    owners: ["admin", "principal"],
    consumers: ["admin", "principal", "teacher"],
    description: "Computed analytics from academic records",
  },
};

export function canOwn(role: OwnerRole, entity: AcademicEntityKey): boolean {
  return ENTITY_OWNERSHIP[entity].owners.includes(role);
}

export function canConsume(role: OwnerRole, entity: AcademicEntityKey): boolean {
  return ENTITY_OWNERSHIP[entity].consumers.includes(role);
}
