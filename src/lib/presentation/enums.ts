/**
 * Enum presentation boundary.
 *
 * WHY THIS EXISTS
 * ---------------
 * Database enum values are internal tokens: `half_day`, `in_progress`,
 * `surprise_test`, `beat_topper`. Panels rendered them directly — sometimes
 * with a CSS `capitalize`, which turns `half_day` into `Half_day` rather than
 * fixing anything.
 *
 * There was no registry, so every page invented its own handling (or none).
 * This module is the single source of user-facing enum labels.
 *
 * FAIL-SAFE BEHAVIOUR
 * -------------------
 * `toEnumLabel` never returns a raw token. An unregistered value is humanized
 * (`snake_case` to `Title Case`), so a new enum added tomorrow degrades to a
 * readable label instead of leaking an internal one.
 */

import { toDisplayText } from "./safeText";

/** Every enum family the UI presents. Keys mirror the Postgres enum names. */
export type EnumDomain =
  | "attendance_status"
  | "leave_status"
  | "leave_applicant"
  | "leave_type"
  | "fee_status"
  | "exam_type"
  | "test_kind"
  | "test_status"
  | "homework_status"
  | "homework_priority"
  | "submission_status"
  | "announcement_status"
  | "announcement_priority"
  | "notice_priority"
  | "notice_audience"
  | "calendar_event_type"
  | "case_status"
  | "doubt_status"
  | "battle_status"
  | "battle_type"
  | "badge_tier"
  | "dpp_attempt_status"
  | "dpp_question_kind"
  | "app_role"
  | "person_status"
  | "gender_type"
  | "resource_type"
  | "academic_year_status"
  | "academic_event_status"
  | "featured_kind"
  | "budget_forecast_status"
  | "severity";

type LabelMap = Record<string, string>;

const LABELS: Record<EnumDomain, LabelMap> = {
  attendance_status: {
    present: "Present",
    absent: "Absent",
    late: "Late",
    leave: "On leave",
    half_day: "Half day",
  },
  leave_status: {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
  },
  leave_applicant: {
    student: "Student",
    teacher: "Teacher",
  },
  leave_type: {
    casual: "Casual leave",
    sick: "Sick leave",
    earned: "Earned leave",
    maternity: "Maternity leave",
    paternity: "Paternity leave",
    emergency: "Emergency leave",
    unpaid: "Unpaid leave",
    other: "Other leave",
  },
  fee_status: {
    paid: "Paid",
    unpaid: "Unpaid",
    partial: "Partly paid",
  },
  exam_type: {
    class_test: "Class test",
    unit_test: "Unit test",
    half_yearly: "Half yearly",
    final: "Final exam",
    monthly_test: "Monthly test",
    mid_term: "Mid term",
    annual: "Annual exam",
    practical: "Practical",
    viva: "Viva",
    internal: "Internal assessment",
    surprise_test: "Surprise test",
    other: "Other",
  },
  test_kind: {
    class_test: "Class test",
    unit_test: "Unit test",
    surprise_test: "Surprise test",
    monthly_test: "Monthly test",
  },
  test_status: {
    draft: "Draft",
    scheduled: "Scheduled",
    published: "Published",
    archived: "Archived",
  },
  homework_status: {
    draft: "Draft",
    scheduled: "Scheduled",
    published: "Published",
    archived: "Archived",
  },
  homework_priority: {
    low: "Low",
    normal: "Normal",
    high: "High",
    urgent: "Urgent",
  },
  submission_status: {
    pending: "Not submitted",
    submitted: "Submitted",
    graded: "Graded",
    returned: "Returned",
    late: "Submitted late",
  },
  announcement_status: {
    draft: "Draft",
    published: "Published",
    scheduled: "Scheduled",
  },
  announcement_priority: {
    normal: "Normal",
    important: "Important",
    urgent: "Urgent",
  },
  notice_priority: {
    low: "Low",
    normal: "Normal",
    high: "High",
    urgent: "Urgent",
  },
  notice_audience: {
    all: "Everyone",
    class: "A class",
    section: "A section",
    teachers: "Teachers",
    parents: "Parents",
    students: "Students",
  },
  calendar_event_type: {
    holiday: "Holiday",
    exam: "Exam",
    meeting: "Meeting",
    sports: "Sports",
    cultural: "Cultural",
    deadline: "Deadline",
    other: "Other",
  },
  case_status: {
    open: "Open",
    in_progress: "In progress",
    resolved: "Resolved",
    closed: "Closed",
  },
  doubt_status: {
    open: "Open",
    unsolved: "Unsolved",
    solved: "Solved",
    teacher_answered: "Teacher answered",
    community_solved: "Solved by community",
  },
  battle_status: {
    scheduled: "Scheduled",
    live: "Live",
    finished: "Finished",
    cancelled: "Cancelled",
    waiting: "Waiting",
    active: "In progress",
    completed: "Completed",
    won: "Won",
    lost: "Lost",
    draw: "Draw",
    expired: "Expired",
  },
  battle_type: {
    mcq: "MCQ",
    rapid: "Rapid fire",
    timed: "Timed",
    daily: "Daily",
  },
  badge_tier: {
    bronze: "Bronze",
    silver: "Silver",
    gold: "Gold",
    platinum: "Platinum",
  },
  dpp_attempt_status: {
    in_progress: "In progress",
    submitted: "Submitted",
  },
  dpp_question_kind: {
    mcq: "Multiple choice",
    multi: "Multiple answers",
    numerical: "Numerical",
    short: "Short answer",
  },
  app_role: {
    admin: "Admin",
    teacher: "Teacher",
    student: "Student",
    parent: "Parent",
    principal: "Principal",
    super_admin: "Super admin",
  },
  person_status: {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
    alumni: "Alumni",
  },
  gender_type: {
    male: "Male",
    female: "Female",
    other: "Other",
    unspecified: "Not specified",
  },
  resource_type: {
    pdf: "PDF",
    video: "Video",
    link: "Link",
    notes: "Notes",
    worksheet: "Worksheet",
    presentation: "Presentation",
    other: "Other",
  },
  academic_year_status: {
    planned: "Planned",
    active: "Active",
    closed: "Closed",
    archived: "Archived",
  },
  academic_event_status: {
    pending: "Pending",
    processing: "Processing",
    processed: "Processed",
    failed: "Failed",
    skipped: "Skipped",
  },
  featured_kind: {
    daily: "Daily Challenge",
    weekly: "Weekly Championship",
    ncert: "NCERT Challenge",
    beat_topper: "Beat the Topper",
    teacher: "Teacher Challenge",
  },
  budget_forecast_status: {
    ok: "On track",
    watch: "Watch",
    warn: "Warning",
    critical: "Critical",
    insufficient_data: "Not enough data yet",
  },
  severity: {
    low: "Low",
    medium: "Medium",
    high: "High",
    critical: "Critical",
  },
};

