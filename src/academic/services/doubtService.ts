import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";

/**
 * DoubtService — wraps community doubt RPCs behind academic ownership.
 */
export const DoubtService = {
  async list(ctx: ServiceContext, filters?: { classId?: string; subject?: string }) {
    assertCanConsume(ctx, "student_doubt");
    let q = getClient(toRepoContext(ctx))
      .from("community_doubts")
      .select("*")
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (filters?.classId) q = q.eq("class_id", filters.classId);
    if (filters?.subject) q = q.eq("subject", filters.subject);
    const { data, error } = await q;
    throwIfError(error, "Failed to list doubts");
    return data ?? [];
  },

  async create(ctx: ServiceContext, args: Record<string, unknown>) {
    assertCanOwn(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_create_community_doubt",
      args as never,
    );
    throwIfError(error, "Failed to create doubt");
    await emitEvent(toRepoContext(ctx), {
      eventType: "doubt.created",
      entityType: "student_doubt",
      entityId: typeof data === "string" ? data : (data as { id?: string })?.id ?? null,
      studentId: ctx.studentId ?? null,
      payload: args,
    }).catch(() => undefined);
    return data;
  },

  async reply(ctx: ServiceContext, args: Record<string, unknown>) {
    assertCanOwn(ctx, "teacher_reply");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_add_community_answer",
      args as never,
    );
    throwIfError(error, "Failed to reply to doubt");
    await emitEvent(toRepoContext(ctx), {
      eventType: "doubt.replied",
      entityType: "teacher_reply",
      entityId: typeof data === "string" ? data : (data as { id?: string })?.id ?? null,
      payload: args,
    }).catch(() => undefined);
    return data;
  },
};
