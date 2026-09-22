/**
 * Recovery, Revision & Analysis — the constants, in ONE place.
 *
 * Spec §10: "Every one of these is a judgment, not a law. They are defensible
 * starting points; they should be reviewed once there is real usage data.
 * **No component may contain any of these as a literal.**"
 *
 * That last sentence is verification item 7 of Chunk 7C, and it is the reason
 * this file exists rather than the numbers being written where they are used.
 * A threshold that appears in three components is three thresholds the first
 * time someone tunes one of them.
 *
 * The comment beside each value is the spec's own reasoning, kept here so that
 * changing a number means reading why it was chosen.
 */

// ── Recovery: when a session is built ──────────────────────────────────────

/**
 * Open mistakes in one chapter before a recovery session is built.
 *
 * ONE. The spec argued for five — "fewer than five is not worth a session, and
 * clearing a one-mistake chapter creates a false sense of progress" — and the
 * production data says five is why the feature has never run. Measured
 * 2026-09-15 across every open mistake in the database:
 *
 *     1 mistake in a chapter   5 students
 *     2 mistakes               3 students
 *     6 mistakes               1 student
 *
 * One student in the entire database has ever reached five. Zero recovery
 * sessions exist. A threshold that excludes 8 of the 9 students who have
 * something to recover is not a quality bar, it is an off switch.
 *
 * The "false sense of progress" worry is answered by the session itself rather
 * than by the trigger: a one-mistake recovery is four questions laddered off
 * that one mistake (see RECOVERY_DEEP_MAX_MISTAKES), and clearing it means
 * clearing one mistake, which is exactly what it says.
 */
export const RECOVERY_TRIGGER_COUNT = 1;

/**
 * Target build time. §4.1: "Build time is deliberately unhurried... The system
 * must degrade by taking longer, never by failing or by serving something
 * worse." This is a target to measure against, NOT a timeout to abort on.
 */
export const GENERATION_TARGET_SECONDS = 120;

/**
 * §4.1a: AI calls fail for ordinary reasons at roughly one in a few hundred.
 * At 210 students that is several times a week — invisible with retry, a
 * broken screen without it. Retries are background; the student never sees one.
 */
export const GENERATION_MAX_RETRIES = 5;

/**
 * Generation jobs dispatched per cron tick, and the tick is every minute.
 *
 * Three, not thirty. Each job is a paid AI call, and the realistic backlog is
 * small because a variant is generated once per QUESTION and not once per
 * student (§4.2a): forty students failing the same question produce ONE job.
 * A backlog drains at 180 an hour, which clears any plausible spike well
 * inside the time a student spends between finishing practice and opening the
 * Recovery tab. A larger batch would only let a runaway cost more before
 * anyone noticed it.
 */
export const GENERATION_BATCH_SIZE = 3;

/**
 * §4.1a, as resolved 2026-08-30. The section says a session that cannot be
 * completed is not offered — nobody is waiting, so there is no reason to
 * degrade — and it retries. Taken literally that strands a chapter whose
 * generation never succeeds: it would retry forever and never be offered.
 *
 * So the rule has a floor. Once GENERATION_MAX_RETRIES retries are exhausted, offer
 * what exists IF it still holds at least this many procedural questions
 * (tiers 0 and 1) and at least RECOVERY_MIN_CONCEPTUAL_TO_OFFER conceptual ones
 * (tiers 2 and 3). Below either floor, offer nothing and retry after the
 * student's next session end.
 *
 * The floor is per RATE, not per total, and that is the whole point. Readiness
 * is two rates (§4.2b) and the diagnostic value is entirely in the split. A
 * session of six procedural questions and no conceptual ones clears any
 * total-based floor and still cannot answer the only question recovery is
 * asked — it would report "not ready" with no way to say which half failed,
 * which is precisely the single-number failure §4.2b exists to prevent.
 */
export const RECOVERY_MIN_PROCEDURAL_TO_OFFER = 2;

/**
 * The conceptual half of the same floor (tiers 2 and 3).
 *
 * Two rather than one, here as for the procedural floor: a single question per
 * rate is a coin flip wearing the costume of a measurement. And this is the
 * half that matters most — §4.2 calls tier 1 pass with tier 2 fail "the most
 * common real result and the most useful thing this feature detects".
 */
export const RECOVERY_MIN_CONCEPTUAL_TO_OFFER = 2;

