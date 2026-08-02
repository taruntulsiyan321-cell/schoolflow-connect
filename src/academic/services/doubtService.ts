import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";

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
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "DoubtService.create",
    });
    return data;
  },

  async reply(ctx: ServiceContext, args: Record<string, unknown>) {
    // Community portal allows peer (student) answers and teacher replies via the same RPC.
    if (ctx.role === "teacher") {
      assertCanOwn(ctx, "teacher_reply");
    } else if (ctx.role === "student") {
      assertCanOwn(ctx, "student_doubt");
    } else {
      throw new ForbiddenError("Only students and teachers may reply to community doubts");
    }
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
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "DoubtService.reply",
    });
    return data;
  },

  async voteDoubt(ctx: ServiceContext, doubtId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_vote_community_doubt",
      { _doubt_id: doubtId } as never,
    );
    throwIfError(error, "Failed to vote on doubt");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "DoubtService.voteDoubt",
    });
    return typeof data === "number" ? data : Number(data ?? 0);
  },

  async voteAnswer(ctx: ServiceContext, answerId: string) {
    assertCanConsume(ctx, "student_doubt");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_vote_community_answer",
      { _answer_id: answerId } as never,
    );
    throwIfError(error, "Failed to vote on answer");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "DoubtService.voteAnswer",
    });
    return typeof data === "number" ? data : Number(data ?? 0);
  },
};
