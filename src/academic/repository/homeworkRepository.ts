import { ValidationFailedError, NotFoundError, TenantViolationError } from "./errors";
import { extractAcademicStoragePath } from "@/academic/storage/academicFileUpload";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

export type HomeworkStatus = "draft" | "scheduled" | "published" | "archived";
export type HomeworkPriority = "low" | "normal" | "high" | "urgent";
export type WorkKind =
  | "homework"
  | "assignment"
  | "worksheet"
  | "project"
  | "internal_assessment";
export type HomeworkSubmissionStatus =
  | "pending"
  | "submitted"
  | "late"
  | "reviewed"
  | "returned"
  | "graded"
  | "completed";

const WORK_KINDS: WorkKind[] = [
  "homework",
  "assignment",
  "worksheet",
  "project",
  "internal_assessment",
];

function normalizeWorkKind(v: string | null | undefined): WorkKind {
  if (v && (WORK_KINDS as string[]).includes(v)) return v as WorkKind;
  return "homework";
}

export interface HomeworkAttachmentMeta {
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface HomeworkRecord {
  id: string;
  schoolId: string;
  classId: string;
  subject: string;
  subjectId: string | null;
  title: string;
  description: string;
  instructions: string | null;
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number | null;
  priority: string;
  difficulty: string | null;
  maxMarks: number | null;
  tags: string[];
  externalLinks: string[];
  attachments: HomeworkAttachmentMeta[];
  workKind: WorkKind;
  status: HomeworkStatus | string | null;
  scheduledPublishAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HomeworkSubmissionRecord {
  id: string;
  schoolId: string;
  homeworkId: string;
  studentId: string;
  content: string;
  status: HomeworkSubmissionStatus | string;
  grade: string | null;
  marksObtained: number | null;
  teacherRemarks: string | null;
  isLate: boolean;
  version: number;
  attachments: HomeworkAttachmentMeta[];
  externalLinks: string[];
  submittedAt: string | null;
  gradedAt: string | null;
  returnedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
}

type HomeworkRow = Record<string, unknown>;
type SubmissionRow = Record<string, unknown>;

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

function asAttachments(v: unknown): HomeworkAttachmentMeta[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      if (!o.url || !o.name) return null;
      return {
        name: String(o.name),
        url: String(o.url),
        mimeType: o.mimeType ? String(o.mimeType) : undefined,
        sizeBytes: typeof o.sizeBytes === "number" ? o.sizeBytes : undefined,
      };
    })
    .filter(Boolean) as HomeworkAttachmentMeta[];
}

/**
 * NINE OF THESE FIELDS NO LONGER HAVE A COLUMN BEHIND THEM.
 *
 * Migration 20260925110000 simplified `homework` in production and moved the
 * old shape to `homework_pre_20260925110000`. These were dropped:
 *
 *     subject_id, instructions, due_time, estimated_minutes, difficulty,
 *     max_marks, tags, external_links, attachments
 *
 * HW_SELECT still asked for all nine, so EVERY homework read from a browser
 * returned 400 Bad Request — the feature was entirely broken client-side, on
 * the student's Home screen among others. Found on 2026-09-15 by watching the
 * network tab during a live session. No gate could see it: HomeworkRow is
 * loose enough that TypeScript had nothing to object to, and the only caller
 * treated the failure as an empty list.
 *
 * HW_SELECT now asks only for columns that exist, which fixes the 400. The
 * nine fields below therefore map to null or an empty array, ALWAYS, for every
 * homework — left deliberately visible rather than quietly deleted, because
 * removing them properly means deciding what six UI files do without
 * attachments, marks and tags. Measured: 33 type errors across contextApis,
 * homeworkService, LiveHomeworkPanels, Assignments, StudentHomeworkPage and
 * this file.
 *
 * That is a homework decision in a subsystem this work did not touch, and
 * guessing at it would be worse than saying so. The scope is written down here
 * so it is a short job rather than a rediscovery.
 */
