/**
 * The 7C recovery and revision engine — the client's side of it.
 *
 * ── WHY THIS IS A SEPARATE MODULE FROM practiceService ────────────────────
 *
 * Two engines exist in the database and they are not variants of one another.
 *
 *   OLD   recovery_assignments + revision_queue, keyed on free-text chapter
 *         names, recovery fired on the FIRST wrong answer, every revision row
 *         due CURRENT_DATE. PracticeService still speaks to this one.
 *
 *   NEW   chapter_state + recovery_sessions + revision_sessions, keyed on
 *         chapter_id, recovery at RECOVERY_TRIGGER_COUNT open mistakes, the
 *         §5.3 ladder at 7/21/60 days, and readiness as TWO rates that are
 *         never blended.
 *
 * Putting the new calls inside PracticeService would have hidden that split
 * behind a shared surface, and the next reader would not be able to tell which
 * engine a given method talks to. They are separate because they ARE separate,
 * and the old one is retired by deleting its callers, not by absorbing them.
 *
 * Everything here is practice-private (§10.8): every RPC below resolves the
 * student from auth.uid() server-side and there is no parameter that could ask
 * about somebody else.
 *
 * ── THE `as unknown as` CASTS ─────────────────────────────────────────────
 *
 * src/integrations/supabase/types.ts is generated FROM the live database, and
 * these four RPCs were added after the last generation, so the generated
 * `Functions` map does not carry them and every call types as `null`. The
 * casts are the honest form of that gap, not a shortcut around a real type.
 *
 * Run `npm run db:types` (needs a database credential) once and they can all
 * come off — the return shapes above are exactly what the SQL builds, and the
 * migration that builds them is the contract until then.
 */

import { assertCanConsume, assertCanOwn, toRepoContext, type ServiceContext } from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";

/** One chapter, as the engine currently sees it. */
export type ChapterStateRow = {
  chapter_id: string;
  chapter: string | null;
  subject: string | null;
  /** §3.2. The state machine's own vocabulary, not a display string. */
  state:
    | "untouched"
    | "has_mistakes"
    | "in_recovery"
    | "recovered"
    | "revision_due"
    | "revision_failed";
  /** Which rung of the 7/21/60 ladder this chapter is on. */
  revision_stage: number;
  /** Passes in a row. REVISION_STAGES_TO_SOLID of them and it leaves the queue. */
  consecutive_passes: number;
  /** Null once the chapter is solid — that absence is what removes it. */
  next_revision_at: string | null;
  revision_due: boolean;
  recovered_at: string | null;
  /**
   * §4.4. The accuracy the last recovery was cleared at, so a later failure can
   * be reported honestly against it. Null when no recovery has been taken,
   * which is a DIFFERENT statement from a readiness of zero.
   */
  last_recovery_readiness: number | null;
  open_mistakes: number;
};

/**
 * One row of the Recovery screen: a chapter the student has open mistakes in.
 *
 * Sourced from the mistake book with chapter_state LEFT JOINed, not the other
 * way round — a chapter below RECOVERY_TRIGGER_COUNT has no chapter_state row
 * at all, and those are most of them. Measured live: one chapter cleared the
 * trigger, seven had open mistakes.
 */
export type RecoveryQueueRow = {
  chapter_id: string;
  chapter: string | null;
  subject: string | null;
  open_mistakes: number;
  /** RECOVERY_TRIGGER_COUNT, returned as data so no screen holds a copy. */
  trigger_count: number;
  /** open_mistakes >= trigger_count, decided server-side. */
  ready: boolean;
  state: ChapterStateRow["state"];
  in_recovery: boolean;
  last_recovery_readiness: number | null;
  recovered_at: string | null;
  /** Recovery sessions already taken on this chapter (§4.6 rounds). */
  rounds_taken: number;
};

export type RecoverySessionStart =
  | { started: false; reason: string }
  | {
      started: true;
      session_id: string;
      round: number;
      /** False when generation could not supply every tier (§4.2a). */
      complete: boolean;
      /** How many questions short of the full ladder. */
      shortfall: number;
      session_size: number;
      /**
       * bank question id -> tier, flattened from the plan.
       *
       * Derived here so no screen has to read the plan's internal shape. The
       * runner needs it because recovery is scored PER TIER (§4.2b) and a bare
       * list of question ids cannot say which rate an answer belongs to.
       */
      tierByQuestionId: Record<string, 0 | 1 | 2 | 3>;
    };

export type RecoverySessionOutcome = {
  session_id: string;
  outcome: "ready" | "not_ready";
  /**
   * §4.2b — two rates, never blended. Both are returned so a report can say
   * WHICH half failed; a screen that renders only `readiness` is not obeying
   * the section.
   */
  procedural_rate: number | null;
  conceptual_rate: number | null;
  procedural_passed: boolean;
  conceptual_passed: boolean;
  /** Plain overall accuracy. Never what decides the outcome. */
  readiness: number | null;
  next_revision_at: string | null;
};

