/**
 * ResourceService — published learning_resources for the student Resources library.
 * Never invent materials; empty list when none published for the class/school.
 */

import {
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";

export type LearningResourceRow = {
  id: string;
  title: string;
  subject: string;
  type: string;
  description: string | null;
  url: string | null;
  storagePath: string | null;
  publishedAt: string | null;
  classId: string | null;
};

type DbResourceRow = {
  id: string;
  title: string;
  subject: string | null;
  resource_type: string;
  description: string | null;
  url: string | null;
  storage_path: string | null;
  published_at: string | null;
  class_id: string | null;
  is_published: boolean;
};

function mapType(resourceType: string): string {
  switch (resourceType) {
    case "video":
      return "Video";
    case "pdf":
      return "PDF";
    case "notes":
      return "Notes";
    case "worksheet":
      return "Worksheet";
    case "presentation":
      return "Presentation";
    case "link":
      return "Link";
    default:
      return "Other";
  }
}

function mapRow(row: DbResourceRow): LearningResourceRow {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject?.trim() || "General",
    type: mapType(row.resource_type),
    description: row.description,
    url: row.url,
    storagePath: row.storage_path,
    publishedAt: row.published_at,
    classId: row.class_id,
  };
}

export const ResourceService = {
  /**
   * Published resources for the student's class (plus school-wide when class_id is null).
   */
  async listForStudent(
    ctx: ServiceContext,
    opts?: { classId?: string | null },
  ): Promise<LearningResourceRow[]> {
    assertCanConsume(ctx, "learning_resource");

    let classId = opts?.classId ?? null;
    if (opts?.classId === undefined && ctx.studentId) {
      const { data: stu } = await getClient(toRepoContext(ctx))
        .from("students")
        .select("class_id")
        .eq("id", ctx.studentId)
        .maybeSingle();
      classId = (stu?.class_id as string | null) ?? null;
    }

    // learning_resources may predate generated Database types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (getClient(toRepoContext(ctx)) as any)
      .from("learning_resources")
      .select(
        "id, title, subject, resource_type, description, url, storage_path, published_at, class_id, is_published",
      )
      .eq("school_id", ctx.schoolId)
      .eq("is_published", true);

    if (classId) {
      q = q.or(`class_id.eq.${classId},class_id.is.null`);
    } else {
      q = q.is("class_id", null);
    }

    const { data, error } = await q.order("published_at", { ascending: false }).limit(100);
    throwIfError(error, "Failed to list learning resources");
    return ((data ?? []) as DbResourceRow[]).map(mapRow);
  },
};
