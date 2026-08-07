import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEventBestEffort } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { teacherAssignedToClassSubject } from "../repository/teacherAssignmentRepository";
import {
  listSubjectsForClass,
  listTeacherClassSubjectPairs,
} from "../repository/teacherClassesRepository";
import type { DoubtUploadMeta } from "../storage/doubtFileUpload";
import { fixUtf8Content } from "@/lib/utf8Text";

export type DoubtStatus = "open" | "solved";

export type DoubtAttachmentRow = {
  id: string;
  doubt_id?: string;
  answer_id?: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
};

export type DoubtRow = {
  id: string;
  school_id: string | null;
  user_id: string;
  student_id: string | null;
  class_id: string | null;
  student_name: string;
  class_label: string;
  subject: string;
  subject_id: string | null;
  chapter: string;
  concept: string;
  title: string;
  body: string;
  image_url: string | null;
  status: string;
  answer_count: number;
  view_count: number;
  solved_at: string | null;
  solved_by_answer_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
};

export type TeacherDoubtDashboard = {
  unanswered: (DoubtRow & { status: DoubtStatus })[];
  attention: (DoubtRow & { status: DoubtStatus })[];
  concepts: { label: string; total: number; unresolved: number }[];
  totals: { open: number; teacher_answered: number; solved: number };
};

export type DoubtAnswerRow = {
  id: string;
  doubt_id: string;
  user_id: string;
  author_name: string;
  author_role: string;
  body: string;
  image_url: string | null;
  created_at: string;
};

function normalizeStatus(raw: string | null | undefined): DoubtStatus {
  if (!raw || raw === "unsolved" || raw === "open") return "open";
  return "solved";
}

function asDoubt(row: DoubtRow): DoubtRow & { status: DoubtStatus } {
  return {
    ...row,
    title: fixUtf8Content(row.title),
    body: fixUtf8Content(row.body),
    subject: fixUtf8Content(row.subject),
    chapter: row.chapter != null ? fixUtf8Content(row.chapter) : row.chapter,
    concept: row.concept != null ? fixUtf8Content(row.concept) : row.concept,
    status: normalizeStatus(row.status),
  };
}

/**
 * DoubtService — class doubt portal on community_doubts.
 * Teacher visibility uses teacher_classes via teacherAssignedToClassSubject.
 * First answer solves atomically via DB trigger.
 */
