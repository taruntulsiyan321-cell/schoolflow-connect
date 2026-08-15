import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";
import { NotFoundError, ValidationFailedError } from "../repository/errors";
import { validateAnnouncementContent } from "../validation/rules";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
import { assertMayAccessStudent } from "./parentAccess";
import { fixUtf8Content } from "@/lib/utf8Text";

export { ForbiddenError, isSchoolOperator } from "./context";
export { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
export { assertMayAccessStudent } from "./parentAccess";

export type AnnouncementPriority = "normal" | "important" | "urgent";
export type AnnouncementStatus = "draft" | "published" | "scheduled";
export type NoticeAudience = "all" | "students" | "parents" | "class" | "section";

export type TeacherAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  targetClass: string;
  targetSection: string;
  classId: string | null;
  audience: NoticeAudience;
  status: AnnouncementStatus;
  scheduledFor?: string;
  publishedAt?: string;
  hasAttachment: boolean;
  attachmentUrl?: string | null;
  attachmentName?: string;
  priority: AnnouncementPriority;
};

type NoticeRow = {
  id: string;
  title: string;
  body: string;
  class_id: string | null;
  audience: string;
  status: string;
  priority: string | null;
  published_at?: string | null;
  created_at: string;
  revoked_at: string | null;
  attachment_url?: string | null;
  classes?: { name: string; section: string } | null;
};

function uiPriority(db: string | null): AnnouncementPriority {
  if (db === "urgent") return "urgent";
  if (db === "high") return "important";
  return "normal";
}

function dbPriority(ui: AnnouncementPriority): "normal" | "high" | "urgent" {
  if (ui === "urgent") return "urgent";
  if (ui === "important") return "high";
  return "normal";
}

function uiStatus(db: string): AnnouncementStatus {
  if (db === "draft" || db === "scheduled" || db === "published") return db;
  return "published";
}

function uiAudience(db: string | null | undefined): NoticeAudience {
  if (db === "all" || db === "students" || db === "parents" || db === "section") {
    return db;
  }
  return "class";
}

function attachmentLabelFromUrl(url: string): string {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    const cleaned = base.replace(/^\d+-/, "").trim();
    if (cleaned) return cleaned;
  } catch {
    /* not a full URL — fall through */
  }
  const tail = url.split("/").pop()?.split("?")[0]?.trim();
  return tail || "Attachment";
}

function mapNotice(row: NoticeRow): TeacherAnnouncementRow {
  const status = uiStatus(row.status);
  const publishedAt =
    status === "published"
      ? (row.published_at ?? row.created_at)?.slice(0, 10)
      : undefined;
  const scheduledFor =
    status === "scheduled" && row.published_at
      ? row.published_at.slice(0, 16)
      : undefined;
  const attachmentUrl = row.attachment_url?.trim() || null;
  return {
    id: row.id,
    title: fixUtf8Content(row.title),
    body: fixUtf8Content(row.body),
    targetClass: row.classes?.name ?? "",
    targetSection: row.classes?.section ?? "",
    classId: row.class_id,
    audience: uiAudience(row.audience),
    status,
    scheduledFor,
    publishedAt,
    hasAttachment: Boolean(attachmentUrl),
    attachmentUrl,
    attachmentName: attachmentUrl ? attachmentLabelFromUrl(attachmentUrl) : undefined,
    priority: uiPriority(row.priority),
  };
}

export type UpsertAnnouncementInput = {
  title: string;
  body: string;
  /** Null for a school-wide notice (audience "all" / "students" / "parents"). */
  classId: string | null;
  priority?: AnnouncementPriority;
  status?: AnnouncementStatus;
  scheduledFor?: string | null;
  audience?: NoticeAudience;
};

/** Teachers must own the target class; school operators bypass. A null
 * classId (school-wide notice) has no class to own, so only operators
 * (admin/principal) may publish it — a plain teacher cannot. */
export async function assertTeacherMayAnnounce(
  ctx: ServiceContext,
  classId: string | null,
): Promise<void> {
  if (isSchoolOperator(ctx.role)) return;
  if (classId === null) {
    throw new ForbiddenError("Only admins/principals may publish a school-wide announcement");
  }
  if (ctx.role !== "teacher") {
    throw new ForbiddenError("Only teachers may publish class announcements");
  }
  await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
}

async function loadNoticeForMutation(
  ctx: ServiceContext,
  id: string,
): Promise<NoticeRow> {
  const repo = toRepoContext(ctx);
  const { data, error } = await getClient(repo)
    .from("notices")
    .select("*, classes(name, section)")
    .eq("id", id)
    .eq("school_id", ctx.schoolId)
    .is("revoked_at", null)
    .maybeSingle();
  throwIfError(error, "Failed to load announcement");
  if (!data) throw new NotFoundError("announcement", id);
  return data as NoticeRow;
}