/**
 * §4.1b / §9: at most one recovery-or-revision reminder a day, batched across
 * chapters, and they stop the moment the student starts the session.
 * "Nagging is how a paid feature gets muted."
 */
export const REMINDER_MAX_PER_DAY = 1;

/**
 * §4.6: fresh questions are added in rounds 1-3. Round 4+ draws from the
 * accumulated pool with no further generation — "a chapter that has failed
 * three rounds is not going to be solved by buying more questions."
 */
export const RECOVERY_GENERATION_ROUNDS = 3;

// ── Recovery: the transfer ladder (§4.2) ───────────────────────────────────
//
// THE SESSION IS SIZED BY THE MISTAKES, NOT BY A FIXED NUMBER.
//
// The old ladder was a fixed 2/3/3/2 — ten questions, always. Measured against
// the production mistake book on 2026-09-15 it was wrong in both directions at
// once:
//
//   * A student with ONE mistake got ten questions, eight of which were not
//     about anything he had got wrong.
//   * A student with SIX mistakes got tier 0 capped at two, so FOUR of his six
//     mistakes never appeared in the session at all. They were simply dropped,
//     and nothing downstream ever brought them back.
//
// The second one is the defect. A recovery session that silently omits two
// thirds of what the student got wrong is not a recovery session.
//
// So the ladder is now per-mistake, and the session is as long as the mistakes
// require. There is deliberately NO cap on the total: a cap is exactly how
// mistakes got dropped before, and re-introducing one under a different name
// would re-introduce the bug.

/**
 * At or below this many open mistakes in a chapter, go DEEP: every mistake
 * gets the full four-rung ladder — the original, the same question with
 * different values, the same idea asked differently, and a far application.
 *
 * Two, because the full ladder is four questions per mistake and eight is the
 * most a student will work through carefully. Below that the diagnosis is
 * worth more than the breadth.
 */
export const RECOVERY_DEEP_MAX_MISTAKES = 2;

/**
 * Above RECOVERY_DEEP_MAX_MISTAKES and up to this, go WIDE: every mistake gets
 * the original, a near variant and a mid variant. Tier 3 is dropped — it is
 * the rung that proves transfer to a new application, and a student with six
 * open mistakes in one chapter is not yet at the transfer question.
 *
 * Both rates survive the drop, which is the constraint that decides this.
 * §4.2b needs a procedural rate (tiers 0-1) AND a conceptual rate (tiers 2-3),
 * never blended. Dropping tier 3 leaves tier 2 carrying the conceptual rate on
 * its own — one question per mistake, so three mistakes give a three-question
 * conceptual rate, comfortably above RECOVERY_MIN_CONCEPTUAL_TO_OFFER.
 *
 * An earlier draft of this used "the original plus ONE alternating variant" to
 * keep sessions short. It is recorded here because it looks right and is not:
 * at three mistakes it yields a conceptual rate computed from a SINGLE
 * question, which is below the floor two constants above this one exist to
 * enforce. Shortness is not worth a rate that cannot be measured.
 */
export const RECOVERY_WIDE_MAX_MISTAKES = 8;

/**
 * Questions per mistake in DEEP mode — one at each of tiers 0, 1, 2, 3.
 * Indexed by tier, so the array position IS the tier number.
 */
export const RECOVERY_DEEP_PER_MISTAKE = [1, 1, 1, 1] as const;

/**
 * Questions per mistake in WIDE mode — tiers 0, 1, 2; nothing at tier 3.
 * Same indexing as RECOVERY_DEEP_PER_MISTAKE.
 */
export const RECOVERY_WIDE_PER_MISTAKE = [1, 1, 1, 0] as const;

/**
 * Above RECOVERY_WIDE_MAX_MISTAKES open mistakes in one chapter, a recovery
 * session is the WRONG ANSWER and is not offered.
 *
 * Nine or more mistakes in a single chapter is not a set of slips to drill
 * away; it means the chapter was not learned. Serving twenty-seven variant
 * questions to that student is not recovery, it is punishment, and it is the
 * point at which a student stops opening the app. The screen says so and
 * points them back at the material instead.
 *
 * This is a REFUSAL TO DRILL, never a refusal to help, and it is never a
 * silent one — rpc_start_recovery_session returns mode 'relearn' with the
 * count, so the student is told what the app concluded and why.
 */
export const RECOVERY_RELEARN_ABOVE = RECOVERY_WIDE_MAX_MISTAKES;