export const DoubtService = {
  normalizeStatus,

  async listSubjectsForStudentClass(ctx: ServiceContext) {
    assertCanConsume(ctx, "student_doubt");
    if (!ctx.classId) return [];
    return listSubjectsForClass(toRepoContext(ctx), ctx.classId);
  },

  /** Teacher class+subject pairs from teacher_classes (assignment SSOT). */
  async listTeacherAssignments(ctx: ServiceContext) {
    assertCanConsume(ctx, "student_doubt");
    if (ctx.role !== "teacher" && ctx.role !== "admin" && ctx.role !== "principal") {
      throw new ForbiddenError("Teacher assignments require a teacher role");
    }
    return listTeacherClassSubjectPairs(toRepoContext(ctx), ctx.userId);
  },

  /**
   * Teacher/admin/principal triage view — rpc_teacher_doubt_dashboard(), already
   * deployed and RLS-scoped, was never called by any frontend page. Returns the
   * unanswered list, an attention-ranked subset (view_count desc, created_at asc),
   * a per-concept unresolved breakdown, and totals.
   */
  async getTeacherDashboard(ctx: ServiceContext): Promise<TeacherDoubtDashboard> {
    assertCanConsume(ctx, "student_doubt");
    if (ctx.role !== "teacher" && ctx.role !== "admin" && ctx.role !== "principal") {
      throw new ForbiddenError("Doubt triage dashboard requires a teacher role");
    }
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_teacher_doubt_dashboard",
    );
    throwIfError(error, "Failed to load doubt triage dashboard");
    const raw = (data ?? {}) as Partial<TeacherDoubtDashboard>;
    const fix = (row: DoubtRow) => asDoubt(row);
    return {
      unanswered: ((raw.unanswered ?? []) as DoubtRow[]).map(fix),
      attention: ((raw.attention ?? []) as DoubtRow[]).map(fix),
      concepts: (raw.concepts ?? []) as TeacherDoubtDashboard["concepts"],
      totals: (raw.totals ?? { open: 0, teacher_answered: 0, solved: 0 }) as TeacherDoubtDashboard["totals"],
    };
  },

  async list(
    ctx: ServiceContext,
    filters?: {
      classId?: string;
      subject?: string;
      subjectId?: string;
      status?: DoubtStatus | "all";
      mineOnly?: boolean;
    },
  ) {
    assertCanConsume(ctx, "student_doubt");
    const client = getClient(toRepoContext(ctx));

    let q = client
      .from("community_doubts")
      .select("*")
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (ctx.role === "student") {
      const classId = filters?.classId ?? ctx.classId;
      if (!classId) return [];
      q = q.eq("class_id", classId);
    } else if (ctx.role === "teacher") {
      // RLS enforces class+subject; optionally narrow client-side filters
      if (filters?.classId) q = q.eq("class_id", filters.classId);
    } else if (filters?.classId) {
      q = q.eq("class_id", filters.classId);
    }

    // Prefer OR of subject_id + subject text — older doubts may only have one populated.
    if (filters?.subjectId && filters?.subject) {
      const sid = filters.subjectId.replace(/[^a-fA-F0-9-]/g, "");
      const sub = filters.subject.replace(/"/g, "");
      q = q.or(`subject_id.eq.${sid},subject.ilike."${sub}"`);
    } else if (filters?.subjectId) {
      q = q.eq("subject_id", filters.subjectId);
    } else if (filters?.subject) {
      q = q.ilike("subject", filters.subject);
    }
    if (filters?.mineOnly && ctx.userId) q = q.eq("user_id", ctx.userId);

    const { data, error } = await q;
    throwIfError(error, "Failed to list doubts");

    let rows = ((data ?? []) as DoubtRow[]).map(asDoubt);

    // Defense in depth for teachers: filter to assigned class+subject only.
    // Single RPC call matches RLS (subject_id OR text, case-insensitive).
    if (ctx.role === "teacher") {
      const repo = toRepoContext(ctx);
      const checked: DoubtRow[] = [];
      for (const row of rows) {
        if (!row.class_id) continue;
        const ok = await teacherAssignedToClassSubject(repo, {
          teacherUserId: ctx.userId,
          classId: row.class_id,
          subjectId: row.subject_id,
          subject: row.subject,
        });
        if (ok) checked.push(row);
      }
      rows = checked.map(asDoubt);
    }

    if (filters?.status && filters.status !== "all") {
      rows = rows.filter((r) => normalizeStatus(r.status) === filters.status);
    }

    return rows;
  },

  async get(ctx: ServiceContext, doubtId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("community_doubts")
      .select("*")
      .eq("id", doubtId)
      .maybeSingle();
    throwIfError(error, "Failed to load doubt");
    if (!data) return null;

    const row = asDoubt(data as DoubtRow);
    if (ctx.role === "teacher" && row.class_id) {
      const ok = await teacherAssignedToClassSubject(toRepoContext(ctx), {
        teacherUserId: ctx.userId,
        classId: row.class_id,
        subjectId: row.subject_id,
        subject: row.subject,
      });
      if (!ok) throw new ForbiddenError("Not assigned to this class and subject");
    }
    if (ctx.role === "student" && ctx.classId && row.class_id !== ctx.classId) {
      throw new ForbiddenError("Doubt is not in your class");
    }
    return row;
  },

  async listAnswers(ctx: ServiceContext, doubtId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("community_doubt_answers")
      .select("id, doubt_id, user_id, author_name, author_role, body, image_url, created_at")
      .eq("doubt_id", doubtId)
      .order("created_at", { ascending: true });
    throwIfError(error, "Failed to list answers");
    return ((data ?? []) as DoubtAnswerRow[]).map((r) => ({
      ...r,
      body: fixUtf8Content(r.body),
      author_name: fixUtf8Content(r.author_name),
    }));
  },

  async listDoubtAttachments(ctx: ServiceContext, doubtId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("community_doubt_attachments")
      .select("id, doubt_id, storage_path, file_name, file_type, file_size_bytes, created_at")
      .eq("doubt_id", doubtId)
      .order("created_at", { ascending: true });
    throwIfError(error, "Failed to list attachments");
    return (data ?? []) as DoubtAttachmentRow[];
  },

  async listAnswerAttachments(ctx: ServiceContext, answerId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("community_doubt_answer_attachments")
      .select("id, answer_id, storage_path, file_name, file_type, file_size_bytes, created_at")
      .eq("answer_id", answerId)
      .order("created_at", { ascending: true });
    throwIfError(error, "Failed to list answer attachments");
    return (data ?? []) as DoubtAttachmentRow[];
  },

  async create(
    ctx: ServiceContext,
    args: {
      subject: string;
      subjectId?: string | null;
      content: string;
      title?: string;
      chapter?: string;
      concept?: string;
      /** Legacy single image URL (community portal / doubt-images). Prefer attachments. */
      imageUrl?: string | null;
      attachments?: DoubtUploadMeta[];
    },
  ) {
    assertCanOwn(ctx, "student_doubt");
    if (ctx.role !== "student") {
      throw new ForbiddenError("Only students may post doubts");
    }
    const body = args.content.trim();
    if (!body) throw new ForbiddenError("Doubt text is required");
    const subject = args.subject.trim();
    if (!subject) throw new ForbiddenError("Subject is required");

    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_create_community_doubt",
      {
        _subject: subject,
        _chapter: args.chapter ?? "",
        _concept: args.concept ?? "",
        _title: args.title?.trim() || body.slice(0, 80),
        _body: body,
        _image_url: args.imageUrl ?? null,
        _subject_id: args.subjectId ?? null,
      } as never,
    );
    throwIfError(error, "Failed to create doubt");
    const doubtId = typeof data === "string" ? data : String(data);

    if (args.attachments?.length) {
      const rows = args.attachments.map((a) => ({
        school_id: ctx.schoolId,
        doubt_id: doubtId,
        storage_path: a.storagePath,
        file_name: a.fileName,
        file_type: a.fileType,
        file_size_bytes: a.fileSizeBytes,
        created_by: ctx.userId,
      }));
      const { error: attErr } = await getClient(toRepoContext(ctx))
        .from("community_doubt_attachments")
        .insert(rows as never);
      throwIfError(attErr, "Failed to save attachments");
    }

    await emitEventBestEffort(toRepoContext(ctx), {
      eventType: "doubt.created",
      entityType: "student_doubt",
      entityId: doubtId,
      studentId: ctx.studentId ?? null,
      payload: { subject, subjectId: args.subjectId ?? null },
    });
    broadcastAcademicWrite(ctx.schoolId, ["doubt", "profile"], {
      studentId: ctx.studentId,
      source: "DoubtService.create",
    });
    return doubtId;
  },

  async reply(
    ctx: ServiceContext,
    args: {
      doubtId: string;
      content: string;
      /** Legacy single image URL. Prefer attachments. */
      imageUrl?: string | null;
      attachments?: DoubtUploadMeta[];
    },
  ) {
    if (ctx.role === "teacher") {
      assertCanOwn(ctx, "teacher_reply");
    } else if (ctx.role === "student") {
      assertCanOwn(ctx, "student_doubt");
    } else {
      throw new ForbiddenError("Only students and teachers may reply to doubts");
    }

    const body = args.content.trim();
    if (!body) throw new ForbiddenError("Answer text is required");

    const client = getClient(toRepoContext(ctx));
    let askerStudentId: string | null = ctx.studentId ?? null;
    try {
      const doubtBefore = await this.get(ctx, args.doubtId);
      askerStudentId = doubtBefore?.student_id ?? askerStudentId;
    } catch {
      // Keep reply success even if owner lookup fails; still emit with best-effort id.
    }

    const { data, error } = await client.rpc("rpc_add_community_answer", {
      _doubt_id: args.doubtId,
      _body: body,
      _image_url: args.imageUrl ?? null,
    } as never);
    throwIfError(error, "Failed to reply to doubt");
    const answerId = typeof data === "string" ? data : String(data);

    if (args.attachments?.length) {
      const rows = args.attachments.map((a) => ({
        school_id: ctx.schoolId,
        answer_id: answerId,
        storage_path: a.storagePath,
        file_name: a.fileName,
        file_type: a.fileType,
        file_size_bytes: a.fileSizeBytes,
        created_by: ctx.userId,
      }));
      const { error: attErr } = await client
        .from("community_doubt_answer_attachments")
        .insert(rows as never);
      throwIfError(attErr, "Failed to save answer attachments");
    }

    await emitEventBestEffort(toRepoContext(ctx), {
      eventType: "doubt.replied",
      entityType: ctx.role === "teacher" ? "teacher_reply" : "student_doubt",
      entityId: answerId,
      studentId: askerStudentId,
      payload: { doubtId: args.doubtId },
    });

    // First-answer → solved is emitted by tg_community_doubt_first_answer_solves (DB SSOT).

    broadcastAcademicWrite(ctx.schoolId, ["doubt", "profile"], {
      studentId: askerStudentId,
      source: "DoubtService.reply",
    });
    return answerId;
  },

  /** @deprecated Voting is out of scope for the class doubt portal model. */
  async voteDoubt(ctx: ServiceContext, doubtId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_vote_community_doubt",
      { _doubt_id: doubtId } as never,
    );
    throwIfError(error, "Failed to vote on doubt");
    broadcastAcademicWrite(ctx.schoolId, ["doubt", "profile"], {
      source: "DoubtService.voteDoubt",
    });
    return typeof data === "number" ? data : Number(data ?? 0);
  },

  /** @deprecated Voting is out of scope for the class doubt portal model. */
  async voteAnswer(ctx: ServiceContext, answerId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_vote_community_answer",
      { _answer_id: answerId } as never,
    );
    throwIfError(error, "Failed to vote on answer");
    broadcastAcademicWrite(ctx.schoolId, ["doubt", "profile"], {
      source: "DoubtService.voteAnswer",
    });
    return typeof data === "number" ? data : Number(data ?? 0);
  },

  /**
   * @deprecated First answer solves via DB trigger; kept for legacy CommunityDoubtPortal.
   */
  async markBestAnswer(ctx: ServiceContext, answerId: string) {
    assertCanOwn(ctx, "student_doubt");
    const { error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_mark_best_community_answer",
      { _answer_id: answerId } as never,
    );
    throwIfError(error, "Failed to accept answer");
    await emitEventBestEffort(toRepoContext(ctx), {
      eventType: "doubt.solved",
      entityType: "student_doubt",
      entityId: answerId,
      studentId: ctx.studentId ?? null,
      payload: { answerId },
    });
    broadcastAcademicWrite(ctx.schoolId, ["doubt", "profile"], {
      studentId: ctx.studentId,
      source: "DoubtService.markBestAnswer",
    });
  },
};