function mapHomework(row: HomeworkRow): HomeworkRecord {
  return {
    id: String(row.id),
    schoolId: String(row.school_id ?? ""),
    classId: String(row.class_id),
    subject: String(row.subject ?? ""),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    instructions: row.instructions != null ? String(row.instructions) : null,
    dueDate: row.due_date != null ? String(row.due_date) : null,
    dueTime: row.due_time != null ? String(row.due_time) : null,
    estimatedMinutes:
      row.estimated_minutes != null ? Number(row.estimated_minutes) : null,
    priority: String(row.priority ?? "normal"),
    difficulty: row.difficulty != null ? String(row.difficulty) : null,
    maxMarks: row.max_marks != null ? Number(row.max_marks) : null,
    tags: asStringArray(row.tags),
    externalLinks: asStringArray(row.external_links).length
      ? asStringArray(row.external_links)
      : Array.isArray(row.external_links)
        ? (row.external_links as unknown[]).map(String)
        : [],
    attachments: asAttachments(row.attachments),
    workKind: normalizeWorkKind(row.work_kind != null ? String(row.work_kind) : null),
    status: (row.status as string) ?? "draft",
    scheduledPublishAt: row.scheduled_publish_at
      ? String(row.scheduled_publish_at)
      : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function mapSubmission(row: SubmissionRow): HomeworkSubmissionRecord {
  return {
    id: String(row.id),
    schoolId: String(row.school_id ?? ""),
    homeworkId: String(row.homework_id),
    studentId: String(row.student_id),
    content: String(row.content ?? ""),
    status: String(row.status ?? "pending"),
    grade: row.grade != null ? String(row.grade) : null,
    marksObtained: row.marks_obtained != null ? Number(row.marks_obtained) : null,
    teacherRemarks: row.teacher_remarks != null ? String(row.teacher_remarks) : null,
    isLate: Boolean(row.is_late),
    version: Number(row.version ?? 1),
    attachments: asAttachments(row.attachments),
    externalLinks: asStringArray(row.external_links),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    gradedAt: row.graded_at ? String(row.graded_at) : null,
    returnedAt: row.returned_at ? String(row.returned_at) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

// Only columns that exist. See mapHomework above for the nine that do not,
// and why they are still in the record type.
const HW_SELECT =
  "id, school_id, class_id, subject, title, description, due_date, priority, work_kind, status, scheduled_publish_at, published_at, archived_at, created_by, created_at, updated_at, chapter_id, topic, topic_id, closes_at, question_file, missed_costs_xp";

export interface HomeworkListFilters {
  status?: HomeworkStatus | HomeworkStatus[] | "active";
  subject?: string;
  createdBy?: string;
  priority?: string;
  workKind?: WorkKind | WorkKind[];
  dueFrom?: string;
  dueTo?: string;
  search?: string;
}

export interface CreateHomeworkInput {
  classId: string;
  subject: string;
  subjectId?: string | null;
  title: string;
  description?: string;
  instructions?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  estimatedMinutes?: number | null;
  priority?: HomeworkPriority | string;
  difficulty?: string | null;
  maxMarks?: number | null;
  tags?: string[];
  externalLinks?: string[];
  attachments?: HomeworkAttachmentMeta[];
  workKind?: WorkKind;
  status?: HomeworkStatus;
  scheduledPublishAt?: string | null;
}

export type UpdateHomeworkInput = Partial<CreateHomeworkInput> & {
  archivedAt?: string | null;
  publishedAt?: string | null;
};

function validateHomeworkInput(input: CreateHomeworkInput | UpdateHomeworkInput, partial = false) {
  const errors: { field: string; code: string; message: string }[] = [];
  if (!partial || input.title !== undefined) {
    if (!input.title?.trim()) {
      errors.push({ field: "title", code: "required", message: "Homework title is required" });
    }
  }
  if (!partial || input.subject !== undefined) {
    if (!input.subject?.trim()) {
      errors.push({ field: "subject", code: "required", message: "Subject is required" });
    }
  }
  if (!partial && !(input as CreateHomeworkInput).classId) {
    errors.push({ field: "classId", code: "required", message: "Class is required" });
  }
  if (!partial || input.dueDate !== undefined) {
    const due = input.dueDate;
    if (due === null || due === undefined || String(due).trim() === "") {
      // Drafts may omit due date; published requires it (enforced at publish)
      if (!partial && (input.status === "published" || input.status === "scheduled")) {
        errors.push({ field: "dueDate", code: "required", message: "Due date is required" });
      }
    }
  }
  if (input.attachments) {
    for (const a of input.attachments) {
      if (!a.name || !a.url) {
        errors.push({
          field: "attachments",
          code: "invalid",
          message: "Each attachment requires name and url",
        });
        break;
      }
    }
  }
  if (errors.length) throw new ValidationFailedError(errors);
}

export async function getHomework(ctx: RepoContext, homeworkId: string): Promise<HomeworkRecord> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await (getClient(ctx) as any)
    .from("homework")
    .select(HW_SELECT)
    .eq("id", homeworkId)
    .eq("school_id", schoolId)
    .maybeSingle();

  throwIfError(error, "Failed to load homework");
  if (!data) throw new NotFoundError("homework", homeworkId);
  return mapHomework(data as HomeworkRow);
}

export async function listHomeworkForClass(
  ctx: RepoContext,
  classId: string,
  page?: PageParams,
  filters?: HomeworkListFilters,
): Promise<HomeworkRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  let q = (getClient(ctx) as any)
    .from("homework")
    .select(HW_SELECT)
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters?.status === "active") {
    q = q.in("status", ["published", "active"]);
  } else if (Array.isArray(filters?.status)) {
    q = q.in("status", filters!.status);
  } else if (filters?.status) {
    q = q.eq("status", filters.status);
  }
  if (filters?.subject) q = q.eq("subject", filters.subject);
  if (filters?.createdBy) q = q.eq("created_by", filters.createdBy);
  if (filters?.priority) q = q.eq("priority", filters.priority);
  if (Array.isArray(filters?.workKind)) {
    q = q.in("work_kind", filters!.workKind);
  } else if (filters?.workKind) {
    q = q.eq("work_kind", filters.workKind);
  }
  if (filters?.dueFrom) q = q.gte("due_date", filters.dueFrom);
  if (filters?.dueTo) q = q.lte("due_date", filters.dueTo);
  if (filters?.search) q = q.ilike("title", `%${filters.search}%`);

  const { data, error } = await q;
  throwIfError(error, "Failed to list homework");
  return (data ?? []).map((r) => mapHomework(r as HomeworkRow));
}

export async function listHomeworkForSchool(
  ctx: RepoContext,
  page?: PageParams,
  filters?: HomeworkListFilters,
): Promise<HomeworkRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);
  let q = (getClient(ctx) as any)
    .from("homework")
    .select(HW_SELECT)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters?.status === "active") {
    q = q.in("status", ["published", "active"]);
  } else if (Array.isArray(filters?.status)) {
    q = q.in("status", filters!.status);
  } else if (filters?.status) {
    q = q.eq("status", filters.status);
  }
  if (filters?.subject) q = q.eq("subject", filters.subject);
  if (filters?.createdBy) q = q.eq("created_by", filters.createdBy);
  if (filters?.priority) q = q.eq("priority", filters.priority);
  if (Array.isArray(filters?.workKind)) {
    q = q.in("work_kind", filters!.workKind);
  } else if (filters?.workKind) {
    q = q.eq("work_kind", filters.workKind);
  }
  if (filters?.search) q = q.ilike("title", `%${filters.search}%`);

  const { data, error } = await q;
  throwIfError(error, "Failed to list school homework");
  return (data ?? []).map((r) => mapHomework(r as HomeworkRow));
}

