import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";
import { isEmptyQuestionBankError, NO_BANK_MSG } from "@/lib/battleTemplateSolo";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
import { ValidationFailedError } from "../repository/errors";
import { validateBattleQuestionDrafts } from "../validation/rules";

export type BattleCreateOpts = {
  type: "1v1" | "team" | "class";
  subject: string;
  chapter?: string;
  topic?: string;
  difficulty: string;
  questions: number;
  timeLimitMin: number;
  /** When set, overrides per-question seconds derived from timeLimitMin. */
  perQuestionSec?: number;
  opponentUserId?: string;
  classId?: string | null;
  isPublic?: boolean;
};

export type TeacherCustomBattleQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  points?: number;
};

export type TeacherCustomBattleOpts = {
  title: string;
  subject: string;
  topic?: string | null;
  classId: string;
  perQuestionSec: number;
  questions: TeacherCustomBattleQuestion[];
};

export type QuickBattleOpts = {
  subject: string;
  difficulty?: string;
  questions?: number;
  perQuestionSec?: number;
  chapter?: string | null;
  topic?: string | null;
  classId?: string | null;
};

function afterExperienceWrite(ctx: ServiceContext, domains: ("battle" | "xp" | "achievements" | "profile")[]) {
  broadcastAcademicWrite(ctx.schoolId, domains, {
    studentId: ctx.studentId,
    source: "BattleExperienceService",
  });
  notifyStudentXpUpdated();
}

/**
 * BattleExperienceService — wraps battleground RPCs and emits academic events.
 * UI must not call rpc_finish_battle / create-join RPCs directly.
 *
 * Finish path (rpc_finish_battle → _capture_battle_mistakes) mirrors every
 * battle answer into question_attempts with source='battle' (skipped when
 * selected_index < 0; wrong → student_mistakes + mastery) so Practice
 * Incorrect / Skipped modes and profile weak topics stay in sync.
 *
 * XP: Progression Engine owns student_xp.xp (battle.participate / win / top_finish).
 * rpc_finish_battle updates battle counters only — never double-adds score into xp.
 */
