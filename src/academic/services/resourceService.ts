/**
 * ResourceService — published learning_resources for the student Resources library.
 * Never invent materials; empty list when none published for the class/school.
 */

import {
  assertCanConsume,
  assertCanOwn,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import {
  listAssignedClassesForTeacher,
  type AssignedClass,
} from "../repository/teacherClassesRepository";
import { uploadAcademicFile } from "../storage/academicFileUpload";

/**
 * The live resource_type enum, in enum order.
 *
 * Eight labels: the original seven plus `image`, which sits at position 2
 * because 20260904170000_restore_resource_kinds.sql recreated the type rather
 * than appending to it. The column is NOT NULL with NO DEFAULT — deliberately,
 * per that migration's own comment: it used to default to 'link', so a form
 * that omitted the field silently produced a link. The caller must say what it
 * is uploading, so there is no default here either.
 */
export const RESOURCE_KINDS = [
  "pdf",
  "image",
  "video",
  "link",
  "notes",
  "worksheet",
  "presentation",
  "other",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

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
    // `image` is a real enum label and was falling through to "Other".
    case "image":
      return "Image";
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
    subject: row.subject?.trim() || "",
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

  /**
   * Classes this teacher may target. §10.11 restricts upload to classes they
   * teach, and resources_write enforces teacher_teaches_class(auth.uid(),
   * class_id) — this is the same set, so the picker cannot offer a class the
   * insert would then refuse.
   */
  async listTeachableClasses(ctx: ServiceContext): Promise<AssignedClass[]> {
    assertCanOwn(ctx, "learning_resource");
    return listAssignedClassesForTeacher(toRepoContext(ctx), ctx.userId);
  },

  /** Everything this teacher has uploaded, newest first; optionally one class. */
  async listForTeacher(
    ctx: ServiceContext,
    opts?: { classId?: string | null },
  ): Promise<LearningResourceRow[]> {
    assertCanOwn(ctx, "learning_resource");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (getClient(toRepoContext(ctx)) as any)
      .from("learning_resources")
      .select(
        "id, title, subject, resource_type, description, url, storage_path, published_at, class_id, is_published",
      )
      .eq("school_id", ctx.schoolId)
      .eq("created_by", ctx.userId);

    if (opts?.classId) q = q.eq("class_id", opts.classId);

    const { data, error } = await q.order("published_at", { ascending: false }).limit(200);
    throwIfError(error, "Failed to list your resources");
    return ((data ?? []) as DbResourceRow[]).map(mapRow);
  },

  /**
   * Publish one resource to a class the teacher teaches.
   *
   * Exactly one of `file` or `url` must be given. A file goes to the
   * academic-files bucket and its bucket-relative path is stored in
   * storage_path, which is what the student library already resolves through
   * publicAcademicFileUrl (Resources.tsx:22). A link is stored in `url`.
   *
   * `resourceType` is required and has no default, matching the column.
   */
  async create(
    ctx: ServiceContext,
    input: {
      classId: string;
      title: string;
      resourceType: ResourceKind;
      subject?: string | null;
      description?: string | null;
      file?: File | null;
      url?: string | null;
    },
  ): Promise<LearningResourceRow> {
    assertCanOwn(ctx, "learning_resource");

    const title = input.title.trim();
    if (!title) throw new Error("Give the resource a title");
    if (!input.classId) throw new Error("Choose the class this resource is for");
    if (!RESOURCE_KINDS.includes(input.resourceType)) {
      throw new Error(`Unknown resource type: ${input.resourceType}`);
    }

    const link = input.url?.trim() || "";
    if (!input.file && !link) throw new Error("Attach a file or paste a link");
    if (input.file && link) throw new Error("Attach a file or paste a link, not both");
    if (link && !/^https?:\/\//i.test(link)) {
      throw new Error("Link must start with http:// or https://");
    }

    let storagePath: string | null = null;
    if (input.file) {
      // Throws with a readable message on size/extension/RLS failure; the row
      // is only written once the object is actually in the bucket.
      storagePath = (await uploadAcademicFile(input.file)).storagePath;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getClient(toRepoContext(ctx)) as any)
      .from("learning_resources")
      .insert({
        school_id: ctx.schoolId,
        class_id: input.classId,
        title,
        subject: input.subject?.trim() || null,
        description: input.description?.trim() || null,
        resource_type: input.resourceType,
        url: link || null,
        storage_path: storagePath,
        created_by: ctx.userId,
      })
      .select(
        "id, title, subject, resource_type, description, url, storage_path, published_at, class_id, is_published",
      )
      .single();
    throwIfError(error, "Failed to publish the resource");
    return mapRow(data as DbResourceRow);
  },

  /**
   * Permanent delete by the uploader. §10.11: "Deletable by the uploader.
   * Permanent deletion — no trash." resources_delete carries
   * created_by = auth.uid(), so another teacher's row matches no rows rather
   * than erroring — hence the explicit count check below.
   */
  async remove(ctx: ServiceContext, id: string): Promise<void> {
    assertCanOwn(ctx, "learning_resource");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getClient(toRepoContext(ctx)) as any)
      .from("learning_resources")
      .delete()
      .eq("id", id)
      .select("id");
    throwIfError(error, "Failed to delete the resource");
    if (!((data ?? []) as { id: string }[]).length) {
      throw new Error("That resource is not yours to delete");
    }
  },
};