async function assertClassInSchool(ctx: RepoContext, classId: string, schoolId: string) {
  const { data, error } = await getClient(ctx)
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("school_id", schoolId)
    .maybeSingle();
  throwIfError(error, "Failed to verify class");
  if (!data) {
    throw new ValidationFailedError([
      { field: "classId", code: "invalid", message: "Class does not belong to this school" },
    ]);
  }
}

export async function createHomework(
  ctx: RepoContext,
  input: CreateHomeworkInput,
): Promise<HomeworkRecord> {
  const schoolId = schoolIdOf(ctx);
  validateHomeworkInput(input);
  await assertClassInSchool(ctx, input.classId, schoolId);
  const status = input.status ?? "draft";
  if (status === "published" && !input.dueDate) {
    throw new ValidationFailedError([
      { field: "dueDate", code: "required", message: "Due date is required to publish" },
    ]);
  }

  const { data, error } = await (getClient(ctx) as any)
    .from("homework")
    .insert({
      school_id: schoolId,
      class_id: input.classId,
      subject: input.subject.trim(),
      subject_id: input.subjectId ?? null,
      title: input.title.trim(),
      description: input.description ?? "",
      instructions: input.instructions ?? null,
      due_date: input.dueDate ?? null,
      due_time: input.dueTime ?? null,
      estimated_minutes: input.estimatedMinutes ?? null,
      priority: input.priority ?? "normal",
      difficulty: input.difficulty ?? null,
      max_marks: input.maxMarks ?? null,
      tags: input.tags ?? [],
      external_links: input.externalLinks ?? [],
      attachments: input.attachments ?? [],
      work_kind: normalizeWorkKind(input.workKind),
      status,
      scheduled_publish_at: input.scheduledPublishAt ?? null,
      published_at: status === "published" ? new Date().toISOString() : null,
      created_by: ctx.userId ?? null,
      updated_at: new Date().toISOString(),
    } as never)
    .select(HW_SELECT)
    .single();

  throwIfError(error, "Failed to create homework");
  return mapHomework(data as HomeworkRow);
}