// ── Recovery: readiness (§4.2b) ────────────────────────────────────────────
//
// "Two rates, never blended, so the report can say which one failed and what
// that means. 'You can do the steps but the idea isn't solid yet' is
// actionable. A single 74% is not."

/** Tiers 0 and 1 — can they run the procedure. */
export const RECOVERY_PROCEDURAL_THRESHOLD = 0.8;
/** Tiers 2 and 3 — do they understand it. */
export const RECOVERY_CONCEPTUAL_THRESHOLD = 0.7;

// ── Revision (§5) ──────────────────────────────────────────────────────────

/**
 * WEEKLY, three times, then much less often.
 *
 * The spec chose 7 / 21 / 60 — "roughly tripling, which is the shape of every
 * effective spacing schedule". Tripling is the right shape for a deck of
 * flashcards a student owns for years. It is the wrong shape for a school
 * term: the second check lands three weeks later, by which point the chapter
 * has been taught past, and the third lands two months later, which for a
 * student sitting boards in four months is most of the runway.
 *
 * So the schedule is weekly for all three checks. A week is past the point
 * where short-term recall carries you, and it matches the rhythm a school
 * student actually lives in.
 *
 * The honest caveat, recorded rather than hidden: ZERO revision sessions have
 * ever run in production, so there is no data to tune against and none of
 * these four numbers is evidence-based yet. Seven is the one worth defending.
 * REVISION_INTERVAL_SOLID is a guess and should be the first thing revisited
 * once students are actually completing checks.
 */
export const REVISION_INTERVALS_DAYS = [7, 7, 7] as const;

/**
 * After REVISION_STAGES_TO_SOLID passes the chapter is solid — but solid is
 * not finished. Forgetting does not stop because a student passed three
 * checks, so the chapter keeps a check at this interval indefinitely rather
 * than leaving the queue for ever.
 *
 * The old behaviour returned NULL past stage 3, which dropped the chapter out
 * of the schedule permanently. That is the same mistake as gating revision on
 * recovery, one level down: the students who most deserve to keep their good
 * work are the ones the system stops looking after.
 */
export const REVISION_INTERVAL_SOLID = 30;

/**
 * Questions attempted in one chapter, in one session, that book a revision.
 *
 * THREE, and this is the number that decides whether the feature runs at all.
 * The spec said ten. Measured on production 2026-09-15, every chapter_tally
 * row ever written:
 *
 *     rows 11 · mean attempted 2.3 · max attempted 5 · rows at 10+: ZERO
 *
 * Not one chapter in any session has ever reached ten questions, so the
 * revision clock has never started for anybody. Ten was not a quality bar
 * either; it was the second off switch, sitting behind the first.
 *
 * Three rather than one. At one, a twenty-question session spanning nine
 * chapters (which is what the tally data shows a real session looks like)
 * books NINE revisions — roughly a hundred questions next week off a single
 * twenty-question sitting. That is not "let it pile", that is a wall. Three is
 * the smallest count that means the student actually worked on the chapter
 * rather than brushing it, and it still fires on every real session.
 */
export const REVISION_ENGAGEMENT_MIN = 3;

/** §5.4: fresh questions per check — never ones this student has seen. */
export const REVISION_COUNT = 8;

/**
 * Open mistakes from the chapter carried into the revision check, on top of
 * the REVISION_COUNT fresh ones.
 *
 * A revision check made only of fresh questions cannot tell the student
 * whether the specific things they got wrong have stuck. A check made only of
 * their old mistakes tests recall of those questions, not of the chapter. It
 * is both, and they are counted separately (see rpc_submit_revision_session)
 * so "you still miss the same two" and "you have lost the chapter" stay
 * distinguishable.
 *
 * Five, so the check stays under fourteen questions at its longest.
 */
export const REVISION_MISTAKE_MAX = 5;

/** §5.5 */
export const REVISION_PASS_THRESHOLD = 0.7;

/** Passes needed before a chapter drops to REVISION_INTERVAL_SOLID. */
export const REVISION_STAGES_TO_SOLID = 3;

// ── Generation (§4.2a) ─────────────────────────────────────────────────────

/**
 * §4.2a: "Check the bank for existing variants before generating — generation
 * is the fallback, not the default." This is what makes the feature
 * affordable: a variant generated because one student failed a question is
 * there, free and instant, for the next student who fails the same one.
 */
export const VARIANT_CACHE_FIRST = true;

