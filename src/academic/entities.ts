/**
 * Gurukul Academic Engine — Phase 1 domain contracts.
 *
 * This module is the single source of truth for:
 * - Entity → table mapping (no duplicate academic facts)
 * - Data ownership (who creates / who consumes)
 * - Event catalog (what sync engine reacts to)
 * - Multi-tenant scoping helpers
 *
 * UI panels must not invent parallel schemas. Import from `@/academic`.
 */

export type AcademicEntityKey =
  | "school"
  | "academic_year"
  | "class"
  | "section"
  | "subject"
  | "teacher"
  | "student"
  | "parent"
  | "teacher_class_subject"
  | "attendance"
  | "homework"
  | "homework_submission"
  | "assignment"
  | "assignment_submission"
  | "test"
  | "question"
  | "student_test_attempt"
  | "marks"
  | "examination"
  | "examination_marks"
  | "practice"
  | "practice_attempt"
  | "battle"
  | "student_xp"
  | "student_badge"
  | "student_doubt"
  | "teacher_reply"
  | "learning_resource"
  | "announcement"
  | "message"
  | "notification"
  | "leave_request"
  | "teacher_remark"
  | "student_academic_profile"
  | "student_performance_summary"
  | "ai_insights"
  | "reports"
  | "analytics";

/** Physical storage for a domain entity (one source of truth). */
export interface EntityMapping {
  key: AcademicEntityKey;
  /** Canonical Postgres table (or view) */
  table: string;
  /** Alternate product names that must NOT get separate tables */
  aliases?: readonly string[];
  /** Notes for implementers */
  notes?: string;
  /** school_id required on this table */
  tenantScoped: boolean;
}

/**
 * Product entity → physical table.
 * Assignments map to homework. Tests map to dpps. Sections stay on classes.section.
 * Never create parallel stores for the same academic fact.
 */