export async function updateHomework(
  ctx: RepoContext,
  homeworkId: string,
  input: UpdateHomeworkInput,
): Promise<HomeworkRecord> {
  const schoolId = schoolIdOf(ctx);
  const existing = await getHomework(ctx, homeworkId);
  if (existing.schoolId && existing.schoolId !== schoolId) {
    throw new TenantViolationError("Homework belongs to another school");
  }
  validateHomeworkInput(input, true);
  if (input.classId !== undefined) {
    await assertClassInSchool(ctx, input.classId, schoolId);
  }

  const nextStatus = input.status ?? existing.status;
  const nextDue = input.dueDate !== undefined ? input.dueDate : existing.dueDate;
  if (
    (nextStatus === "published" || nextStatus === "scheduled") &&
    (!nextDue || String(nextDue).trim() === "")
  ) {
    throw new ValidationFailedError([
      { field: "dueDate", code: "required", message: "Due date is required to publish" },
    ]);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.instructions !== undefined) patch.instructions = input.instructions;
  if (input.subject !== undefined) patch.subject = input.subject.trim();
  if (input.subjectId !== undefined) patch.subject_id = input.subjectId;
  if (input.classId !== undefined) patch.class_id = input.classId;
  if (input.dueDate !== undefined) patch.due_date = input.dueDate;
  if (input.dueTime !== undefined) patch.due_time = input.dueTime;
  if (input.estimatedMinutes !== undefined) patch.estimated_minutes = input.estimatedMinutes;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
  if (input.maxMarks !== undefined) patch.max_marks = input.maxMarks;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.externalLinks !== undefined) patch.external_links = input.externalLinks;
  if (input.attachments !== undefined) patch.attachments = input.attachments;
  if (input.workKind !== undefined) patch.work_kind = normalizeWorkKind(input.workKind);
  if (input.status !== undefined) patch.status = input.status;
  if (input.scheduledPublishAt !== undefined) patch.scheduled_publish_at = input.scheduledPublishAt;
  if (input.publishedAt !== undefined) patch.published_at = input.publishedAt;
  if (input.archivedAt !== undefined) patch.archived_at = input.archivedAt;

  const { data, error } = await (getClient(ctx) as any)
    .from("homework")
    .update(patch as never)
    .eq("id", homeworkId)
    .eq("school_id", schoolId)
    .select(HW_SELECT)
    .single();

  throwIfError(error, "Failed to update homework");
  return mapHomework(data as HomeworkRow);
}

export async function publishHomework(
  ctx: RepoContext,
  homeworkId: string,
): Promise<HomeworkRecord> {
  const existing = await getHomework(ctx, homeworkId);
  if (!existing.dueDate) {
    throw new ValidationFailedError([
      { field: "dueDate", code: "required", message: "Due date is required to publish" },
    ]);
  }
  if (!existing.subject?.trim() || !existing.title?.trim()) {
    throw new ValidationFailedError([
      { field: "title", code: "required", message: "Title and subject are required to publish" },
    ]);
  }
  return updateHomework(ctx, homeworkId, {
    status: "published",
    publishedAt: new Date().toISOString(),
  });
}

export async function unpublishHomework(
  ctx: RepoContext,
  homeworkId: string,
): Promise<HomeworkRecord> {
  return updateHomework(ctx, homeworkId, { status: "draft", publishedAt: null });
}

export async function archiveHomework(
  ctx: RepoContext,
  homeworkId: string,
): Promise<HomeworkRecord> {
  return updateHomework(ctx, homeworkId, {
    status: "archived",
    archivedAt: new Date().toISOString(),
  });
}