// ── Analysis (§6) ──────────────────────────────────────────────────────────

/**
 * §6.4: "Declaring a trend from two sessions is noise dressed as insight."
 * Below this, the trend state is NOT_ENOUGH_DATA — a real, visible state, not
 * zero and not "stuck".
 */
export const TREND_MIN_SESSIONS = 4;

/** §6.4: accuracy points of movement that count as a trend rather than noise. */
export const TREND_DELTA_POINTS = 10;

/** §6.3: times_wrong that pins a chapter to the top of the analysis list. */
export const REPEATED_MISTAKE_PIN = 3;

// ── Weak areas (§6.2) ──────────────────────────────────────────────────────
//
// WHAT "WEAK" MEANS, AND WHY IT IS NOT A FIXED PERCENTAGE ANY MORE.
//
// It used to be `accuracy < 60`, written at the call sites rather than here —
// and by 2026-09-15 there were THREE live thresholds disagreeing: 60 in
// _rebuild_revision_queue, 60 in rpc_student_academic_snapshot, and 65 in
// rpc_student_improvement_plans (which also applied 65 to a different table,
// concept_mastery.mastery_score). Three answers to one question is the exact
// shape RULE 0 names: fix the shared definition, not the call sites.
//
// A FIXED BAR IS ALSO THE WRONG IDEA. Measured on production, this cohort's
// overall accuracy is 17.9% (823 correct of 4,600 non-skipped attempts). At a
// 60% bar, 202 of 244 chapter rows read "weak" — a list of everything, which
// tells a student nothing about where to start. The mirror failure is a strong
// student at 90% whose genuine 65% gap never clears the bar at all.
//
// So weak is relative to THE STUDENT'S OWN baseline: a chapter is weak when
// they do materially worse on it than they do generally. That is the same
// number for nobody, which is the point.

/**
 * Attempts in a chapter before any verdict is given at all.
 *
 * FIVE. The old floor was two, which made one wrong answer out of two a 50%
 * accuracy and therefore "weak" — the thing this must not do. Five is the
 * smallest count where a single unlucky question cannot by itself put a
 * chapter on the list.
 *
 * Below this the row is still RETURNED, with is_weak false: "not enough
 * evidence" and "fine" are different statements, and collapsing them is how a
 * chapter a student has barely touched disappears from their own analysis.
 */
export const WEAK_MIN_ATTEMPTS = 5;

/**
 * Accuracy points below the student's own baseline that count as weak.
 *
 * Fifteen. Small enough to catch a real gap, wide enough that ordinary
 * variation between chapters does not flag half of them. It is a judgment and
 * should be revisited against real usage — there is no data yet on how widely
 * one student's chapter accuracies actually spread.
 */
export const WEAK_MARGIN_POINTS = 15;

/**
 * How far back the accuracy behind "weak" is measured.
 *
 * Ninety days, so a chapter can STOP being weak. Without a window, accuracy is
 * a lifetime average and a chapter the student fixed months ago keeps dragging
 * its old failures forward for ever — which is the "mistakes never decay"
 * problem, one level up.
 *
 * When the window holds fewer than WEAK_MIN_ATTEMPTS the function falls back
 * to all time for that chapter rather than reporting nothing: a student
 * returning after the holidays must not find their analysis blank.
 */
export const WEAK_WINDOW_DAYS = 90;

/**
 * The trend states. NOT_ENOUGH_DATA is deliberately one of them rather than
 * being represented by null or by an absent row — §6.4 requires it to be
 * visible, and a nullable "trend" is how it becomes invisible.
 */
export type TrendState = "improving" | "stuck" | "worsening" | "not_enough_data";

/**
 * The chapter states, from §3.2. Kept beside the constants because a state
 * machine spread across two files is a state machine with two versions.
 */
export type ChapterState =
  | "untouched"
  | "has_mistakes"
  | "in_recovery"
  | "recovered"
  | "revision_due"
  | "revision_failed";

// ── Question embedding (§10.9) ─────────────────────────────────────────────

/**
 * Bank rows embedded per question-embedding-drain call. It lives in
 * recovery_constants (20261020030000), and check:recovery-constants requires
 * every key there to have its one home here too — it was the one missing.
 * No component reads it; the drain function does, server-side.
 */
export const EMBEDDING_BATCH_SIZE = 300;

/** §4.2: the ladder rungs, and what each one proves. */
export type RecoveryTier = 0 | 1 | 2 | 3;
