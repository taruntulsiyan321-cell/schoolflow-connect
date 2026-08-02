import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";

export type AnnouncementPriority = "normal" | "important" | "urgent";
export type AnnouncementStatus = "draft" | "published" | "scheduled";

export type TeacherAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  targetClass: string;
  targetSection: string;
  classId: string | null;
  status: AnnouncementStatus;
  scheduledFor?: string;
  publishedAt?: string;
  hasAttachment: boolean;
  attachmentName?: string;
  priority: AnnouncementPriority;
};

type NoticeRow = {
  id: string;
  title: string;
  body: string;
  class_id: string | null;
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
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    targetClass: row.classes?.name ?? "",
    targetSection: row.classes?.section ?? "",
    classId: row.class_id,
    status,
    scheduledFor,
    publishedAt,
    hasAttachment: Boolean(row.attachment_url),
    attachmentName: row.attachment_url ? "Attachment" : undefined,
    priority: uiPriority(row.priority),
  };
}

export type UpsertAnnouncementInput = {
  title: string;
  body: string;
  classId: string;
  priority?: AnnouncementPriority;
  status?: AnnouncementStatus;
  scheduledFor?: string | null;
};

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

  async create(
    ctx: ServiceContext,
    input: UpsertAnnouncementInput,
  ): Promise<TeacherAnnouncementRow> {
    assertCanOwn(ctx, "announcement");
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
      audience: "class" as const,
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
    const status = input.status ?? "draft";
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
        class_id: input.classId,
        status,
        priority: dbPriority(input.priority ?? "normal"),
        published_at: publishedAt,
      } as never)
      .eq("id", id)
      .select("*, classes(name, section)")
      .single();
    throwIfError(error, "Failed to update announcement");

    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      classId: input.classId,
      source: "AnnouncementService.update",
    });
    return mapNotice(data as NoticeRow);
  },

  async remove(ctx: ServiceContext, id: string): Promise<void> {
    assertCanOwn(ctx, "announcement");
    const { error } = await getClient(toRepoContext(ctx))
      .from("notices")
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", id);
    throwIfError(error, "Failed to delete announcement");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "AnnouncementService.remove",
    });
  },
};