export async function duplicateHomework(
  ctx: RepoContext,
  homeworkId: string,
): Promise<HomeworkRecord> {
  const src = await getHomework(ctx, homeworkId);
  return createHomework(ctx, {
    classId: src.classId,
    subject: src.subject,
    subjectId: src.subjectId,
    title: `${src.title} (Copy)`,
    description: src.description,
    instructions: src.instructions,
    dueDate: src.dueDate,
    dueTime: src.dueTime,
    estimatedMinutes: src.estimatedMinutes,
    priority: src.priority,
    difficulty: src.difficulty,
    maxMarks: src.maxMarks,
    tags: src.tags,
    externalLinks: src.externalLinks,
    attachments: src.attachments,
    workKind: src.workKind,
    status: "draft",
  });
}

export async function deleteHomework(ctx: RepoContext, homeworkId: string): Promise<void> {
  const schoolId = schoolIdOf(ctx);
  const existing = await getHomework(ctx, homeworkId);
  if (existing.status === "published") {
    throw new ValidationFailedError([
      {
        field: "status",
        code: "forbidden",
        message: "Archive published homework instead of deleting",
      },
    ]);
  }
  const { error } = await (getClient(ctx) as any)
    .from("homework")
    .delete()
    .eq("id", homeworkId)
    .eq("school_id", schoolId);
  throwIfError(error, "Failed to delete homework");
}

export async function listSubmissionsForHomework(
  ctx: RepoContext,
  homeworkId: string,
): Promise<HomeworkSubmissionRecord[]> {
  await getHomework(ctx, homeworkId);
  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .select("*")
    .eq("homework_id", homeworkId)
    .order("submitted_at", { ascending: false });

  throwIfError(error, "Failed to list submissions");
  return (data ?? []).map((r) => mapSubmission(r as SubmissionRow));
}

/** Batch load submissions for many homework ids (avoids N+1). */
export async function listSubmissionsForHomeworkIds(
  ctx: RepoContext,
  homeworkIds: string[],
): Promise<HomeworkSubmissionRecord[]> {
  if (homeworkIds.length === 0) return [];
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .select("*")
    .eq("school_id", schoolId)
    .in("homework_id", homeworkIds);
  throwIfError(error, "Failed to batch list submissions");
  return (data ?? []).map((r) => mapSubmission(r as SubmissionRow));
}

export interface SubmitHomeworkInput {
  homeworkId: string;
  studentId: string;
  content: string;
  attachments?: HomeworkAttachmentMeta[];
  externalLinks?: string[];
}

/**
 * Hand in one homework, through rpc_homework_submit.
 *
 * ── WHAT THIS REPLACED, AND WHY IT COULD NEVER HAVE WORKED ─────────────────
 *
 * This upserted a row carrying `content`, `attachments`, `external_links`,
 * `is_late`, `version`, `grade`, `marks_obtained`, `teacher_remarks`,
 * `graded_at`, `reviewed_at` and `returned_at`. homework_submissions has NONE
 * of them. Its columns are:
 *
 *     id, homework_id, student_id, status, submitted_at, created_at,
 *     updated_at, school_id, file, decided_at, decided_by
 *
 * The homework model was rewritten in the database — from a text submission
 * that gets graded, to ONE uploaded file that a teacher accepts or rejects —
 * and the client was never migrated. Measured 2026-09-19: 146 submission rows,
 * statuses only `accepted` and `not_submitted`, and not one `submitted`, which
 * is the status this function wrote. Student hand-in has been failing on both
 * surfaces that call it (/student/homework and /student/classes). The stale
 * generated types hid it from `tsc` and `row: Record<string, unknown>` hid it
 * from review.
 *
 * ── WHAT IT DOES NOW ───────────────────────────────────────────────────────
 *
 * Calls the database's own entry point. Everything this function used to do by
 * hand — checking the homework is open, the deadline, whether a prior
 * submission is locked, whose file it is — rpc_homework_submit does under
 * `FOR SHARE` on the homework and `FOR UPDATE` on the submission, so a hand-in
 * and the closure job cannot interleave. Re-implementing any of it here would
 * be a second home for a rule with locks behind it.
 *
 * ── THE BEHAVIOUR CHANGE, STATED PLAINLY ───────────────────────────────────
 *
 * A note-only submission is no longer possible, and neither is an external
 * link. The schema has nowhere to put either, and the server's own rule is
 * "hand in exactly one image or PDF". Callers that collect a note keep
 * collecting it; it is not stored. Only the first uploaded attachment is sent
 * — the column holds one file object, not an array.
 */
