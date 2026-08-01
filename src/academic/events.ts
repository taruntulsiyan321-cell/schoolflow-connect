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
  "homework.unpublished",
  "homework.updated",
  "homework.archived",
  "homework.deleted",
  "homework.scheduled",
  "homework.class.refresh_chunk",
  "homework.submitted",
  "homework.resubmitted",
  "homework.reviewed",
  "homework.returned",
  "homework.graded",
  "homework.submission.created",
  "homework.submission.graded",
  "student.profile.refresh_requested",
  "test.scheduled",
  "test.published",
  "test.attempt.completed",
  "marks.published",
  "marks.updated",
  "marks.results_published",
  "examination.scheduled",
  "examination.updated",
  "examination.finalized",
  "practice.session.completed",
  "battle.created",
  "battle.joined",
  "battle.finished",
  "badge.earned",
  "xp.updated",
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
  "homework.unpublished": ["student_academic_profile", "analytics", "activity_feed", "audit"],
  "homework.updated": ["analytics", "audit"],
  "homework.archived": ["student_academic_profile", "analytics", "activity_feed", "audit"],
  "homework.deleted": ["student_academic_profile", "analytics", "activity_feed", "audit"],
  "homework.scheduled": ["notifications", "activity_feed", "audit"],
  "homework.class.refresh_chunk": ["student_academic_profile"],
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
  "student.profile.refresh_requested": ["student_academic_profile"],
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
  "marks.results_published": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "ai_insights",
    "activity_feed",
    "audit",
  ],
  "examination.scheduled": ["notifications", "activity_feed"],
  "examination.updated": ["analytics"],
  "examination.finalized": ["analytics", "activity_feed", "audit"],
  "practice.session.completed": ["student_academic_profile", "analytics", "ai_insights"],
  "battle.created": ["activity_feed", "notifications", "audit"],
  "battle.joined": ["activity_feed", "audit"],
  "battle.finished": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "activity_feed",
    "audit",
  ],
  "badge.earned": ["notifications", "activity_feed", "audit"],
  "xp.updated": ["activity_feed", "analytics"],
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