export const BattleExperienceService = {
  async finish(ctx: ServiceContext, participantId: string): Promise<void> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { error } = await client.rpc("rpc_finish_battle", {
      _participant_id: participantId,
    });
    throwIfError(error, "Failed to finish battle");

    let battleId: string | null = null;
    const { data: part } = await client
      .from("battle_participants")
      .select("battle_id, score, correct_count, answered_count, rank, user_id")
      .eq("id", participantId)
      .maybeSingle();
    battleId = part?.battle_id ?? null;

    let battleStatus: string | null = null;
    if (battleId) {
      const { data: battle } = await client
        .from("battles")
        .select("status")
        .eq("id", battleId)
        .maybeSingle();
      battleStatus = (battle?.status as string) ?? null;
    }

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.finished",
      entityType: "battle",
      entityId: battleId,
      studentId: ctx.studentId ?? null,
      payload: {
        participant_id: participantId,
        battle_id: battleId,
        score: part?.score ?? null,
        correct_count: part?.correct_count ?? null,
        answered_count: part?.answered_count ?? null,
        rank: part?.rank ?? null,
        battle_status: battleStatus,
      },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle", "xp", "achievements", "profile"]);
    // Progression SSOT: client awards participate only; win/top via rpc_finish_battle.
    try {
      const { ProgressionService } = await import("./progressionService");
      await ProgressionService.awardSafe(ctx, {
        ruleCode: "battle.participate",
        sourceType: "battle",
        sourceId: battleId ?? participantId,
        idempotencyKey: `battle.participate:${participantId}`,
      });

      await ProgressionService.notifyExternalXpChange(ctx, {
        source: "battle.finished",
        participant_id: participantId,
        battle_id: battleId,
      });
    } catch {
      /* optional until migration applied */
    }
  },

  /**
   * Live per-answer Practice Intelligence mirror (correct / wrong / skip).
   * Finish path still bulk-mirrors as a safety net.
   */
  async mirrorAnswer(
    ctx: ServiceContext,
    participantId: string,
    questionId: string,
  ): Promise<void> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { error } = await client.rpc("rpc_mirror_battle_answer" as never, {
      _participant_id: participantId,
      _question_id: questionId,
    } as never);
    if (error) {
      // Mid-migration: finish-path capture still runs.
      console.warn("battle answer mirror:", error.message);
      return;
    }
  },

  /**
   * Server-graded answer submit. Prefer this over client-side correct_index checks.
   * Falls back to legacy recordAnswer path when RPC is not yet applied.
   */
  async submitAnswer(
    ctx: ServiceContext,
    args: {
      participantId: string;
      questionId: string;
      selectedIndex: number;
      timeMs: number;
    },
  ): Promise<{
    isCorrect: boolean;
    points: number;
    correctIndex: number | null;
    score: number;
    correctCount: number;
    answeredCount: number;
    totalTimeMs: number;
  }> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_submit_battle_answer" as never, {
      _participant_id: args.participantId,
      _question_id: args.questionId,
      _selected_index: args.selectedIndex,
      _time_ms: args.timeMs,
    } as never);

    if (error) {
      const msg = error.message || "";
      if (
        /rpc_submit_battle_answer|schema cache|function .* does not exist/i.test(msg)
      ) {
        throw new Error("BATTLE_SUBMIT_RPC_MISSING");
      }
      throwIfError(error, "Failed to submit battle answer");
    }

    const row = (data ?? {}) as Record<string, unknown>;
    afterExperienceWrite(ctx, ["battle", "xp", "profile"]);
    return {
      isCorrect: Boolean(row.is_correct),
      points: Number(row.points ?? 0),
      correctIndex: row.correct_index == null ? null : Number(row.correct_index),
      score: Number(row.score ?? 0),
      correctCount: Number(row.correct_count ?? 0),
      answeredCount: Number(row.answered_count ?? 0),
      totalTimeMs: Number(row.total_time_ms ?? 0),
    };
  },

  /**
   * Persist one battle answer + participant score, then mirror into question_attempts.
   * Prefer submitAnswer (server grade). Legacy path kept for pre-migration fallback.
   */
  async recordAnswer(
    ctx: ServiceContext,
    args: {
      participantId: string;
      questionId: string;
      selectedIndex: number;
      isCorrect: boolean;
      timeMs: number;
      score: number;
      correctCount: number;
      answeredCount: number;
      totalTimeMs: number;
    },
  ): Promise<void> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { error: ansErr } = await client.from("battle_answers").upsert(
      {
        participant_id: args.participantId,
        question_id: args.questionId,
        selected_index: args.selectedIndex,
        is_correct: args.isCorrect,
        time_ms: args.timeMs,
        school_id: ctx.schoolId,
      },
      { onConflict: "participant_id,question_id", ignoreDuplicates: false },
    );
    if (ansErr && !ansErr.message.includes("duplicate key")) {
      throwIfError(ansErr, "Failed to save battle answer");
    }

    const { error: partErr } = await client
      .from("battle_participants")
      .update({
        score: args.score,
        correct_count: args.correctCount,
        answered_count: args.answeredCount,
        total_time_ms: args.totalTimeMs,
      })
      .eq("id", args.participantId);
    throwIfError(partErr, "Failed to update battle score");

    await this.mirrorAnswer(ctx, args.participantId, args.questionId);
    afterExperienceWrite(ctx, ["battle", "xp", "profile"]);
  },

  async sendInvites(
    ctx: ServiceContext,
    battleId: string,
    invitedUserIds: string[],
  ): Promise<void> {
    assertCanOwn(ctx, "battle");
    if (!invitedUserIds.length) return;
    const rows = invitedUserIds.map((uid) => ({
      battle_id: battleId,
      invited_user_id: uid,
      inviter_user_id: ctx.userId,
      school_id: ctx.schoolId,
    }));
    const { error } = await getClient(toRepoContext(ctx))
      .from("battle_invites")
      .upsert(rows, { onConflict: "battle_id,invited_user_id" });
    throwIfError(error, "Failed to send battle invites");
    afterExperienceWrite(ctx, ["battle"]);
  },

  async declineInvite(ctx: ServiceContext, inviteId: string): Promise<void> {
    assertCanOwn(ctx, "battle");
    const { error } = await getClient(toRepoContext(ctx))
      .from("battle_invites")
      .update({ status: "declined" })
      .eq("id", inviteId)
      .eq("invited_user_id", ctx.userId);
    throwIfError(error, "Failed to decline battle invite");
    afterExperienceWrite(ctx, ["battle"]);
  },

  /**
   * Instant solo/open quick battle — UI must not call rpc_create_quick_battle directly.
   */
  async createQuickBattle(
    ctx: ServiceContext,
    opts: QuickBattleOpts,
  ): Promise<{ id: string; battleCode: string | null }> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const difficulty = opts.difficulty === "mixed" ? "medium" : (opts.difficulty ?? "medium");
    const { data, error } = await client.rpc("rpc_create_quick_battle", {
      _subject: opts.subject,
      _difficulty: difficulty,
      _count: opts.questions ?? 5,
      _per_q: opts.perQuestionSec ?? 20,
      // CHUNK 10.7 — omitted, not coerced. `_chapter text DEFAULT NULL`,
      // `_class_id uuid DEFAULT NULL`, `_topic text DEFAULT NULL`: for these
      // three, not sending the key and sending null produce the same battle.
      // `_difficulty DEFAULT 'medium'`, `_count DEFAULT 5` and `_per_q DEFAULT
      // 20` above are deliberately still sent — omitting those would silently
      // substitute the database default for a value the caller chose.
      ...(opts.chapter != null ? { _chapter: opts.chapter } : {}),
      ...(opts.classId != null ? { _class_id: opts.classId } : {}),
      ...(opts.topic != null ? { _topic: opts.topic } : {}),
    });
    if (error) {
      const msg = error.message || "Could not start quick battle";
      if (isEmptyQuestionBankError(msg)) {
        throw new Error(NO_BANK_MSG + " — ask a teacher to add questions, or try another subject/chapter.");
      }
      throw error instanceof Error ? error : new Error(msg);
    }
    if (!data) throw new Error("Quick battle could not be created");
    const id = data as string;

    const { data: row } = await client
      .from("battles")
      .select("battle_code")
      .eq("id", id)
      .maybeSingle();

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.created",
      entityType: "battle",
      entityId: id,
      studentId: ctx.studentId ?? null,
      classId: opts.classId ?? null,
      payload: {
        type: "quick",
        subject: opts.subject,
        battle_code: row?.battle_code ?? null,
      },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle"]);
    return { id, battleCode: row?.battle_code ?? null };
  },

  async createFromDesign(
    ctx: ServiceContext,
    opts: BattleCreateOpts,
  ): Promise<{ id: string; battleCode: string | null }> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const perQ =
      opts.perQuestionSec ??
      Math.max(10, Math.floor((opts.timeLimitMin * 60) / Math.max(1, opts.questions)));
    const chap = opts.chapter && opts.chapter !== "All" ? opts.chapter : undefined;
    const topic = opts.topic && opts.topic !== "All" ? opts.topic : undefined;
    const base = {
      _subject: opts.subject,
      _difficulty: opts.difficulty === "mixed" ? "medium" : opts.difficulty,
      _count: opts.questions,
      _per_q: perQ,
      _chapter: chap,
      _topic: topic,
      _class_id: opts.classId ?? undefined,
    };

    const throwCreateErr = (err: { message?: string } | null, fallback: string) => {
      if (!err) return;
      const msg = err.message || fallback;
      if (isEmptyQuestionBankError(msg)) {
        throw new Error(NO_BANK_MSG + " — ask a teacher to add questions, or try another subject/chapter.");
      }
      throw err instanceof Error ? err : new Error(msg);
    };

    let id: string;
    if (opts.type === "1v1" && opts.opponentUserId) {
      const res = await client.rpc("rpc_challenge_student", {
        _opponent_user_id: opts.opponentUserId,
        _subject: base._subject,
        _difficulty: base._difficulty,
        _count: base._count,
        _per_q: base._per_q,
        _chapter: chap,
        _topic: topic,
      });
      throwCreateErr(res.error, "Challenge could not be created");
      if (!res.data) throw new Error("Challenge could not be created");
      id = res.data as string;
    } else if (opts.type === "class") {
      const res = await client.rpc("rpc_create_class_battle", base);
      throwCreateErr(res.error, "Class battle could not be created");
      if (!res.data) throw new Error("Class battle could not be created");
      id = res.data as string;
    } else {
      const res = await client.rpc("rpc_create_open_battle", base);
      throwCreateErr(res.error, "Battle could not be created");
      if (!res.data) throw new Error("Battle could not be created");
      id = res.data as string;
    }

    if (opts.isPublic === false) {
      await client.from("battles").update({ is_public: false }).eq("id", id);
    }

    const { data: row } = await client
      .from("battles")
      .select("battle_code")
      .eq("id", id)
      .maybeSingle();

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.created",
      entityType: "battle",
      entityId: id,
      studentId: ctx.studentId ?? null,
      classId: opts.classId ?? null,
      payload: {
        type: opts.type,
        subject: opts.subject,
        battle_code: row?.battle_code ?? null,
      },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle"]);
    return { id, battleCode: row?.battle_code ?? null };
  },

  /**
   * Teacher-authored class lobby battle with custom questions.
   * Always mode=lobby + is_public so students see it in open/class lists.
   */
  async createTeacherCustom(
    ctx: ServiceContext,
    opts: TeacherCustomBattleOpts,
  ): Promise<{ id: string; battleCode: string | null }> {
    assertCanOwn(ctx, "battle");
    if (ctx.role !== "teacher" && !isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only teachers may publish custom class battles");
    }
    if (!opts.classId) {
      throw new ValidationFailedError([
        { field: "classId", code: "required", message: "Select a class first" },
      ]);
    }
    const title = opts.title.trim();
    if (title.length < 2) {
      throw new ValidationFailedError([
        { field: "title", code: "required", message: "Battle title is required" },
      ]);
    }
    const perQ = Math.max(5, Math.min(300, Math.floor(Number(opts.perQuestionSec) || 20)));
    const drafts = opts.questions.map((q) => ({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
    }));
    const qCheck = validateBattleQuestionDrafts(drafts);
    if (!qCheck.ok) {
      throw new ValidationFailedError((qCheck as { ok: false; issues: never[] }).issues);
    }
    if (!isSchoolOperator(ctx.role)) {
      await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, opts.classId);
    }

    const client = getClient(toRepoContext(ctx));
    const { data: b, error } = await client
      .from("battles")
      .insert({
        title,
        subject: opts.subject.trim() || "",
        topic: opts.topic?.trim() || null,
        type: "mcq",
        status: "live",
        class_id: opts.classId,
        creator_user_id: ctx.userId,
        school_id: ctx.schoolId,
        per_question_sec: perQ,
        question_count: opts.questions.length,
        duration_sec: perQ * opts.questions.length,
        is_public: true,
        mode: "lobby",
        source: "custom",
        starts_at: new Date().toISOString(),
      } as never)
      .select("id, battle_code")
      .single();
    throwIfError(error, "Failed to create class battle");
    const battle = b as { id: string; battle_code?: string | null };
    const id = battle.id;

    const rows = opts.questions.map((q, i) => ({
      battle_id: id,
      order_index: i,
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()),
      correct_index: q.correctIndex,
      points: q.points ?? 10,
      school_id: ctx.schoolId,
    }));
    const { error: qErr } = await client.from("battle_questions").insert(rows as never);
    if (qErr) {
      await client.from("battles").delete().eq("id", id);
      throwIfError(qErr, "Failed to save battle questions");
    }

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.created",
      entityType: "battle",
      entityId: id,
      studentId: null,
      classId: opts.classId,
      payload: {
        type: "class",
        source: "custom",
        subject: opts.subject,
        battle_code: battle.battle_code ?? null,
      },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle"]);
    return { id, battleCode: battle.battle_code ?? null };
  },

  async joinByCode(ctx: ServiceContext, code: string): Promise<string> {
    assertCanOwn(ctx, "battle");
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) throw new Error("Enter a battle code to join.");

    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_join_battle_by_code", {
      _code: trimmed,
    });
    if (error) {
      const msg = error.message || "";
      if (msg.includes("rpc_join_battle_by_code") || msg.includes("schema cache") || msg.includes("battle_code")) {
        throw new Error("Battle codes need a database update. Ask your admin to apply the battle_code migration.");
      }
      throw error;
    }
    if (!data) throw new Error("Could not join battle");

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.joined",
      entityType: "battle",
      entityId: data as string,
      studentId: ctx.studentId ?? null,
      payload: { battle_code: trimmed },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle"]);
    return data as string;
  },

  /**
   * Join an already-known battle (by id) as a participant — used by the BattleRoom
   * when a student opens a battle link/route directly (not via code or invite).
   * Idempotent: returns the existing participant id if already joined.
   */
  async joinById(ctx: ServiceContext, battleId: string): Promise<string> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));

    const { data: existing, error: existErr } = await client
      .from("battle_participants")
      .select("id")
      .eq("battle_id", battleId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    throwIfError(existErr, "Failed to check battle participation");
    if (existing) return existing.id as string;

    const { data: stu } = await client
      .from("students")
      .select("id, full_name")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    let displayName = stu?.full_name || "";
    if (!displayName) {
      const { data: prof } = await client
        .from("profiles")
        .select("full_name, email")
        .eq("id", ctx.userId)
        .maybeSingle();
      displayName = prof?.full_name || prof?.email?.split("@")[0] || "Student";
    }

    const { data: inserted, error: insertErr } = await client
      .from("battle_participants")
      .insert({
        battle_id: battleId,
        user_id: ctx.userId,
        student_id: stu?.id ?? null,
        display_name: displayName,
        school_id: ctx.schoolId,
      })
      .select("id")
      .single();

    if (insertErr) {
      // Race: another request (e.g. a duplicate submit) may have joined concurrently.
      const { data: recheck } = await client
        .from("battle_participants")
        .select("id")
        .eq("battle_id", battleId)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (recheck) return recheck.id as string;
      throw new Error(insertErr.message || "Failed to join battle");
    }

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.joined",
      entityType: "battle",
      entityId: battleId,
      studentId: ctx.studentId ?? null,
      payload: { via: "direct" },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle"]);
    return inserted!.id as string;
  },

  async acceptInvite(ctx: ServiceContext, inviteId: string, battleId: string): Promise<string> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await (client.rpc as any)("rpc_accept_battle_invite", {
      _invite_id: inviteId,
    });
    if (error) {
      const msg = error.message || "";
      if (msg.includes("rpc_accept_battle_invite") || msg.includes("schema cache")) {
        const { data: existing } = await client
          .from("battle_participants")
          .select("id")
          .eq("battle_id", battleId)
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (!existing) {
          const { data: stu } = await client
            .from("students")
            .select("id, full_name")
            .eq("user_id", ctx.userId)
            .maybeSingle();
          const { error: joinErr } = await client.from("battle_participants").insert({
            battle_id: battleId,
            user_id: ctx.userId,
            student_id: stu?.id ?? null,
            display_name: stu?.full_name || "Challenger",
            school_id: ctx.schoolId,
          });
          throwIfError(joinErr, "Failed to join battle");
        }
        const { error: updErr } = await client
          .from("battle_invites")
          .update({ status: "accepted" })
          .eq("id", inviteId);
        throwIfError(updErr, "Failed to accept invite");
      } else {
        throw error;
      }
    }

    const id = (data as string) || battleId;
    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.joined",
      entityType: "battle",
      entityId: id,
      studentId: ctx.studentId ?? null,
      payload: { invite_id: inviteId, via: "invite" },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle"]);
    return id;
  },

  async ensureFeatured(
    ctx: ServiceContext,
    kind: "daily" | "weekly" | "ncert" | "beat_topper" | "teacher",
  ): Promise<string> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_ensure_featured_battle", { _kind: kind });
    if (error) {
      const msg = error.message || "Featured battle unavailable";
      if (/_pick_featured_subject|function .* does not exist/i.test(msg)) {
        throw new Error(
          "Featured battles need a database update — ask your admin to apply APPLY_FEATURED_PICK_SUBJECT.sql.",
        );
      }
      if (isEmptyQuestionBankError(msg)) {
        throw new Error(NO_BANK_MSG + " — featured challenges need questions in the bank first.");
      }
      // Beat the Topper / teacher: surface soft copy, not opaque RPC errors
      if (kind === "beat_topper" && /topper|classmate|unlocks/i.test(msg)) {
        throw new Error(msg.replace(/^.*?:\s*/, "").trim() || msg);
      }
      if (kind === "teacher" && /teacher-hosted|check back/i.test(msg)) {
        throw new Error("No teacher-hosted challenge is live right now — check back soon.");
      }
      throw error instanceof Error ? error : new Error(msg);
    }
    if (!data) throw new Error("Featured battle unavailable");
    const battleId = data as string;

    const { data: existing, error: existErr } = await client
      .from("battle_participants")
      .select("id")
      .eq("battle_id", battleId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    throwIfError(existErr, "Failed to check featured participation");

    if (!existing) {
      // Always ensure a participant row exists before returning the battle id —
      // never let the caller open the room without a real join.
      const { data: codeRow } = await client
        .from("battles")
        .select("battle_code")
        .eq("id", battleId)
        .maybeSingle();

      let joined = false;
      if (codeRow?.battle_code) {
        try {
          await this.joinByCode(ctx, codeRow.battle_code);
          joined = true;
        } catch {
          joined = false;
        }
      }

      if (!joined) {
        // No usable battle_code (or the code-join failed) — join directly by id.
        // joinById emits its own "battle.joined" event and throws loudly on failure.
        try {
          await this.joinById(ctx, battleId);
        } catch (joinErr) {
          throw joinErr instanceof Error
            ? joinErr
            : new Error("Could not join featured battle");
        }
      }
    }

    afterExperienceWrite(ctx, ["battle"]);
    return battleId;
  },

  /**
   * Battleground home warm: expire stale windows + seed Daily/Weekly/NCERT
   * so Featured cards populate without tap. Prefer class-scoped ensure-all
   * (no auto-join). Teacher is peeked from live teacher-hosted battles.
   */
  async ensureFeaturedAll(ctx: ServiceContext): Promise<{
    daily: string | null;
    weekly: string | null;
    ncert: string | null;
    teacher: string | null;
  }> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const empty = {
      daily: null as string | null,
      weekly: null as string | null,
      ncert: null as string | null,
      teacher: null as string | null,
    };

    const { data, error } = await client.rpc("rpc_ensure_featured_battles_all" as never);
    if (!error && data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      afterExperienceWrite(ctx, ["battle"]);
      return {
        daily: typeof row.daily === "string" ? row.daily : null,
        weekly: typeof row.weekly === "string" ? row.weekly : null,
        ncert: typeof row.ncert === "string" ? row.ncert : null,
        teacher: typeof row.teacher === "string" ? row.teacher : null,
      };
    }

    // Fallbacks when ensure-all not applied — NEVER call ensureFeatured here:
    // that RPC auto-joins and pollutes My Battles Active on every home load.
    await client.rpc("rpc_refresh_featured_battles" as never).then(
      () => undefined,
      () => undefined,
    );
    await client.rpc("rpc_rotate_featured_battles" as never).then(
      () => undefined,
      () => undefined,
    );

    const out = { ...empty };
    if (ctx.classId) {
      const { data: seeded } = await client
        .from("battles")
        .select("id, source, starts_at")
        .eq("class_id", ctx.classId)
        .like("source", "featured_%")
        .in("status", ["live", "scheduled"])
        .order("starts_at", { ascending: false })
        .limit(20);
      const now = new Date();
      const weekKey = (d: Date) => {
        const day = (d.getDay() + 6) % 7;
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
      };
      for (const b of seeded || []) {
        const src = (b.source || "").toLowerCase();
        const start = b.starts_at ? new Date(b.starts_at) : null;
        if (!start || Number.isNaN(start.getTime())) continue;
        if (src === "featured_daily" && !out.daily) {
          if (
            start.getFullYear() === now.getFullYear() &&
            start.getMonth() === now.getMonth() &&
            start.getDate() === now.getDate()
          ) {
            out.daily = b.id;
          }
        } else if (src === "featured_weekly" && !out.weekly) {
          if (weekKey(start) === weekKey(now)) out.weekly = b.id;
        } else if (src === "featured_ncert" && !out.ncert) {
          if (
            start.getFullYear() === now.getFullYear() &&
            start.getMonth() === now.getMonth() &&
            start.getDate() === now.getDate()
          ) {
            out.ncert = b.id;
          }
        }
      }

      const { data: teacherBattles } = await client
        .from("battles")
        .select("id, creator_user_id")
        .in("source", ["manual", "custom", "bank"])
        .eq("is_public", true)
        .eq("class_id", ctx.classId)
        .in("status", ["live", "scheduled"])
        .order("starts_at", { ascending: false })
        .limit(12);
      if (teacherBattles?.length) {
        const creatorIds = [...new Set(teacherBattles.map((b) => b.creator_user_id).filter(Boolean))];
        if (creatorIds.length) {
          const { data: roles } = await client
            .from("user_roles")
            .select("user_id")
            .in("user_id", creatorIds)
            .eq("role", "teacher");
          const teacherIds = new Set((roles || []).map((r) => r.user_id));
          const hit = teacherBattles.find((b) => teacherIds.has(b.creator_user_id));
          if (hit) out.teacher = hit.id;
        }
      }
    }

    afterExperienceWrite(ctx, ["battle"]);
    return out;
  },

  async getBattle(ctx: ServiceContext, battleId: string) {
    assertCanConsume(ctx, "battle");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("battles")
      .select("*")
      .eq("id", battleId)
      .maybeSingle();
    throwIfError(error, "Failed to load battle");
    return data;
  },

  /** Teacher host list — battles created by the signed-in user (optional class filter). */
  async listCreatedByTeacher(
    ctx: ServiceContext,
    opts?: { classIds?: string[]; limit?: number },
  ): Promise<Record<string, unknown>[]> {
    assertCanConsume(ctx, "battle");
    let q = getClient(toRepoContext(ctx))
      .from("battles")
      .select("*")
      .eq("creator_user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(50, Math.max(1, opts?.limit ?? 12)));
    if (opts?.classIds?.length) {
      q = q.in("class_id", opts.classIds);
    }
    const { data, error } = await q;
    throwIfError(error, "Failed to load teacher battles");
    return (data ?? []) as Record<string, unknown>[];
  },

  /** Live monitor payload for a hosted battle (RPC). */
  async getMonitor(ctx: ServiceContext, battleId: string): Promise<unknown> {
    assertCanConsume(ctx, "battle");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_battle_monitor" as never,
      { _battle_id: battleId } as never,
    );
    throwIfError(error, "Failed to load battle monitor");
    return data;
  },

  /** Per-participant teacher reports for a hosted battle (RPC). */
  async listTeacherReports(ctx: ServiceContext, battleId: string): Promise<unknown[]> {
    assertCanConsume(ctx, "battle");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_teacher_battle_reports" as never,
      { _battle_id: battleId } as never,
    );
    throwIfError(error, "Failed to load battle reports");
    return (data ?? []) as unknown[];
  },

  /**
   * Teacher force-end: mark the battle finished for the lobby/monitor.
   * Students mid-question may still submit their current answer; participant
   * finish/XP still goes through `finish()` when each student completes.
   */
  async forceFinish(ctx: ServiceContext, battleId: string): Promise<void> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client
      .from("battles")
      .update({ status: "finished" })
      .eq("id", battleId)
      .select("id, status, title")
      .maybeSingle();
    throwIfError(error, "Failed to end battle");
    if (!data) throw new Error("Battle not found or not allowed to end");

    await emitEvent(toRepoContext(ctx), {
      eventType: "battle.finished",
      entityType: "battle",
      entityId: battleId,
      studentId: ctx.studentId ?? null,
      payload: {
        battle_id: battleId,
        via: "teacher_force_finish",
        title: (data as { title?: string }).title ?? null,
      },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle", "profile"]);
  },
};