/** Acronyms that must not be title-cased into `Mcq` / `Pdf`. */
const ACRONYMS = new Set(["mcq", "pdf", "xp", "ai", "dpp", "sms", "otp", "url", "id"]);

/**
 * Turn an unregistered token into something readable.
 * `half_day` -> `Half day`, `in_progress` -> `In progress`.
 */
export function humanizeEnumValue(value: string): string {
  const parts = value
    .trim()
    .replace(/[-\s]+/g, "_")
    .split("_")
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((part, i) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (i === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(" ");
}

export interface EnumLabelOptions {
  /** Shown when the value is missing or unusable. */
  fallback?: string;
}

/**
 * The user-facing label for an enum value.
 *
 * ```tsx
 * <td>{toEnumLabel(row.status, "attendance_status")}</td>
 * ```
 *
 * Never returns the raw token: registered values use the curated label,
 * unregistered ones are humanized.
 */
export function toEnumLabel(
  value: unknown,
  domain: EnumDomain,
  options: EnumLabelOptions = {},
): string {
  const fallback = options.fallback ?? "—";
  const raw = toDisplayText(value, { kind: "label", fallback: "", allowEmpty: true });
  if (!raw) return fallback;

  const key = raw.trim().toLowerCase();
  const mapped = LABELS[domain]?.[key];
  if (mapped) return mapped;

  const humanized = humanizeEnumValue(raw);
  return humanized || fallback;
}

/** Every registered value for a domain — for building selects and filters. */
export function enumOptions(domain: EnumDomain): Array<{ value: string; label: string }> {
  return Object.entries(LABELS[domain] ?? {}).map(([value, label]) => ({ value, label }));
}

/** True when the value is a known member of the domain. */
export function isKnownEnumValue(value: unknown, domain: EnumDomain): boolean {
  if (typeof value !== "string") return false;
  const map = LABELS[domain];
  if (!map) return false;
  return Object.prototype.hasOwnProperty.call(map, value.trim().toLowerCase());
}
