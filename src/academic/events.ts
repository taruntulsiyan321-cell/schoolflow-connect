/**
 * Academic event catalog — every academic action emits one of these.
 * The database fans each out to profile / notifications / analytics / AI /
 * audit: `process_academic_event`, drained every minute by the
 * `process-pending-academic-events` job (20260925120000). `EVENT_SYNC_TARGETS`
 * documents that fan-out; nothing in the client runs it.
 *
 * REMOVED 2026-09-06: `homework.assigned`, `homework.submission.created` and
 * `homework.submission.graded`. They were never emitted by anything, because
 * they were ALIASES of three types that already fire —
 * `homework.published`, `homework.submitted` and `homework.graded` — from the
 * live triggers `trg_emit_homework_event` and
 * `trg_emit_homework_submission_event`, which have produced 313 events. Each
 * alias mapped to exactly the same fan-out as the name actually emitted, and
 * the SQL consumers accept both spellings (20260731090000:434,439,469).
 *
 * They read as missing emitters to every session that saw them. Wiring one
 * would have emitted a SECOND event per action and doubled every homework
 * notification, analytics row and audit entry. Removed so the gap stops
 * looking like work. See KNOWN_ISSUES 10.
 *
 * REMOVED 2026-09-13: `homework.graded`. Homework has two decisions and no
 * grade (20260925110000): accepting emits `homework.reviewed` and rejecting
 * `homework.returned`, the names the notification router already routes.
 * Nothing emits `homework.graded` any more.
 */

export const ACADEMIC_EVENT_TYPES = [
  "attendance.marked",
  "attendance.updated",
  "homework.created",
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
  "examination.deleted",
  "practice.session.completed",
  "practice.weak_areas.path_used",
  "practice.weak_areas.v2_failed",
  "battle.created",
  "battle.joined",
  "battle.finished",
  "badge.earned",
  "achievement.earned",
  "league.promoted",
  "league.demoted",
  "xp.updated",
  "doubt.created",
  "doubt.replied",
  "doubt.solved",
  "announcement.published",
  "leave.requested",
  "leave.reviewed",
  "remark.created",
  "question.bank.saved",
  "student.profile.refreshed",
  "role.changed",
] as const;

type AcademicEventType = (typeof ACADEMIC_EVENT_TYPES)[number];



type SyncTarget =
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
  "audit",
];

const EVENT_SYNC_TARGETS: Record<AcademicEventType, readonly SyncTarget[]> = {
  "attendance.marked": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "ai_insights",
    "audit",
  ],
  "attendance.updated": ["student_academic_profile", "analytics", "ai_insights", "audit"],
  "homework.created": ["audit"],
  "homework.published": HW_FULL,
  "homework.unpublished": ["student_academic_profile", "analytics", "audit"],
  "homework.updated": ["analytics", "audit"],
  "homework.archived": ["student_academic_profile", "analytics", "audit"],
  "homework.deleted": ["student_academic_profile", "analytics", "audit"],
  "homework.scheduled": ["notifications", "audit"],
  "homework.class.refresh_chunk": ["student_academic_profile"],
  "homework.submitted": ["student_academic_profile", "notifications", "analytics", "audit"],
  "homework.resubmitted": ["student_academic_profile", "notifications", "analytics", "audit"],
  "homework.reviewed": HW_FULL,
  "homework.returned": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "audit",
  ],
  "student.profile.refresh_requested": ["student_academic_profile"],
  "test.scheduled": ["notifications"],
  "test.published": ["notifications"],
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
    "audit",
  ],
  "marks.updated": ["student_academic_profile", "analytics", "ai_insights", "audit"],
  "marks.results_published": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "ai_insights",
    "audit",
  ],
  "examination.scheduled": ["notifications"],
  "examination.updated": ["analytics"],
  "examination.finalized": ["analytics", "audit"],
  "examination.deleted": ["analytics", "audit", "student_academic_profile"],
  // §10.8: no practice fact reaches the activity feed, which the whole school
  // reads. process_academic_event holds the same line for every practice.*
  // type (20261042000000).
  "practice.session.completed": ["student_academic_profile", "analytics", "ai_insights"],
  // Rollout telemetry, read only by rpc_decision_engine_rollout_summary_v1.
  "practice.weak_areas.path_used": ["analytics"],
  "practice.weak_areas.v2_failed": ["analytics"],
  "battle.created": ["notifications", "audit"],
  "battle.joined": ["audit"],
  "battle.finished": [
    "student_academic_profile",
    "notifications",
    "analytics",
    "audit",
  ],
  "badge.earned": ["notifications", "audit"],
  "achievement.earned": ["notifications", "audit", "ai_insights"],
  "league.promoted": ["notifications", "audit"],
  "league.demoted": ["notifications", "audit"],
  "xp.updated": ["analytics", "ai_insights", "student_academic_profile"],
  "doubt.created": ["notifications", "analytics", "ai_insights"],
  "doubt.replied": ["notifications", "student_academic_profile", "ai_insights"],
  "doubt.solved": [
    "notifications",
    "student_academic_profile",
    "analytics",
    "ai_insights",
    "audit",
  ],
  "announcement.published": ["notifications", "audit"],
  "leave.requested": ["notifications"],
  "leave.reviewed": ["notifications", "audit"],
  "remark.created": [
    "student_academic_profile",
    "notifications",
    "ai_insights",
  ],
  "question.bank.saved": ["audit"],
  "student.profile.refreshed": ["analytics", "ai_insights"],
  "role.changed": ["audit", "notifications"],
};

function isAcademicEventType(value: string): value is AcademicEventType {
  return (ACADEMIC_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Whether the router copies an event to school_activity_feed — the rule as
 * process_academic_event states it: every event except the two refresh
 * signals and, by §10.8, any practice event. ONE rule rather than a feed
 * entry per type: the per-type entries had drifted from the router on twelve
 * types (KNOWN_ISSUES 61). Since 20261134000000 only staff read the feed.
 */
function reachesActivityFeed(eventType: string): boolean {
  if (eventType.startsWith("practice.")) return false;
  return eventType !== "student.profile.refresh_requested" && eventType !== "homework.class.refresh_chunk";
}

export function syncTargetsFor(eventType: string): readonly SyncTarget[] {
  const listed = isAcademicEventType(eventType) ? EVENT_SYNC_TARGETS[eventType] : [];
  return reachesActivityFeed(eventType) ? [...listed, "activity_feed"] : listed;
}