export const ENTITY_REGISTRY: Record<AcademicEntityKey, EntityMapping> = {
  school: { key: "school", table: "schools", tenantScoped: false },
  academic_year: {
    key: "academic_year",
    table: "academic_years",
    aliases: ["academic_terms"],
    notes: "academic_terms.academic_year_id links terms to a year; classes.academic_year text kept for compat",
    tenantScoped: true,
  },
  class: { key: "class", table: "classes", tenantScoped: true },
  section: {
    key: "section",
    table: "classes",
    notes: "Stored as classes.section — not a separate table",
    tenantScoped: true,
  },
  subject: {
    key: "subject",
    table: "subjects",
    notes: "Catalog table; operational rows may still carry text subject until subject_id backfill completes",
    tenantScoped: true,
  },
  teacher: { key: "teacher", table: "teachers", tenantScoped: true },
  student: { key: "student", table: "students", tenantScoped: true },
  parent: {
    key: "parent",
    table: "parents",
    aliases: ["parent_students"],
    tenantScoped: true,
  },
  teacher_class_subject: {
    key: "teacher_class_subject",
    table: "teacher_classes",
    notes: "Prefer subject_id FK; text subject remains until backfilled",
    tenantScoped: true,
  },
  attendance: { key: "attendance", table: "attendance", tenantScoped: true },
  homework: {
    key: "homework",
    table: "homework",
    aliases: ["assignment"],
    notes: "Assignment product language uses the homework table — do not create assignments table",
    tenantScoped: true,
  },
  homework_submission: {
    key: "homework_submission",
    table: "homework_submissions",
    aliases: ["assignment_submission"],
    tenantScoped: true,
  },
  assignment: {
    key: "assignment",
    table: "homework",
    notes: "Alias of homework",
    tenantScoped: true,
  },
  assignment_submission: {
    key: "assignment_submission",
    table: "homework_submissions",
    notes: "Alias of homework_submissions",
    tenantScoped: true,
  },
  test: {
    key: "test",
    table: "dpps",
    aliases: ["dpp", "class_test"],
    notes: "Class tests / DPPs share one store",
    tenantScoped: true,
  },
  question: {
    key: "question",
    table: "dpp_questions",
    aliases: ["question_bank", "question_templates"],
    notes: "Bank/templates are authoring sources; dpp_questions are assigned instances",
    tenantScoped: true,
  },
  student_test_attempt: {
    key: "student_test_attempt",
    table: "dpp_attempts",
    aliases: ["dpp_answers"],
    tenantScoped: true,
  },
  marks: {
    key: "marks",
    table: "marks",
    notes: "Examination marks live here; one row per exam+student",
    tenantScoped: true,
  },
  examination: {
    key: "examination",
    table: "exams",
    tenantScoped: true,
  },
  examination_marks: {
    key: "examination_marks",
    table: "marks",
    notes: "Same table as marks — examination_marks is the product name",
    tenantScoped: true,
  },
  practice: {
    key: "practice",
    table: "practice_sessions",
    tenantScoped: true,
  },
  practice_attempt: {
    key: "practice_attempt",
    table: "question_attempts",
    tenantScoped: true,
  },
  battle: {
    key: "battle",
    table: "battles",
    aliases: ["battle_participants", "battle_questions", "battle_answers"],
    notes: "Battleground experience — XP/wins live on student_xp; do not fork a parallel sync engine",
    tenantScoped: false,
  },
  student_xp: {
    key: "student_xp",
    table: "student_xp",
    notes: "Experience rollup written by battle/practice RPCs; UI reads via XpService only",
    tenantScoped: false,
  },
  student_badge: {
    key: "student_badge",
    table: "student_badges",
    aliases: ["badges"],
    notes: "Earned badges; awards via _award_badge / BadgeService — never invent unlocks in UI",
    tenantScoped: false,
  },
  student_doubt: {
    key: "student_doubt",
    table: "community_doubts",
    notes: "Class doubt portal; first answer solves via DB trigger; attachments in community_doubt_attachments",
    tenantScoped: true,
  },
  teacher_reply: {
    key: "teacher_reply",
    table: "community_doubt_answers",
    notes: "Answers from teacher or classmates; teacher visibility gated by teacher_classes",
    tenantScoped: true,
  },
  learning_resource: {
    key: "learning_resource",
    table: "learning_resources",
    aliases: ["resources", "study_materials"],
    notes: "Teacher/admin published notes, PDFs, videos for class library",
    tenantScoped: true,
  },
  announcement: {
    key: "announcement",
    table: "notices",
    tenantScoped: true,
  },
  message: {
    key: "message",
    table: "messages",
    aliases: ["chat_conversations", "chat_participants", "message_attachments", "message_read_receipts"],
    notes: "Gurukul Chat MVP SSOT via MessageService + conversation RPCs",
    tenantScoped: true,
  },
  notification: {
    key: "notification",
    table: "notifications",
    tenantScoped: true,
  },
  leave_request: {
    key: "leave_request",
    table: "leave_requests",
    tenantScoped: true,
  },
  teacher_remark: {
    key: "teacher_remark",
    table: "teacher_remarks",
    tenantScoped: true,
  },
  student_academic_profile: {
    key: "student_academic_profile",
    table: "student_academic_profiles",
    notes: "Auto-maintained rollup; sync engine owns writes. Distinct from student_academic_brain (AI learning state).",
    tenantScoped: true,
  },
  student_performance_summary: {
    key: "student_performance_summary",
    table: "student_academic_profiles",
    notes: "Derived view of the academic profile — do not duplicate",
    tenantScoped: true,
  },
  ai_insights: {
    key: "ai_insights",
    table: "academic_agent_cache",
    aliases: ["ai_explanations", "student_academic_brain"],
    notes: "AI reads structured summaries from services, not raw multi-table joins in the model layer",
    tenantScoped: true,
  },
  reports: {
    key: "reports",
    table: "student_academic_profiles",
    notes: "Reports compute from academic facts + profile; no separate reports fact table",
    tenantScoped: true,
  },
  analytics: {
    key: "analytics",
    table: "academic_events",
    notes: "Analytics calculate from attendance/homework/marks/practice — never store duplicate facts",
    tenantScoped: true,
  },
};

export function tableFor(entity: AcademicEntityKey): string {
  return ENTITY_REGISTRY[entity].table;
}

export function assertTenantScoped(entity: AcademicEntityKey): void {
  if (!ENTITY_REGISTRY[entity].tenantScoped) return;
  // Contract marker — repositories must filter by school_id
}