export type RevisionSessionOutcome = {
  passed: boolean;
  rate: number;
  stage: number;
  /** True when this pass was the third in a row and the chapter is done. */
  solid: boolean;
  consecutive_passes: number;
  stages_to_solid: number;
};

export const RecoveryEngineService = {
  /**
   * Every chapter this student has a state for, soonest revision first.
   *
   * An empty array is a real answer — a student who has not yet tripped the
   * RECOVERY_TRIGGER_COUNT threshold or the REVISION_ENGAGEMENT_MIN floor has
   * no chapter states, and that is not an error or a loading state.
   */
  async getChapterStates(ctx: ServiceContext): Promise<ChapterStateRow[]> {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_student_chapter_states" as never,
    );
    throwIfError(error, "Failed to load chapter states");
    return (data ?? []) as unknown as ChapterStateRow[];
  },

  /**
   * Every chapter the student has an open mistake in, readiest first.
   *
   * Includes chapters BELOW the trigger, each carrying how close it is, so the
   * screen can say "3 of 5" rather than showing nothing until the moment
   * recovery unlocks. `ready` and `trigger_count` are both decided server-side
   * against recovery_constants; recomputing either here would be a second home
   * for the number the state machine turns on (§10 item 7).
   */
  async getRecoveryQueue(ctx: ServiceContext): Promise<RecoveryQueueRow[]> {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_student_recovery_queue" as never,
    );
    throwIfError(error, "Failed to load recovery queue");
    return (data ?? []) as unknown as RecoveryQueueRow[];
  },

  /**
   * Open a recovery session for one chapter.
   *
   * Returns `started: false` with a reason rather than throwing when the
   * chapter cannot produce a diagnosis yet — §4.1a treats "offer nothing and
   * try again later" as a correct outcome, not a failure.
   */
  async startRecoverySession(
    ctx: ServiceContext,
    chapterId: string,
  ): Promise<RecoverySessionStart> {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_start_recovery_session" as never,
      { _chapter_id: chapterId } as never,
    );
    throwIfError(error, "Failed to start recovery session");
    const raw = data as unknown as
      | { started: false; reason: string }
      | (Omit<Extract<RecoverySessionStart, { started: true }>, "tierByQuestionId"> & {
          plan?: { tiers?: Record<string, { from_bank?: unknown }> };
        });

    if (!raw || raw.started !== true) {
      return raw as Extract<RecoverySessionStart, { started: false }>;
    }
    const started = raw;

    // Flatten plan.tiers[n].from_bank into one id -> tier map. Tier order is
    // preserved by inserting 0,1,2,3 in sequence: the runner asks the
    // questions in key order, and §4.2 is a LADDER — the student's own wrong
    // question first, the transfer question last.
    const tierByQuestionId: Record<string, 0 | 1 | 2 | 3> = {};
    for (const tier of [0, 1, 2, 3] as const) {
      const fromBank = started.plan?.tiers?.[String(tier)]?.from_bank;
      if (!Array.isArray(fromBank)) continue;
      for (const id of fromBank) {
        if (typeof id === "string" && id && !(id in tierByQuestionId)) {
          tierByQuestionId[id] = tier;
        }
      }
    }
    return { ...started, tierByQuestionId } as RecoverySessionStart;
  },

  /**
   * Record a finished recovery session, per tier.
   *
   * The four counts are passed separately and stay separate all the way to the
   * table. Summing them here would throw away the only thing §4.2b asks for.
   */
  async submitRecoverySession(
    ctx: ServiceContext,
    sessionId: string,
    correctByTier: { tier0: number; tier1: number; tier2: number; tier3: number },
  ): Promise<RecoverySessionOutcome> {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_submit_recovery_session" as never,
      {
        _session_id: sessionId,
        _tier0_correct: correctByTier.tier0,
        _tier1_correct: correctByTier.tier1,
        _tier2_correct: correctByTier.tier2,
        _tier3_correct: correctByTier.tier3,
      } as never,
    );
    throwIfError(error, "Failed to submit recovery session");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "RecoveryEngineService.submitRecoverySession",
    });
    return data as unknown as RecoverySessionOutcome;
  },

  /**
   * Record a revision check and let the engine walk the ladder.
   *
   * The caller does not decide pass or fail and does not compute the next
   * date: REVISION_PASS_THRESHOLD and the 7/21/60 intervals live in
   * recovery_constants, and the server reads them. A client that decided
   * either would be a second home for both.
   */
  async submitRevisionSession(
    ctx: ServiceContext,
    chapterId: string,
    correct: number,
    total: number,
  ): Promise<RevisionSessionOutcome> {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_submit_revision_session" as never,
      { _chapter_id: chapterId, _correct: correct, _total: total } as never,
    );
    throwIfError(error, "Failed to submit revision check");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "RecoveryEngineService.submitRevisionSession",
    });
    return data as unknown as RevisionSessionOutcome;
  },
};
