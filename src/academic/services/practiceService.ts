import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";

/**
 * PracticeService — wraps practice session RPCs + finish path.
 * AI/practice modules should call this instead of raw RPCs where practical.
 */
export const PracticeService = {
  async start(
    ctx: ServiceContext,
    args: Record<string, unknown>,
  ) {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_start_practice_session",
      args as never,
    );
    throwIfError(error, "Failed to start practice session");
    return data;
  },

  async finish(
    ctx: ServiceContext,
    args: Record<string, unknown>,
  ) {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_finish_practice_session",
      args as never,
    );
    throwIfError(error, "Failed to finish practice session");
    await emitEvent(toRepoContext(ctx), {
      eventType: "practice.session.completed",
      entityType: "practice",
      entityId: (args._session_id as string) ?? null,
      studentId: ctx.studentId ?? null,
      payload: args,
    }).catch(() => undefined);
    broadcastAcademicWrite(ctx.schoolId, ["xp", "profile"], {
      studentId: ctx.studentId,
      source: "PracticeService",
    });
    notifyStudentXpUpdated();
    return data;
  },

  async getSession(ctx: ServiceContext, sessionId: string) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    throwIfError(error, "Failed to load practice session");
    return data;
  },

  async listRecentFinished(ctx: ServiceContext, limit = 10) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select("id, subject, chapter, question_count, correct_count, score, created_at, finished_at")
      .eq("user_id", ctx.userId)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load practice history");
    return data ?? [];
  },

  /** Approved bank questions for student practice sessions (honest empty if none). */
  async listBankQuestions(
    ctx: ServiceContext,
    opts: {
      subject?: string | null;
      chapter?: string | null;
      difficulty?: string | null;
      limit?: number;
    } = {},
  ) {
    assertCanConsume(ctx, "practice");
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    let query = getClient(toRepoContext(ctx))
      .from("question_bank")
      .select("id, subject, chapter, difficulty, question, options, correct_index, explanation")
      .eq("is_approved", true)
      .limit(Math.min(200, limit * 4));

    if (opts.subject && opts.subject !== "Mixed") {
      query = query.ilike("subject", opts.subject);
    }
    if (opts.chapter) {
      query = query.ilike("chapter", `%${opts.chapter}%`);
    }
    if (opts.difficulty && opts.difficulty !== "mixed") {
      query = query.eq("difficulty", opts.difficulty);
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to load practice questions");
    const rows = data ?? [];
    // Shuffle client-side so repeated sessions vary when bank is large enough.
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    return rows.slice(0, limit);
  },
};