async function resolveStudentClassId(ctx: ServiceContext): Promise<string | null> {
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);
  if (ctx.studentId) {
    const { data, error } = await getClient(repo)
      .from("students")
      .select("class_id")
      .eq("id", ctx.studentId)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(error, "Failed to resolve student class");
    return data?.class_id ?? null;
  }
  const { data, error } = await getClient(repo)
    .from("students")
    .select("class_id")
    .eq("user_id", ctx.userId)
    .eq("school_id", schoolId)
    .maybeSingle();
  throwIfError(error, "Failed to resolve student class");
  return data?.class_id ?? null;
}

async function resolveParentClassIds(ctx: ServiceContext): Promise<string[]> {
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);
  const classIds = new Set<string>();

  const { data: direct, error: dErr } = await getClient(repo)
    .from("students")
    .select("class_id")
    .eq("school_id", schoolId)
    .eq("parent_user_id", ctx.userId);
  throwIfError(dErr, "Failed to list parent-linked students");
  for (const row of direct ?? []) {
    if (row.class_id) classIds.add(String(row.class_id));
  }

  const { data: parentRow, error: pErr } = await getClient(repo)
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  throwIfError(pErr, "Failed to resolve parent row");
  if (parentRow?.id) {
    const { data: links, error: lErr } = await getClient(repo)
      .from("parent_students")
      .select("student_id")
      .eq("school_id", schoolId)
      .eq("parent_id", parentRow.id);
    throwIfError(lErr, "Failed to list parent_students");
    const studentIds = (links ?? []).map((l) => String(l.student_id));
    if (studentIds.length) {
      const { data: children, error: cErr } = await getClient(repo)
        .from("students")
        .select("class_id")
        .eq("school_id", schoolId)
        .in("id", studentIds);
      throwIfError(cErr, "Failed to load linked student classes");
      for (const row of children ?? []) {
        if (row.class_id) classIds.add(String(row.class_id));
      }
    }
  }

  return [...classIds];
}

function noticeVisibleToStudentRow(
  row: TeacherAnnouncementRow,
  classId: string | null,
): boolean {
  if (row.audience === "all" || row.audience === "students") return true;
  if (
    (row.audience === "class" || row.audience === "section") &&
    classId &&
    row.classId === classId
  ) {
    return true;
  }
  return false;
}

function noticeVisibleToParentRow(
  row: TeacherAnnouncementRow,
  classIds: string[],
): boolean {
  if (row.audience === "all" || row.audience === "parents") return true;
  if (
    row.classId &&
    classIds.includes(row.classId) &&
    (row.audience === "class" ||
      row.audience === "section" ||
      row.audience === "students")
  ) {
    return true;
  }
  return false;
}

/**
 * AnnouncementService — teacher class notices via `notices` (entity: announcement).
 * DB trigger emits `announcement.published` on insert / publish transition.
 */
