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
  /** Which rung of the weekly ladder this chapter is on. */
  revision_stage: number;
  /**
   * Passes in a row. REVISION_STAGES_TO_SOLID of them and the chapter drops to
   * the much longer REVISION_INTERVAL_SOLID — it does NOT leave the schedule.
   */
  consecutive_passes: number;
  /**
   * Null only for a chapter that has never been scheduled. It is no longer
   * nulled by going solid: forgetting does not stop because a student passed
   * three checks, so a solid chapter keeps a date at the long interval.
   */
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
  /**
   * Questions in this chapter the student has never attempted and has never
   * had a mistake recorded against — the pool a revision check draws its fresh
   * half from (§5.4).
   *
   * Carried so the tab can say a check will be short BEFORE the student sits
   * it. Without it the screen could announce a chapter as due and then hand
   * over three questions.
   */
  revision_fresh_available: number;
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
  /** Server-side verdict: there is a session here and it is worth sitting. */
  ready: boolean;
  /**
   * What the ladder will do with these mistakes.
   *
   *   'deep'    every mistake gets all four rungs
   *   'wide'    every mistake gets rungs 0-2
   *   'relearn' too many mistakes to drill — the chapter needs learning again
   *   'none'    nothing open here
   *
   * Decided by the server from three constants. A screen that re-derived it
   * from open_mistakes would be a fourth place those constants live.
   */
  mode: "deep" | "wide" | "relearn" | "none";
  /**
   * How many questions the session will actually hold, so the tab can say
   * "12 questions" instead of a fixed ten that stopped being true. Zero in
   * relearn mode, where no session is offered.
   */
  planned_size: number;
  /** Mistakes above which the app refuses to drill, returned as data. */
  relearn_above: number;
  state: ChapterStateRow["state"];
  in_recovery: boolean;
  last_recovery_readiness: number | null;
  recovered_at: string | null;
  /** Recovery sessions already taken on this chapter (§4.6 rounds). */
  rounds_taken: number;
};

