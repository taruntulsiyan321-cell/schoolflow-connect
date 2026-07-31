/**
 * Academic event catalog — every academic action emits one of these.
 * Sync engine fans out to profile / notifications / analytics / AI / audit.
 */

export const ACADEMIC_EVENT_TYPES = [
  "attendance.marked",
  "attendance.updated",
  "homework.created",
  "homework.assigned",
  "homework.published",
  "homework.updated",
  "homework.archived",
  "homework.deleted",
  "homework.submitted",
  "homework.resubmitted",
  "homework.reviewed",
  "homework.returned",
  "homework.graded",
  "homework.submission.created",
  "homework.submission.graded",
  "test.scheduled",
  "test.published",
  "test.attempt.completed",
  "marks.published",
  "marks.updated",
  "examination.scheduled",
  "examination.updated",
  "practice.session.completed",
  "doubt.created",
  "doubt.replied",
  "announcement.published",
  "leave.requested",
  "leave.reviewed",
  "remark.created",
  "student.profile.refreshed",
  "role.changed",
] as const;

export type AcademicEventType = (typeof ACADEMIC_EVENT_TYPES)[number];

export type AcademicEventStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "skipped";

export interface AcademicEventRecord {
  id: string;
  schoolId: string;
  eventType: AcademicEventType | string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  studentId: string | null;
  classId: string | null;
  teacherId: string | null;
  payload: Record<string, unknown>;
  status: AcademicEventStatus;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export type SyncTarget =
  | "student_academic_profile"
  | "notifications"
  | "analytics"
  | "ai_insights"
  | "activity_feed"
  | "audit";

const HW_FULL: readonly SyncTarget[] = [
  "student_academic_profile",
  "notifications",
  "analytics",
  "ai_insights",
  "activity_feed",
  "audit",
];

export const EVENT_SYNC_TARGETS: Record<AcademicEventType, readonly SyncTarget[]> = {
  "attendance.marked": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "ai_insights",
    "activity_feed",
    "audit",
  ],
  "attendance.updated": ["student_academic_profile", "analytics", "ai_insights", "audit"],
  "homework.created": ["audit", "activity_feed"],
  "homework.assigned": HW_FULL,
  "homework.published": HW_FULL,
  "homework.updated": ["student_academic_profile", "analytics", "audit"],
  "homework.archived": ["student_academic_profile", "analytics", "activity_feed", "audit"],
  "homework.deleted": ["student_academic_profile", "analytics", "activity_feed", "audit"],
  "homework.submitted": ["student_academic_profile", "notifications", "analytics", "audit"],
  "homework.resubmitted": ["student_academic_profile", "notifications", "analytics", "audit"],
  "homework.reviewed": HW_FULL,
  "homework.returned": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "activity_feed",
    "audit",
  ],
  "homework.graded": HW_FULL,
  "homework.submission.created": ["student_academic_profile", "notifications", "analytics", "audit"],
  "homework.submission.graded": HW_FULL,
  "test.scheduled": ["notifications", "activity_feed"],
  "test.published": ["notifications", "activity_feed"],
  "test.attempt.completed": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "ai_insights",
  ],
  "marks.published": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "ai_insights",
    "activity_feed",
    "audit",
  ],
  "marks.updated": ["student_academic_profile", "analytics", "ai_insights", "audit"],
  "examination.scheduled": ["notifications", "activity_feed"],
  "examination.updated": ["analytics"],
  "practice.session.completed": ["student_academic_profile", "analytics", "ai_insights"],
  "doubt.created": ["notifications", "analytics", "ai_insights"],
  "doubt.replied": ["notifications", "student_academic_profile", "ai_insights"],
  "announcement.published": ["notifications", "activity_feed", "audit"],
  "leave.requested": ["notifications", "activity_feed"],
  "leave.reviewed": ["notifications", "audit"],
  "remark.created": [
    "student_academic_profile",
    "notifications",
    "ai_insights",
    "activity_feed",
  ],
  "student.profile.refreshed": ["analytics", "ai_insights"],
  "role.changed": ["audit", "notifications"],
};

export function isAcademicEventType(value: string): value is AcademicEventType {
  return (ACADEMIC_EVENT_TYPES as readonly string[]).includes(value);
}

export function syncTargetsFor(eventType: string): readonly SyncTarget[] {
  if (!isAcademicEventType(eventType)) return ["activity_feed"];
  return EVENT_SYNC_TARGETS[eventType];
}
