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
 * §4.1: "Fewer than five is not worth a session, and clearing a one-mistake
 * chapter creates a false sense of progress."
 */
export const RECOVERY_TRIGGER_COUNT = 5;

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
// Ten questions per session. The counts are not arbitrary: tier 0 is small
// because re-answering the original proves almost nothing, and tiers 1 and 2
// are the widest because the 1-pass/2-fail split is the single most useful
// thing this feature detects.

/** Tier 0 — the exact questions they got wrong. Closes the specific loop. */
export const RECOVERY_TIER0 = 2;
/** Tier 1 — same question, different values. Proves they can execute it. */
export const RECOVERY_TIER1 = 3;
/** Tier 2 — same concept, different framing. Proves they understand it. */
export const RECOVERY_TIER2 = 3;
/** Tier 3 — same topic, different application. Proves it transfers. */
export const RECOVERY_TIER3 = 2;

/** Derived, so no screen has to add the four up and get it wrong. */
export const RECOVERY_SESSION_SIZE =
  RECOVERY_TIER0 + RECOVERY_TIER1 + RECOVERY_TIER2 + RECOVERY_TIER3;

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
 * §5.3: "Roughly tripling, which is the shape of every effective spacing
 * schedule. Seven days is past the point where short-term recall carries you.
 * Sixty days spans a term."
 */
export const REVISION_INTERVALS_DAYS = [7, 21, 60] as const;

/**
 * §5.2: questions attempted in one chapter that start the revision clock even
 * with nothing to recover. "A student who practises Cash Flow, scores 18 of 20
 * and has nothing to recover still needs reminding a week later."
 */
export const REVISION_ENGAGEMENT_MIN = 10;

/** §5.4: fresh questions per check. Never the old ones. */
export const REVISION_COUNT = 8;

/** §5.5 */
export const REVISION_PASS_THRESHOLD = 0.7;

/** §5.3: pass all three and the chapter leaves the queue. */
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

/** §4.2: the ladder rungs, and what each one proves. */
export type RecoveryTier = 0 | 1 | 2 | 3;