export const AnnouncementService = {
  async listForTeacher(
    ctx: ServiceContext,
    classIds: string[],
  ): Promise<TeacherAnnouncementRow[]> {
    assertCanConsume(ctx, "announcement");
    if (!classIds.length) return [];

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .select("*, classes(name, section)")
      .eq("school_id", ctx.schoolId)
      .in("class_id", classIds)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    throwIfError(error, "Failed to list announcements");
    return (data ?? []).map((r) => mapNotice(r as NoticeRow));
  },

  /** Published notices scoped to one class (class/section audience + school-wide). */
  async listPublishedForClassScope(
    ctx: ServiceContext,
    classId: string,
  ): Promise<TeacherAnnouncementRow[]> {
    assertCanConsume(ctx, "announcement");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .select("*, classes(name, section)")
      .eq("school_id", ctx.schoolId)
      .eq("status", "published")
      .is("revoked_at", null)
      .order("published_at", { ascending: false })
      .limit(100);
    throwIfError(error, "Failed to list published class announcements");
    return (data ?? [])
      .map((r) => mapNotice(r as NoticeRow))
      .filter((row) => noticeVisibleToStudentRow(row, classId));
  },

  /** Published notices for the signed-in student (school-wide + class). */
  async listPublishedForStudent(ctx: ServiceContext): Promise<TeacherAnnouncementRow[]> {
    assertCanConsume(ctx, "announcement");
    if (ctx.role === "student" && ctx.studentId) {
      await assertMayAccessStudent(ctx, ctx.studentId);
    }
    const classId = await resolveStudentClassId(ctx);
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .select("*, classes(name, section)")
      .eq("school_id", ctx.schoolId)
      .eq("status", "published")
      .is("revoked_at", null)
      .order("published_at", { ascending: false })
      .limit(100);
    throwIfError(error, "Failed to list published announcements for student");
    return (data ?? [])
      .map((r) => mapNotice(r as NoticeRow))
      .filter((row) => noticeVisibleToStudentRow(row, classId));
  },

  /** Published notices for parent — school-wide + linked children's classes. */
  async listPublishedForParent(ctx: ServiceContext): Promise<TeacherAnnouncementRow[]> {
    assertCanConsume(ctx, "announcement");
    const classIds = await resolveParentClassIds(ctx);
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .select("*, classes(name, section)")
      .eq("school_id", ctx.schoolId)
      .eq("status", "published")
      .is("revoked_at", null)
      .order("published_at", { ascending: false })
      .limit(100);
    throwIfError(error, "Failed to list published announcements for parent");
    return (data ?? [])
      .map((r) => mapNotice(r as NoticeRow))
      .filter((row) => noticeVisibleToParentRow(row, classIds));
  },

  /** Published school notices for any consumer role. */
  async listPublishedForSchool(
    ctx: ServiceContext,
  ): Promise<TeacherAnnouncementRow[]> {
    assertCanConsume(ctx, "announcement");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .select("*, classes(name, section)")
      .eq("school_id", ctx.schoolId)
      .eq("status", "published")
      .is("revoked_at", null)
      .order("published_at", { ascending: false })
      .limit(100);
    throwIfError(error, "Failed to list published announcements");
    return (data ?? []).map((r) => mapNotice(r as NoticeRow));
  },

  /** All school notices (draft / scheduled / published) for principal/admin. */
  async listForSchool(ctx: ServiceContext): Promise<TeacherAnnouncementRow[]> {
    assertCanConsume(ctx, "announcement");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School announcement list is admin/principal-only");
    }
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .select("*, classes(name, section)")
      .eq("school_id", ctx.schoolId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    throwIfError(error, "Failed to list school announcements");
    return (data ?? []).map((r) => mapNotice(r as NoticeRow));
  },

  async create(
    ctx: ServiceContext,
    input: UpsertAnnouncementInput,
  ): Promise<TeacherAnnouncementRow> {
    assertCanOwn(ctx, "announcement");
    await assertTeacherMayAnnounce(ctx, input.classId);
    const validation = validateAnnouncementContent(input.title, input.body);
    if (validation.ok === false) {
      throw new ValidationFailedError(validation.issues);
    }

    const status = input.status ?? "draft";
    const publishedAt =
      status === "published"
        ? new Date().toISOString()
        : status === "scheduled" && input.scheduledFor
          ? new Date(input.scheduledFor).toISOString()
          : null;

    const payload = {
      title: input.title.trim(),
      body: input.body.trim(),
      audience: (input.audience ?? "class") as NoticeAudience,
      class_id: input.classId,
      school_id: ctx.schoolId,
      posted_by: ctx.userId,
      status,
      priority: dbPriority(input.priority ?? "normal"),
      published_at: publishedAt,
    };

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .insert(payload as never)
      .select("*, classes(name, section)")
      .single();
    throwIfError(error, "Failed to create announcement");

    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      classId: input.classId,
      source: "AnnouncementService.create",
    });
    return mapNotice(data as NoticeRow);
  },

  async update(
    ctx: ServiceContext,
    id: string,
    input: UpsertAnnouncementInput,
  ): Promise<TeacherAnnouncementRow> {
    assertCanOwn(ctx, "announcement");
    const existing = await loadNoticeForMutation(ctx, id);
    const classId = input.classId ?? existing.class_id;
    const resolvedAudience = (input.audience ?? uiAudience(existing.audience)) as NoticeAudience;
    const audienceNeedsClass = resolvedAudience === "class" || resolvedAudience === "section";
    if (audienceNeedsClass && !classId) {
      throw new ValidationFailedError([
        { field: "classId", code: "required", message: "Class is required" },
      ]);
    }
    const effectiveClassId: string | null = audienceNeedsClass && classId ? classId : null;
    await assertTeacherMayAnnounce(ctx, effectiveClassId);
    const validation = validateAnnouncementContent(input.title, input.body);
    if (validation.ok === false) {
      throw new ValidationFailedError(validation.issues);
    }

    const status = input.status ?? uiStatus(existing.status);
    const publishedAt =
      status === "published"
        ? new Date().toISOString()
        : status === "scheduled" && input.scheduledFor
          ? new Date(input.scheduledFor).toISOString()
          : null;

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .update({
        title: input.title.trim(),
        body: input.body.trim(),
        class_id: classId,
        audience: (input.audience ?? uiAudience(existing.audience)) as NoticeAudience,
        status,
        priority: dbPriority(input.priority ?? uiPriority(existing.priority)),
        published_at: publishedAt,
      } as never)
      .eq("id", id)
      .eq("school_id", ctx.schoolId)
      .select("*, classes(name, section)")
      .single();
    throwIfError(error, "Failed to update announcement");

    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      classId,
      source: "AnnouncementService.update",
    });
    return mapNotice(data as NoticeRow);
  },

  async remove(ctx: ServiceContext, id: string): Promise<void> {
    assertCanOwn(ctx, "announcement");
    const existing = await loadNoticeForMutation(ctx, id);
    if (existing.class_id) {
      await assertTeacherMayAnnounce(ctx, existing.class_id);
    } else if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may revoke school-wide notices");
    }

    const { error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", id)
      .eq("school_id", ctx.schoolId);
    throwIfError(error, "Failed to delete announcement");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      classId: existing.class_id ?? undefined,
      source: "AnnouncementService.remove",
    });
  },
};
