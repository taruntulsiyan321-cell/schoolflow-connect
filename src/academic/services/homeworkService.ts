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
  getSubmission,
  listCompletion,
  listHomeworkByIds,
  listHomeworkCreatedBy,
  listHomeworkForClass,
  listHomeworkForSchool,
  listPublishedHomeworkDeadlines,
  listStandingsForClass,
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
  type SchoolHomeworkRecord,
  type SubmissionStatus,
} from "../repository/homeworkRepository";
import { MAX_PAGE_LIMIT, type PageParams } from "../repository/base";
import { listTeacherClassSubjectPairs } from "../repository/teacherClassesRepository";
import type { AcademicFile } from "../storage/academicFileUpload";
import { assertMayAccessStudent } from "./parentAccess";
import { assertTeacherMayManageAcademicWork, teacherMayManageSubject } from "./workLifecycle";
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

/**
 * What a homework comes to for one student, counted at its deadline (§10.12):
 * done (`given`), missed (the deadline passed without it), or still to do.
 * Every count of homework — a student's profile, a class's report — classifies
 * through here, so no two screens can count "missed" differently.
 */
export type HomeworkOutcome = "done" | "missed" | "to_do";

export function homeworkOutcome(row: { given: boolean; closed: boolean }): HomeworkOutcome {
  if (row.given) return "done";
  return row.closed ? "missed" : "to_do";
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

/**
 * Released homework whose deadline has passed. Nothing about it may change
 * from here but archiving and deleting (`tg_homework_lifecycle`), whether or
 * not the closure job has resolved it yet.
 */
export function homeworkHasClosed(hw: Pick<HomeworkRecord, "status" | "closesAt" | "resolvedAt">, now = Date.now()): boolean {
  return hw.resolvedAt !== null || (hw.status === "published" && Date.parse(hw.closesAt) <= now);
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

/** A row of the teacher's list: the homework, its completion, and whether this caller may change it. */
export interface ManagedHomeworkRow extends ClassHomeworkRow {
  /** False for another subject's homework in a class this teacher teaches: they see it, and change nothing. */
  canManage: boolean;
}

export interface SchoolHomeworkRow extends SchoolHomeworkRecord {
  completion: HomeworkCompletionRow | null;
}

/**
 * One class's homework, for the principal's class list. Completion is measured
 * at the deadline (§10.12, rule 40): only homework that has closed counts, so a
 * class is not behind on work its students still have time to hand in.
 */
export interface ClassHomeworkCompletion {
  classId: string;
  /** Published homework whose deadline has passed. */
  closedHomework: number;
  /** Published homework still open. */
  openHomework: number;
  /** Across the closed homework: hand-ins given, and students it was set to. */
  given: number;
  expected: number;
  /** null when nothing has closed yet — no rate, rather than a rate of 0. */
  completionPct: number | null;
  /** Hand-ins waiting for a teacher's decision, open or closed. */
  awaitingReview: number;
}

/** What one teacher has set, for their own profile. */
export interface TeacherHomeworkSummary {
  total: number;
  published: number;
  scheduled: number;
  drafts: number;
  archived: number;
  /** Across everything they have published. */
  awaitingReview: number;
  recent: SchoolHomeworkRow[];
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

/** Each homework with its `homework_completion` row — one read for the lot, only for published work. */
async function withCompletion<T extends HomeworkRecord>(
  ctx: ServiceContext,
  items: T[],
): Promise<(T & { completion: HomeworkCompletionRow | null })[]> {
  const completion = await listCompletion(
    toRepoContext(ctx),
    items.filter((h) => h.status === "published").map((h) => h.id),
  );
  const byId = new Map(completion.map((c) => [c.homeworkId, c]));
  return items.map((h) => ({ ...h, completion: byId.get(h.id) ?? null }));
}

/**
 * HomeworkService — the teacher sets and decides; the student hands in; the
 * parent, principal and admin read. Every panel goes through here.
 */
export const HomeworkService = {
  /**
   * One page of a class's homework, newest first, with its completion and
   * whether the caller may change it. A teacher of the class reads every
   * subject's homework in it, and changes only their own subjects'.
   */
  async listForClass(ctx: ServiceContext, classId: string, page?: PageParams): Promise<ManagedHomeworkRow[]> {
    assertCanConsume(ctx, "homework");
    if (ctx.role === "teacher") await assertTeacherMayManageAcademicWork(ctx, classId);
    const items = await withCompletion(ctx, await listHomeworkForClass(toRepoContext(ctx), classId, page));
    const subjects = [...new Set(items.map((h) => h.subject))];
    const mayManage = new Map(
      await Promise.all(subjects.map(async (s) => [s, await teacherMayManageSubject(ctx, classId, s)] as const)),
    );
    return items.map((h) => ({ ...h, canManage: mayManage.get(h.subject) === true }));
  },

  /**
   * EVERY published homework of a class, with its completion — for the counts
   * a class's dashboard and insights show. Read page by page to the end: a
   * count taken over one page is a count that stops at the page size.
   */
  async listPublishedForClass(ctx: ServiceContext, classId: string): Promise<ClassHomeworkRow[]> {
    assertCanConsume(ctx, "homework");
    if (ctx.role === "teacher") await assertTeacherMayManageAcademicWork(ctx, classId);
    const repo = toRepoContext(ctx);
    const items: HomeworkRecord[] = [];
    for (let offset = 0; ; offset += MAX_PAGE_LIMIT) {
      const page = await listHomeworkForClass(repo, classId, { limit: MAX_PAGE_LIMIT, offset }, "published");
      items.push(...page);
      if (page.length < MAX_PAGE_LIMIT) break;
    }
    return withCompletion(ctx, items);
  },

  /**
   * The subjects the caller may set homework in for a class — a teacher's own
   * subjects there, from `teacher_classes`. Empty for anyone else.
   */
  async subjectsForClass(ctx: ServiceContext, classId: string): Promise<string[]> {
    assertCanConsume(ctx, "homework");
    if (ctx.role !== "teacher") return [];
    const pairs = await listTeacherClassSubjectPairs(toRepoContext(ctx), ctx.userId);
    return pairs.filter((p) => p.classId === classId).map((p) => p.subject);
  },

  /** One page of the school's homework, with each one's class and completion — principal/admin monitoring. */
  async listForSchool(ctx: ServiceContext, page?: PageParams): Promise<SchoolHomeworkRow[]> {
    assertCanConsume(ctx, "homework");
    if (!canReadSchoolWide(ctx.role)) throw new ForbiddenError("School homework list is admin/principal-only");
    return withCompletion(ctx, await listHomeworkForSchool(toRepoContext(ctx), page));
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

  /**
   * Every student a homework is set to, with what they handed in — the
   * teacher's review. Any teacher of the class may read it, whatever the
   * subject; deciding is `decide`'s, and is the subject's teachers' only.
   */
  async listForReview(ctx: ServiceContext, homeworkId: string): Promise<ReviewRow[]> {
    assertCanConsume(ctx, "homework_submission");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Students and parents may not list a class's submissions");
    }
    const repo = toRepoContext(ctx);
    const hw = await getHomework(repo, homeworkId);
    if (ctx.role === "teacher") await assertTeacherMayManageAcademicWork(ctx, hw.classId);
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

  /**
   * Every student's standing on every published homework of a class — the
   * class's homework report. The principal and admin read any class of the
   * school; a teacher, a class they teach.
   */
  async standingsForClass(ctx: ServiceContext, classId: string): Promise<HomeworkStandingRow[]> {
    assertCanConsume(ctx, "homework_submission");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Students and parents may not list a class's homework standings");
    }
    if (ctx.role === "teacher") await assertTeacherMayManageAcademicWork(ctx, classId);
    return listStandingsForClass(toRepoContext(ctx), classId);
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
   * Edit homework that has not closed. Its class and subject are what it was
   * set for, and stay so — an edit is not a way to file one subject's homework
   * under another. The database refuses the rest of what may not change: a
   * closed homework's deadline or release, and releasing work whose deadline
   * has passed (`tg_homework_lifecycle`).
   */
  async update(ctx: ServiceContext, homeworkId: string, input: HomeworkInput): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageAcademicWork(ctx, existing.classId, existing.subject);
    const row = await updateHomework(toRepoContext(ctx), homeworkId, {
      ...input,
      classId: existing.classId,
      subject: existing.subject,
    });
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

  /** The teacher's two actions — for a teacher of the homework's subject in that class, or an admin. */
  async decide(ctx: ServiceContext, submissionId: string, decision: HomeworkDecision): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework");
    const repo = toRepoContext(ctx);
    const hw = await getHomework(repo, (await getSubmission(repo, submissionId)).homeworkId);
    await assertTeacherMayManageAcademicWork(ctx, hw.classId, hw.subject);
    const row = await decideSubmission(repo, submissionId, decision);
    afterHomeworkWrite(ctx, { classId: hw.classId, studentId: row.studentId, source: "HomeworkService.decide" });
    return row;
  },

  /**
   * Every class's homework completion, measured at the deadline — the
   * principal's class list. Two reads for the whole school, both read to the
   * end: the published homework and their deadlines, and `homework_completion`.
   */
  async completionByClass(ctx: ServiceContext, now = Date.now()): Promise<Map<string, ClassHomeworkCompletion>> {
    assertCanConsume(ctx, "homework");
    if (!canReadSchoolWide(ctx.role)) throw new ForbiddenError("School homework completion is admin/principal-only");
    const repo = toRepoContext(ctx);
    const [deadlines, completion] = await Promise.all([listPublishedHomeworkDeadlines(repo), listCompletion(repo)]);
    const byHomework = new Map(completion.map((c) => [c.homeworkId, c]));
    const byClass = new Map<string, ClassHomeworkCompletion>();
    for (const hw of deadlines) {
      const acc =
        byClass.get(hw.classId) ??
        { classId: hw.classId, closedHomework: 0, openHomework: 0, given: 0, expected: 0, completionPct: null, awaitingReview: 0 };
      const c = byHomework.get(hw.id);
      if (Date.parse(hw.closesAt) <= now) {
        acc.closedHomework += 1;
        acc.given += c?.given ?? 0;
        acc.expected += c?.students ?? 0;
      } else {
        acc.openHomework += 1;
      }
      acc.awaitingReview += c?.awaitingReview ?? 0;
      byClass.set(hw.classId, acc);
    }
    for (const acc of byClass.values()) {
      acc.completionPct = acc.expected ? Math.round((1000 * acc.given) / acc.expected) / 10 : null;
    }
    return byClass;
  },

  /**
   * What this teacher has set, for their own profile: how much, in which state,
   * how many hand-ins wait on them, and the recent few with their completion.
   * Homework is credited to whoever set it (docs/locked-decisions.md).
   */
  async summaryForTeacher(ctx: ServiceContext, opts?: { limit?: number }): Promise<TeacherHomeworkSummary> {
    assertCanConsume(ctx, "homework");
    if (!ctx.userId) throw new ForbiddenError("No signed-in user — cannot list the homework you have set");
    const repo = toRepoContext(ctx);
    const published: SchoolHomeworkRecord[] = [];
    for (let offset = 0; ; offset += MAX_PAGE_LIMIT) {
      const page = await listHomeworkCreatedBy(repo, ctx.userId, { limit: MAX_PAGE_LIMIT, offset }, "published");
      published.push(...page);
      if (page.length < MAX_PAGE_LIMIT) break;
    }
    const [counts, recent, publishedCompletion] = await Promise.all([
      countHomeworkByStatus(repo, { createdBy: ctx.userId }),
      listHomeworkCreatedBy(repo, ctx.userId, { limit: opts?.limit ?? 5 }).then((rows) => withCompletion(ctx, rows)),
      listCompletion(repo, published.map((h) => h.id)),
    ]);
    return {
      total: counts.draft + counts.scheduled + counts.published + counts.archived,
      published: counts.published,
      scheduled: counts.scheduled,
      drafts: counts.draft,
      archived: counts.archived,
      awaitingReview: publishedCompletion.reduce((n, c) => n + c.awaitingReview, 0),
      recent,
    };
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
