import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";

/**
 * TestService — product "Test" maps to `dpps`.
 * Wraps table/RPC access so panels never touch raw tables for writes.
 */
export const TestService = {
  async listForClass(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "test");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("dpps")
      .select("*")
      .eq("class_id", classId)
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false });
    throwIfError(error, "Failed to list tests");
    return data ?? [];
  },

  async create(
    ctx: ServiceContext,
    input: {
      classId: string;
      title: string;
      subject?: string;
      subjectId?: string | null;
      difficulty?: string;
      duration_sec?: number;
    },
  ) {
    assertCanOwn(ctx, "test");
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
      } as never)
      .select("*")
      .single();
    throwIfError(error, "Failed to create test");
    await emitEvent(toRepoContext(ctx), {
      eventType: "test.scheduled",
      entityType: "test",
      entityId: (data as { id: string }).id,
      classId: input.classId,
      payload: { title: input.title, subject: input.subject },
    }).catch(() => undefined);
    return data;
  },

  async remove(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    await getClient(toRepoContext(ctx)).from("dpp_questions").delete().eq("dpp_id", testId);
    const { error } = await getClient(toRepoContext(ctx))
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