export type RecoverySessionStart =
  | {
      started: false;
      reason: string;
      /**
       * 'relearn' is not a failure to build a session — it is the app
       * concluding that drilling is the wrong response to this many mistakes.
       * The screen must say something different for it than for "the bank is
       * too thin", because those need opposite things from the student.
       */
      mode?: "deep" | "wide" | "relearn" | "none";
      open_mistakes?: number;
    }
  | {
      started: true;
      session_id: string;
      round: number;
      mode: "deep" | "wide";
      /** The mistakes this ladder was built from — every one of them. */
      open_mistakes: number;
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

/** §4.4 — what the server did when the student cleared a not-ready chapter. */
export type ClearAnywayOutcome =
  | { already: true; chapter_id: string }
  | { already?: undefined; chapter_id: string; cleared: number; readiness: number | null; next_revision_at: string };

export type RevisionSessionOutcome = {
  passed: boolean;
  rate: number;
  /**
   * The rung this check WAS FOR, not the one it moved to. After a pass at
   * rung 1, chapter_state.revision_stage is 2 and this is still 1 — which is
   * the number a sentence about what just happened needs.
   */
  stage: number;
  /** True when this pass was the third in a row and the chapter is done. */
  solid: boolean;
  consecutive_passes: number;
  stages_to_solid: number;
  /**
   * The date now on chapter_state, read back from the row rather than rebuilt
   * from the branch that wrote it.
   *
   * A solid chapter still has one, at the long interval. It is null only for a
   * chapter that was never scheduled. The client never computes this — the
   * intervals live in recovery_constants and a copy here would be a second
   * home for them.
   */
  next_revision_at: string | null;
  /**
   * The check's two halves, never blended into `rate` above.
   *
   * `mistake_*` counts the questions this student had previously got wrong;
   * `fresh_*` the ones they had never seen. "You still miss the same two" and
   * "you have lost the chapter" are different diagnoses, and a single
   * percentage cannot tell them apart — the same argument §4.2b makes for
   * recovery's two rates.
   */
  mistake_correct: number;
  mistake_total: number;
  fresh_correct: number;
  fresh_total: number;
  /** The chapter's state after this check, quoted rather than inferred. */
  state: ChapterStateRow["state"];
};

/**
 * One finished revision check, for the history list.
 *
 * Read straight from revision_sessions rather than through an RPC: the table
 * has a self policy (user_id = auth.uid()) and a RESTRICTIVE tenant fence, so
 * the rows a student can see are already exactly their own, and a
 * SECURITY DEFINER wrapper would add a definer door for nothing.
 */
export type RevisionHistoryRow = {
  id: string;
  chapter_id: string;
  chapter: string | null;
  /** The rung this check was for. */
  stage: number;
  correct: number;
  total: number;
  passed: boolean;
  completed_at: string | null;
  /** §5.1 vs §5.2 — why this chapter was being revised at all. */
  triggered_by: string | null;
};

/**
 * What a revision check for one chapter contains (§5.4).
 *
 * The check is built server-side rather than by the practice loader, because
 * "questions this student has never seen" is a fact about the student's whole
 * history and the loader has never had it. Before this existed, checks were
 * measured to contain questions the student had already answered.
 */
export type RevisionSessionPlan = {
  chapter_id: string;
  /** Up to REVISION_MISTAKE_MAX of their own open mistakes, worst first. */
  mistake_ids: string[];
  /** REVISION_COUNT questions never attempted and never missed by them. */
  fresh_ids: string[];
  /** The two halves in the order they should be asked: misses, then fresh. */
  question_ids: string[];
  mistakes: number;
  fresh: number;
  fresh_wanted: number;
  /**
   * How many fresh questions the chapter could not supply. Reported, never
   * padded: filling the gap with questions they have already seen would
   * quietly turn a retention check into a recall check.
   */
  fresh_short: number;
  total: number;
  stage: number;
  next_revision_at: string | null;
  due: boolean;
  /** False for a chapter with no chapter_state row — an early check is allowed. */
  scheduled: boolean;
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
   * Revision checks this student has finished, newest first.
   *
   * The Revision screen said "Revision history is not stored yet" long after
   * rpc_submit_revision_session began writing a row for every check. It is
   * stored; this is it.
   *
   * An empty array is a real answer — a student who has never reached a
   * revision check has no history, and that is not a loading state.
   */
  async getRevisionHistory(
    ctx: ServiceContext,
    limit = 20,
  ): Promise<RevisionHistoryRow[]> {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("revision_sessions")
      .select("id, chapter_id, stage, correct, total, passed, completed_at, triggered_by, chapters(name)")
      .eq("user_id", ctx.userId)
      .order("completed_at", { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));
    throwIfError(error, "Failed to load revision history");
    return (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string; chapter_id: string; stage: number; correct: number; total: number;
        passed: boolean; completed_at: string | null; triggered_by: string | null;
        chapters?: { name?: string | null } | { name?: string | null }[] | null;
      };
      // PostgREST returns an embedded to-one as an object, but the generated
      // types and older versions can hand back a single-element array. Both
      // shapes are read rather than one being assumed.
      const chap = Array.isArray(row.chapters) ? row.chapters[0] : row.chapters;
      return {
        id: row.id,
        chapter_id: row.chapter_id,
        chapter: chap?.name ?? null,
        stage: row.stage,
        correct: row.correct,
        total: row.total,
        passed: row.passed,
        completed_at: row.completed_at,
        triggered_by: row.triggered_by,
      };
    });
  },

  /**
   * What a revision check for this chapter will contain.
   *
   * Read BEFORE the session is started, so the runner can load exactly these
   * questions. §5.3 says timing is a suggestion and is never enforced, so this
   * answers for a chapter whose date has not arrived too — `due` says whether
   * it had, and the caller decides what to do about that.
   */
  async getRevisionSessionPlan(
    ctx: ServiceContext,
    chapterId: string,
  ): Promise<RevisionSessionPlan> {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_revision_session_plan" as never,
      { _chapter_id: chapterId } as never,
    );
    throwIfError(error, "Failed to build the revision check");
    return data as unknown as RevisionSessionPlan;
  },

  /**
   * Open a recovery session for one chapter.
   *
   * Returns `started: false` with a reason rather than throwing when the
   * chapter cannot produce a diagnosis yet — §4.1a treats "offer nothing and
   * try again later" as a correct outcome, not a failure.
   *
   * `mode: 'relearn'` arrives through the same branch and is a THIRD thing:
   * not a failure and not "try again later", but the app declining to drill a
   * chapter the student has not learned. Callers must not collapse it into the
   * generic not-offerable message, which would tell the student the bank is
   * thin when in fact it is full.
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
      | Extract<RecoverySessionStart, { started: false }>
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
   * Record a finished recovery session.
   *
   * ── WHY THIS NO LONGER SENDS A SCORE ──────────────────────────────────
   *
   * It used to send four per-tier counts, and the server stored what it was
   * given. Driven as an ordinary student — real session, anon key, no
   * privileged credential — that allowed a chapter to be marked RECOVERED at
   * readiness 1.0 having answered zero questions, which is §7's "catches
   * them" reduced to nothing, because the signal it catches them with was
   * the forgeable part.
   *
   * What travels now is the practice session the ladder was sat in. The
   * server counts each tier from the answers given to THAT tier's own
   * questions, which rpc_record_question_attempt has already graded against
   * the bank. The two rates still stay separate all the way to the table —
   * §4.2b is unchanged; only who does the counting has moved.
   */
  async submitRecoverySession(
    ctx: ServiceContext,
    sessionId: string,
    practiceSessionId: string,
  ): Promise<RecoverySessionOutcome> {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_submit_recovery_session" as never,
      { _session_id: sessionId, _practice_session_id: practiceSessionId } as never,
    );
    throwIfError(error, "Failed to submit recovery session");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "RecoveryEngineService.submitRecoverySession",
    });
    return data as unknown as RecoverySessionOutcome;
  },

  /**
   * §4.4 — clear a chapter whose recovery session was scored not ready.
   *
   * "Not a block, a speed bump": the confirm is the caller's job. The server
   * accepts only the caller's own, completed, not_ready, LATEST session for the
   * chapter, does the same §4.5 writes a ready result makes, and keeps the
   * session's readiness so a premature clear stays visible — revision then
   * catches it in seven days.
   */
  async clearChapterAfterRecovery(ctx: ServiceContext, sessionId: string): Promise<ClearAnywayOutcome> {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_clear_chapter_after_recovery" as never,
      { _session_id: sessionId } as never,
    );
    throwIfError(error, "Could not clear the chapter");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "RecoveryEngineService.clearChapterAfterRecovery",
    });
    return data as unknown as ClearAnywayOutcome;
  },

  /**
   * Record a revision check and let the engine walk the ladder.
   *
   * The caller decides nothing: not the score, not pass or fail, not the next
   * date. It hands over the practice session the check was sat in, and the
   * server counts the answers itself — bound to this chapter through
   * question_bank, and refused if that sitting has already been spent on a
   * check. Sending `correct` and `total` was enough to walk the whole ladder
   * to "solid" without being asked a question.
   */
  async submitRevisionSession(
    ctx: ServiceContext,
    chapterId: string,
    practiceSessionId: string,
  ): Promise<RevisionSessionOutcome> {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_submit_revision_session" as never,
      { _chapter_id: chapterId, _practice_session_id: practiceSessionId } as never,
    );
    throwIfError(error, "Failed to submit revision check");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "RecoveryEngineService.submitRevisionSession",
    });
    return data as unknown as RevisionSessionOutcome;
  },
};
