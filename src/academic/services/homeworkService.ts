import {
  assertCanConsume,
  assertCanOwn,
  canReadSchoolWide,
  ForbiddenError,
  toRepoContext,
  type ServiceContext,
} from "./context";
import {
  countHomeworkByStatus,
  createHomework,
  decideSubmission,
  deleteHomework,
  getHomework,
  listCompletion,
  listHomeworkByIds,
  listHomeworkForClass,
  listHomeworkForSchool,
  listStandingsForHomework,
  listStandingsForStudent,
  listSubmissionsForHomework,
  listSubmissionsForStudent,
  submitHomeworkFile,
  updateHomework,
  type HomeworkCompletionRow,
  type HomeworkDecision,
  type HomeworkInput,
  type HomeworkRecord,
  type HomeworkStandingRow,
  type HomeworkSubmissionRecord,
  type SubmissionStatus,
} from "../repository/homeworkRepository";
import type { PageParams } from "../repository/base";
import type { AcademicFile } from "../storage/academicFileUpload";
import { assertMayAccessStudent } from "./parentAccess";
import { assertTeacherMayManageAcademicWork } from "./workLifecycle";
import { broadcastAcademicWrite } from "../live";

function afterHomeworkWrite(ctx: ServiceContext, meta: { classId?: string | null; studentId?: string | null; source: string }) {
  broadcastAcademicWrite(ctx.schoolId, ["homework", "profile"], {
    classId: meta.classId,
    studentId: meta.studentId ?? ctx.studentId,
    source: meta.source,
  });
}

/**
 * Where a student stands on one homework, for every screen that shows it.
 *
 * Derived from the two facts `homework_student_status` decides — `given`
 * (submitted or accepted; rejected is NOT given) and `closed` (the deadline
 * has passed) — plus the submission status. No screen re-derives it.
 */
export type HomeworkStanding = "to_do" | "handed_in" | "accepted" | "rejected" | "not_handed_in";

export function homeworkStanding(row: { status: SubmissionStatus; given: boolean; closed: boolean }): HomeworkStanding {
  if (row.status === "accepted") return "accepted";
  if (row.given) return "handed_in";
  if (row.closed) return "not_handed_in";
  return row.status === "rejected" ? "rejected" : "to_do";
}

export const HOMEWORK_STANDING_LABELS: Record<HomeworkStanding, string> = {
  to_do: "To do",
  handed_in: "Handed in — awaiting review",
  accepted: "Accepted",
  rejected: "Rejected — hand in again",
  not_handed_in: "Not handed in",
};

/**
 * What the two file pickers offer. They steer the browser's picker only; the
 * database decides what a file may be (`homework_question_file_ok`,
 * `homework_hand_in_ok`) and refuses anything else.
 */