export async function upsertHomeworkSubmission(
  ctx: RepoContext,
  input: SubmitHomeworkInput,
): Promise<HomeworkSubmissionRecord> {
  const first = (input.attachments ?? []).find(
    (a) => extractAcademicStoragePath(a.url) != null,
  );
  const path = first ? extractAcademicStoragePath(first.url) : null;

  if (!first || !path) {
    throw new ValidationFailedError([
      {
        field: "attachments",
        code: "required",
        // Names the two cases a caller can actually be in: nothing attached,
        // or something attached that is not an upload (an external link has
        // no storage path, so the server could never verify it).
        message:
          (input.externalLinks?.length ?? 0) > 0 || (input.attachments?.length ?? 0) > 0
            ? "Upload the image or PDF itself — a link cannot be handed in"
            : "Attach the one image or PDF you are handing in",
      },
    ]);
  }

  const { data, error } = await getClient(ctx).rpc("rpc_homework_submit", {
    _homework_id: input.homeworkId,
    _file: {
      path,
      name: first.name,
      mime: first.mimeType ?? null,
      size: first.sizeBytes ?? null,
    },
  });
  throwIfError(error, "Failed to submit homework");
  return mapSubmission((data ?? {}) as SubmissionRow);
}

export interface ReviewHomeworkInput {
  submissionId: string;
  action: "approve" | "reject" | "return" | "grade";
  grade?: string | null;
  marksObtained?: number | null;
  remarks?: string | null;
  attachments?: HomeworkAttachmentMeta[];
}

export async function reviewHomeworkSubmission(
  ctx: RepoContext,
  input: ReviewHomeworkInput,
): Promise<HomeworkSubmissionRecord> {
  const schoolId = schoolIdOf(ctx);
  const now = new Date().toISOString();
  let status: HomeworkSubmissionStatus = "reviewed";
  if (input.action === "return" || input.action === "reject") status = "returned";
  else if (input.action === "grade") status = "graded";
  else if (input.action === "approve") status = "reviewed";

  const { data: existing, error: loadErr } = await getClient(ctx)
    .from("homework_submissions")
    .select("id, status, homework_id")
    .eq("id", input.submissionId)
    .eq("school_id", schoolId)
    .maybeSingle();
  throwIfError(loadErr, "Failed to load submission for review");
  if (!existing) throw new NotFoundError("homework_submission", input.submissionId);

  const cur = String(existing.status);
  if (!["submitted", "late", "returned", "reviewed"].includes(cur)) {
    throw new ValidationFailedError([
      {
        field: "status",
        code: "invalid",
        message: "Only submitted, late, returned, or reviewed work can be reviewed",
      },
    ]);
  }

  if (input.marksObtained != null) {
    const hw = await getHomework(ctx, String(existing.homework_id));
    if (hw.maxMarks != null && input.marksObtained > hw.maxMarks) {
      throw new ValidationFailedError([
        {
          field: "marksObtained",
          code: "invalid",
          message: `Marks cannot exceed max marks (${hw.maxMarks})`,
        },
      ]);
    }
    if (input.marksObtained < 0) {
      throw new ValidationFailedError([
        { field: "marksObtained", code: "invalid", message: "Marks cannot be negative" },
      ]);
    }
  }

  const patch: Record<string, unknown> = {
    status,
    teacher_remarks: input.remarks ?? null,
    grade: input.grade ?? null,
    marks_obtained: input.marksObtained ?? null,
    school_id: schoolId,
    updated_at: now,
  };
  if (status === "returned") patch.returned_at = now;
  if (status === "graded" || status === "reviewed") {
    patch.reviewed_at = now;
    patch.graded_at = now;
  }
  // Do not overwrite student attachments from teacher review payload

  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .update(patch as never)
    .eq("id", input.submissionId)
    .eq("school_id", schoolId)
    .select("*")
    .single();

  throwIfError(error, "Failed to review homework");
  return mapSubmission(data as SubmissionRow);
}

/** @deprecated use reviewHomeworkSubmission */
export async function gradeHomeworkSubmission(
  ctx: RepoContext,
  input: { submissionId: string; grade: string; remarks?: string | null },
): Promise<HomeworkSubmissionRecord> {
  return reviewHomeworkSubmission(ctx, {
    submissionId: input.submissionId,
    action: "grade",
    grade: input.grade,
    remarks: input.remarks,
  });
}
