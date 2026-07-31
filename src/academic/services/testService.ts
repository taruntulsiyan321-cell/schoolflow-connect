import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { assertTeacherMayManageAcademicWork } from "./workLifecycle";
import type { TestKind } from "./workLifecycle";

export type TestStatus = "draft" | "scheduled" | "published" | "archived";

export interface CreateTestInput {
  classId: string;
  title: string;
  subject?: string;
  subjectId?: string | null;
  testKind?: TestKind | string;
  difficulty?: string;
  duration_sec?: number;
  maxMarks?: number | null;
  passingMarks?: number | null;
  chapters?: string[];
  topics?: string[];
  status?: TestStatus | string;
  scheduledPublishAt?: string | null;
}

export type UpdateTestInput = Partial<CreateTestInput>;

/**
 * TestService — product "Test" maps to `dpps`.
 * Wraps table/RPC access so panels never touch raw tables for writes.
 */
export const TestService = {
  async listForClass(
    ctx: ServiceContext,
    classId: string,
    opts?: { status?: string; testKind?: string },
  ) {
    assertCanConsume(ctx, "test");
    let q = getClient(toRepoContext(ctx))
      .from("dpps")
      .select("*")
      .eq("class_id", classId)
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false });

    const statusFilter =
      ctx.role === "student" || ctx.role === "parent"
        ? "published"
        : opts?.status;
    if (statusFilter) q = q.eq("status", statusFilter);
    if (opts?.testKind) q = q.eq("test_kind", opts.testKind);

    const { data, error } = await q;
    throwIfError(error, "Failed to list tests");
    return data ?? [];
  },

  async create(ctx: ServiceContext, input: CreateTestInput) {
    assertCanOwn(ctx, "test");
    await assertTeacherMayManageAcademicWork(ctx, input.classId, input.subject);
    const status = input.status ?? "draft";
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("dpps")
      .insert({
        class_id: input.classId,
        title: input.title,
        subject: input.subject ?? "",
        subject_id: input.subjectId ?? null,
        school_id: ctx.schoolId,
        created_by: ctx.userId,
        difficulty: input.difficulty ?? "medium",
        duration_sec: input.duration_sec ?? 1800,
        test_kind: input.testKind ?? "class_test",
        max_marks: input.maxMarks ?? null,
        passing_marks: input.passingMarks ?? null,
        chapters: input.chapters ?? [],
        topics: input.topics ?? [],
        status,
        scheduled_publish_at: input.scheduledPublishAt ?? null,
        published_at: status === "published" ? new Date().toISOString() : null,
      } as never)
      .select("*")
      .single();
    throwIfError(error, "Failed to create test");
    const row = data as { id: string };
    if (status === "scheduled") {
      await emitEvent(toRepoContext(ctx), {
        eventType: "test.scheduled",
        entityType: "test",
        entityId: row.id,
        classId: input.classId,
        payload: {
          title: input.title,
          subject: input.subject,
          testKind: input.testKind ?? "class_test",
        },
      }).catch(() => undefined);
    } else if (status === "published") {
      await emitEvent(toRepoContext(ctx), {
        eventType: "test.published",
        entityType: "test",
        entityId: row.id,
        classId: input.classId,
        payload: {
          title: input.title,
          subject: input.subject,
          testKind: input.testKind ?? "class_test",
        },
      }).catch(() => undefined);
    }
    return data;
  },

  async update(ctx: ServiceContext, testId: string, patch: UpdateTestInput) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const { data: existing, error: loadErr } = await getClient(repo)
      .from("dpps")
      .select("id, class_id, subject")
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();
    throwIfError(loadErr, "Failed to load test");
    if (!existing) throw new ForbiddenError("Test not found");
    await assertTeacherMayManageAcademicWork(
      ctx,
      String(existing.class_id),
      patch.subject ?? String(existing.subject ?? ""),
    );

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.subject !== undefined) row.subject = patch.subject;
    if (patch.subjectId !== undefined) row.subject_id = patch.subjectId;
    if (patch.classId !== undefined) row.class_id = patch.classId;
    if (patch.testKind !== undefined) row.test_kind = patch.testKind;
    if (patch.difficulty !== undefined) row.difficulty = patch.difficulty;
    if (patch.duration_sec !== undefined) row.duration_sec = patch.duration_sec;
    if (patch.maxMarks !== undefined) row.max_marks = patch.maxMarks;
    if (patch.passingMarks !== undefined) row.passing_marks = patch.passingMarks;
    if (patch.chapters !== undefined) row.chapters = patch.chapters;
    if (patch.topics !== undefined) row.topics = patch.topics;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.scheduledPublishAt !== undefined) {
      row.scheduled_publish_at = patch.scheduledPublishAt;
    }

    const { data, error } = await getClient(repo)
      .from("dpps")
      .update(row as never)
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .select("*")
      .single();
    throwIfError(error, "Failed to update test");
    return data;
  },

  async publish(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const { data: existing, error: loadErr } = await getClient(repo)
      .from("dpps")
      .select("id, class_id, subject, title, test_kind")
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();
    throwIfError(loadErr, "Failed to load test");
    if (!existing) throw new ForbiddenError("Test not found");
    await assertTeacherMayManageAcademicWork(
      ctx,
      String(existing.class_id),
      String(existing.subject ?? ""),
    );

    const now = new Date().toISOString();
    const { data, error } = await getClient(repo)
      .from("dpps")
      .update({
        status: "published",
        published_at: now,
        updated_at: now,
      } as never)
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .select("*")
      .single();
    throwIfError(error, "Failed to publish test");
    await emitEvent(repo, {
      eventType: "test.published",
      entityType: "test",
      entityId: testId,
      classId: String(existing.class_id),
      payload: {
        title: existing.title,
        subject: existing.subject,
        testKind: existing.test_kind ?? "class_test",
      },
    }).catch(() => undefined);
    return data;
  },

  async archive(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const { data: existing, error: loadErr } = await getClient(repo)
      .from("dpps")
      .select("id, class_id, subject")
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();
    throwIfError(loadErr, "Failed to load test");
    if (!existing) throw new ForbiddenError("Test not found");
    await assertTeacherMayManageAcademicWork(
      ctx,
      String(existing.class_id),
      String(existing.subject ?? ""),
    );

    const now = new Date().toISOString();
    const { data, error } = await getClient(repo)
      .from("dpps")
      .update({
        status: "archived",
        archived_at: now,
        updated_at: now,
      } as never)
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .select("*")
      .single();
    throwIfError(error, "Failed to archive test");
    return data;
  },

  async schedule(ctx: ServiceContext, testId: string, at: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const { data: existing, error: loadErr } = await getClient(repo)
      .from("dpps")
      .select("id, class_id, subject, title, test_kind")
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();
    throwIfError(loadErr, "Failed to load test");
    if (!existing) throw new ForbiddenError("Test not found");
    await assertTeacherMayManageAcademicWork(
      ctx,
      String(existing.class_id),
      String(existing.subject ?? ""),
    );

    const { data, error } = await getClient(repo)
      .from("dpps")
      .update({
        status: "scheduled",
        scheduled_publish_at: at,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .select("*")
      .single();
    throwIfError(error, "Failed to schedule test");
    await emitEvent(repo, {
      eventType: "test.scheduled",
      entityType: "test",
      entityId: testId,
      classId: String(existing.class_id),
      payload: {
        title: existing.title,
        subject: existing.subject,
        testKind: existing.test_kind ?? "class_test",
        scheduledPublishAt: at,
      },
    }).catch(() => undefined);
    return data;
  },

  async remove(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const { data: existing, error: loadErr } = await getClient(repo)
      .from("dpps")
      .select("id, class_id, subject")
      .eq("id", testId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();
    throwIfError(loadErr, "Failed to load test");
    if (existing) {
      await assertTeacherMayManageAcademicWork(
        ctx,
        String(existing.class_id),
        String(existing.subject ?? ""),
      );
    }
    await getClient(repo).from("dpp_questions").delete().eq("dpp_id", testId);
    const { error } = await getClient(repo)
      .from("dpps")
      .delete()
      .eq("id", testId)
      .eq("school_id", ctx.schoolId);
    throwIfError(error, "Failed to delete test");
  },

  async startAttempt(ctx: ServiceContext, dppId: string) {
    assertCanOwn(ctx, "student_test_attempt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_dpp_start", {
      _dpp_id: dppId,
    } as never);
    throwIfError(error, "Failed to start test attempt");
    return data;
  },

  async submitAttempt(ctx: ServiceContext, attemptId: string, answers?: unknown) {
    assertCanOwn(ctx, "student_test_attempt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_dpp_submit", {
      _attempt_id: attemptId,
      ...(answers != null ? { _answers: answers } : {}),
    } as never);
    throwIfError(error, "Failed to submit test attempt");
    await emitEvent(toRepoContext(ctx), {
      eventType: "test.attempt.completed",
      entityType: "student_test_attempt",
      entityId: attemptId,
      studentId: ctx.studentId ?? null,
      payload: {},
    }).catch(() => undefined);
    return data;
  },
};
