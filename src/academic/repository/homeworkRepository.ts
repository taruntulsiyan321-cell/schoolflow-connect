import { ValidationFailedError, NotFoundError, TenantViolationError } from "./errors";
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

const HW_SELECT =
  "id, school_id, class_id, subject, subject_id, title, description, instructions, due_date, due_time, estimated_minutes, priority, difficulty, max_marks, tags, external_links, attachments, work_kind, status, scheduled_publish_at, published_at, archived_at, created_by, created_at, updated_at";

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
  const { data, error } = await getClient(ctx)
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

  let q = getClient(ctx)
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
  let q = getClient(ctx)
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

  const { data, error } = await getClient(ctx)
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

  const { data, error } = await getClient(ctx)
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
  const { error } = await getClient(ctx)
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

export async function upsertHomeworkSubmission(
  ctx: RepoContext,
  input: SubmitHomeworkInput,
): Promise<HomeworkSubmissionRecord> {
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  const hasLinks = (input.externalLinks?.length ?? 0) > 0;
  if (!input.content?.trim() && !hasAttachments && !hasLinks) {
    throw new ValidationFailedError([
      {
        field: "content",
        code: "required",
        message: "Add a note or attach at least one file/link",
      },
    ]);
  }

  const schoolId = schoolIdOf(ctx);
  const hw = await getHomework(ctx, input.homeworkId);
  if (hw.status !== "published" && hw.status !== "active") {
    throw new ValidationFailedError([
      { field: "homeworkId", code: "invalid", message: "Homework is not open for submission" },
    ]);
  }

  const now = new Date();
  let isLate = false;
  if (hw.dueDate) {
    const due = new Date(`${hw.dueDate}T${hw.dueTime ?? "23:59:59"}`);
    isLate = now.getTime() > due.getTime();
  }

  const { data: existing } = await getClient(ctx)
    .from("homework_submissions")
    .select("id, version, status")
    .eq("homework_id", input.homeworkId)
    .eq("student_id", input.studentId)
    .maybeSingle();

  if (existing && ["graded", "reviewed", "completed"].includes(String(existing.status))) {
    throw new ValidationFailedError([
      {
        field: "status",
        code: "locked",
        message: "Graded submissions cannot be replaced",
      },
    ]);
  }

  const status = isLate ? "late" : "submitted";
  const priorStatus = existing ? String(existing.status) : null;
  // First real turn-in from pending keeps version 1; replace/resubmit bumps.
  const version =
    !existing || priorStatus === "pending"
      ? Number(existing?.version ?? 1)
      : Number(existing.version ?? 1) + 1;

  const row: Record<string, unknown> = {
    homework_id: input.homeworkId,
    student_id: input.studentId,
    content: input.content,
    status,
    is_late: isLate,
    version,
    attachments: input.attachments ?? [],
    external_links: input.externalLinks ?? [],
    submitted_at: now.toISOString(),
    school_id: schoolId,
    updated_at: now.toISOString(),
  };
  // Clear prior review fields on replace / return→resubmit
  if (existing && priorStatus !== "pending") {
    row.grade = null;
    row.marks_obtained = null;
    row.teacher_remarks = null;
    row.graded_at = null;
    row.reviewed_at = null;
    row.returned_at = null;
  }

  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .upsert(row as never, { onConflict: "homework_id,student_id" })
    .select("*")
    .single();

  throwIfError(error, "Failed to submit homework");
  return mapSubmission(data as SubmissionRow);
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
