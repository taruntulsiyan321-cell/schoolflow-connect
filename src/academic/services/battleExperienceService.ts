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
import { isEmptyQuestionBankError, NO_BANK_MSG } from "@/lib/battleTemplateSolo";

export type BattleCreateOpts = {
  type: "1v1" | "team" | "class";
  subject: string;
  chapter?: string;
  difficulty: string;
  questions: number;
  timeLimitMin: number;
  opponentUserId?: string;
  classId?: string | null;
  isPublic?: boolean;
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
      .select("battle_id, score, correct_count, answered_count, rank")
      .eq("id", participantId)
      .maybeSingle();
    battleId = part?.battle_id ?? null;

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
      },
    }).catch(() => undefined);

    afterExperienceWrite(ctx, ["battle", "xp", "achievements", "profile"]);
  },

  async createFromDesign(
    ctx: ServiceContext,
    opts: BattleCreateOpts,
  ): Promise<{ id: string; battleCode: string | null }> {
    assertCanOwn(ctx, "battle");
    const client = getClient(toRepoContext(ctx));
    const perQ = Math.max(10, Math.floor((opts.timeLimitMin * 60) / Math.max(1, opts.questions)));
    const chap = opts.chapter && opts.chapter !== "All" ? opts.chapter : undefined;
    const base = {
      _subject: opts.subject,
      _difficulty: opts.difficulty === "mixed" ? "medium" : opts.difficulty,
      _count: opts.questions,
      _per_q: perQ,
      _chapter: chap,
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
      if (isEmptyQuestionBankError(msg)) {
        throw new Error(NO_BANK_MSG + " — featured challenges need questions in the bank first.");
      }
      throw error;
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
};