export const HOMEWORK_QUESTION_FILE_PICKER = {
  accept: ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,image/*,application/pdf",
  kinds: ["pdf", "image", "doc"],
  label: "an image, a Word document or a PDF",
} as const;

export const HOMEWORK_HAND_IN_FILE_PICKER = {
  accept: ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,image/*,application/pdf",
  kinds: ["pdf", "image"],
  label: "an image or a PDF",
} as const;

/** A student may hand in (or replace) while the deadline is open and the teacher has not accepted. */
export function canHandIn(row: { status: SubmissionStatus; closed: boolean }): boolean {
  return !row.closed && row.status !== "accepted";
}

export interface StudentHomeworkRow {
  homework: HomeworkRecord;
  standing: HomeworkStandingRow;
  submission: HomeworkSubmissionRecord | null;
}

export interface ReviewRow {
  studentId: string;
  standing: HomeworkStandingRow;
  submission: HomeworkSubmissionRecord | null;
}

export interface ClassHomeworkRow extends HomeworkRecord {
  /** `homework_completion` for this homework; null for work not published. */
  completion: HomeworkCompletionRow | null;
}

export interface SchoolHomeworkSummary {
  published: number;
  scheduled: number;
  drafts: number;
  archived: number;
  /** Across every published homework: set to, given, awaiting review, rejected. */
  students: number;
  given: number;
  awaitingReview: number;
  rejected: number;
  completionPct: number;
}

/**
 * HomeworkService — the teacher sets and decides; the student hands in; the
 * parent, principal and admin read. Every panel goes through here.
 */
export const HomeworkService = {
  /** A class's homework with its completion — the teacher's list and the class insights. */
  async listForClass(ctx: ServiceContext, classId: string, page?: PageParams): Promise<ClassHomeworkRow[]> {
    assertCanConsume(ctx, "homework");
    if (ctx.role === "teacher") await assertTeacherMayManageAcademicWork(ctx, classId);
    const repo = toRepoContext(ctx);
    const items = await listHomeworkForClass(repo, classId, page);
    const completion = await listCompletion(
      repo,
      items.filter((h) => h.status === "published").map((h) => h.id),
    );
    const byId = new Map(completion.map((c) => [c.homeworkId, c]));
    return items.map((h) => ({ ...h, completion: byId.get(h.id) ?? null }));
  },

  /** School-wide list — principal/admin monitoring. */
  async listForSchool(ctx: ServiceContext, page?: PageParams): Promise<HomeworkRecord[]> {
    assertCanConsume(ctx, "homework");
    if (!canReadSchoolWide(ctx.role)) throw new ForbiddenError("School homework list is admin/principal-only");
    return listHomeworkForSchool(toRepoContext(ctx), page);
  },

  /** Everything set to one student — for the student, their parent, and staff. */
  async listForStudent(ctx: ServiceContext, studentId: string): Promise<StudentHomeworkRow[]> {
    assertCanConsume(ctx, "homework");
    await assertMayAccessStudent(ctx, studentId);
    const repo = toRepoContext(ctx);
    const standings = await listStandingsForStudent(repo, studentId);
    const ids = standings.map((s) => s.homeworkId);
    const [homework, submissions] = await Promise.all([
      listHomeworkByIds(repo, ids),
      listSubmissionsForStudent(repo, studentId, ids),
    ]);
    const hwById = new Map(homework.map((h) => [h.id, h]));
    const subByHw = new Map(submissions.map((s) => [s.homeworkId, s]));
    return standings.flatMap((standing) => {
      const hw = hwById.get(standing.homeworkId);
      return hw ? [{ homework: hw, standing, submission: subByHw.get(standing.homeworkId) ?? null }] : [];
    });
  },

  /** Every student a homework is set to, with what they handed in — the teacher's review. */
  async listForReview(ctx: ServiceContext, homeworkId: string): Promise<ReviewRow[]> {
    assertCanConsume(ctx, "homework_submission");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Students and parents may not list a class's submissions");
    }
    const repo = toRepoContext(ctx);
    const hw = await getHomework(repo, homeworkId);
    if (ctx.role === "teacher") await assertTeacherMayManageAcademicWork(ctx, hw.classId, hw.subject);
    const [standings, submissions] = await Promise.all([
      listStandingsForHomework(repo, homeworkId),
      listSubmissionsForHomework(repo, homeworkId),
    ]);
    const subById = new Map(submissions.map((s) => [s.id, s]));
    return standings.map((standing) => ({
      studentId: standing.studentId,
      standing,
      submission: standing.submissionId ? subById.get(standing.submissionId) ?? null : null,
    }));
  },

  /** Set homework: published now, scheduled, or kept as a draft (`input.status`). */
  async create(ctx: ServiceContext, input: HomeworkInput): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    await assertTeacherMayManageAcademicWork(ctx, input.classId, input.subject);
    const row = await createHomework(toRepoContext(ctx), input);
    afterHomeworkWrite(ctx, { classId: row.classId, source: "HomeworkService.create" });
    return row;
  },

  /**
   * Edit homework that has not closed. The database refuses what may not
   * change: a closed homework's deadline, class or release, and releasing work
   * whose deadline has passed (`tg_homework_lifecycle`).
   */
  async update(ctx: ServiceContext, homeworkId: string, input: HomeworkInput): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageAcademicWork(ctx, existing.classId, input.subject);
    const row = await updateHomework(toRepoContext(ctx), homeworkId, { ...input, classId: existing.classId });
    afterHomeworkWrite(ctx, { classId: row.classId, source: "HomeworkService.update" });
    return row;
  },

  async publish(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    return setStatus(ctx, homeworkId, { status: "published", scheduled_publish_at: null }, "HomeworkService.publish");
  },

  async unpublish(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    return setStatus(ctx, homeworkId, { status: "draft", scheduled_publish_at: null }, "HomeworkService.unpublish");
  },

  async archive(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    return setStatus(ctx, homeworkId, { status: "archived", scheduled_publish_at: null }, "HomeworkService.archive");
  },

  /** To the trash: out of every student's count at once. */
  async remove(ctx: ServiceContext, homeworkId: string): Promise<void> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageAcademicWork(ctx, existing.classId, existing.subject);
    await deleteHomework(toRepoContext(ctx), homeworkId);
    afterHomeworkWrite(ctx, { classId: existing.classId, source: "HomeworkService.remove" });
  },

  /** The student hands in their one image or PDF. The database decides whether it may. */
  async submit(ctx: ServiceContext, homeworkId: string, file: AcademicFile): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework_submission");
    if (ctx.role !== "student") throw new ForbiddenError("Only a student hands in homework");
    const row = await submitHomeworkFile(toRepoContext(ctx), homeworkId, file);
    afterHomeworkWrite(ctx, { studentId: row.studentId, source: "HomeworkService.submit" });
    return row;
  },

  /** The teacher's two actions. */
  async decide(ctx: ServiceContext, submissionId: string, decision: HomeworkDecision): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework");
    const row = await decideSubmission(toRepoContext(ctx), submissionId, decision);
    afterHomeworkWrite(ctx, { studentId: row.studentId, source: "HomeworkService.decide" });
    return row;
  },

  /** School homework for the principal and admin, from `homework_completion`. */
  async summarizeSchool(ctx: ServiceContext): Promise<SchoolHomeworkSummary> {
    assertCanConsume(ctx, "homework");
    if (!canReadSchoolWide(ctx.role)) throw new ForbiddenError("School homework summary is admin/principal-only");
    const repo = toRepoContext(ctx);
    const [counts, completion] = await Promise.all([countHomeworkByStatus(repo), listCompletion(repo)]);
    const sum = (key: "students" | "given" | "awaitingReview" | "rejected") =>
      completion.reduce((n, c) => n + c[key], 0);
    const students = sum("students");
    const given = sum("given");
    return {
      published: counts.published,
      scheduled: counts.scheduled,
      drafts: counts.draft,
      archived: counts.archived,
      students,
      given,
      awaitingReview: sum("awaitingReview"),
      rejected: sum("rejected"),
      completionPct: students ? Math.round((1000 * given) / students) / 10 : 0,
    };
  },
};

async function setStatus(
  ctx: ServiceContext,
  homeworkId: string,
  patch: { status: HomeworkRecord["status"]; scheduled_publish_at: null },
  source: string,
): Promise<HomeworkRecord> {
  assertCanOwn(ctx, "homework");
  const existing = await getHomework(toRepoContext(ctx), homeworkId);
  await assertTeacherMayManageAcademicWork(ctx, existing.classId, existing.subject);
  const row = await updateHomework(toRepoContext(ctx), homeworkId, patch);
  afterHomeworkWrite(ctx, { classId: row.classId, source });
  return row;
}

/** Product alias — Assignment is Homework. */
export const AssignmentService = HomeworkService;
