import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicLive } from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { toErrorMessage } from "@/lib/presentation";
import { hourHistogram } from "@/lib/studentAnalysisMetrics";

export type PracticeSessionSummary = {
  id: string;
  subject: string;
  // CHUNK 10.7 — nullable: a session with no single chapter (Weak Areas,
  // Incorrect, Skipped, Bookmarked, Custom with no chapter chosen) is a real
  // state, not missing data.
  chapter: string | null;
  question_count: number;
  correct_count: number;
  /**
   * Answered and got wrong — NOT `question_count - correct_count`, which
   * counts every skipped question as one got wrong. Selected by the query and
   * spread into these rows all along; it was simply never declared, so any
   * consumer wanting a pooled accuracy had to re-derive the denominator and
   * got the skip rule wrong doing it.
   */
  wrong_count: number;
  score: number;
  created_at: string;
  // NOT nullable. Every PracticeSessionSummary is produced by sessionSummary
  // below, which only ever receives rows the query and the call-site filter
  // have already restricted to finished sessions. Widening this would have
  // been the wrong kind of honest: `new Date(null).getTime()` is 0 — the
  // epoch, not Invalid Date — so it pushed four sorts in
  // studentAnalysisMetrics into ordering unfinished sessions as though they
  // happened in 1970.
  finished_at: string;
  /**
   * How long this session's questions actually took, in milliseconds — or
   * NULL when nothing timed it.
   *
   * This was `duration_minutes`, and it was derived as
   * `total_time_ms ?? (finished_at - created_at)`. The fallback is the defect:
   * wall clock is how long the ROW EXISTED, not how long the student worked,
   * and on this database it was not even that. Measured 2026-09-17, 240 of
   * 284 finished sessions carry exactly 1080 wall seconds — an 18-minute
   * seeded constant. Divided by the question count that constant became a
   * per-question pace, so "which subject takes you longest" was answering
   * "which subject has the fewest questions per session".
   *
   * NULL, never 0, and never a guess: a session nobody timed has no duration,
   * and every consumer below must decide what to do about that rather than be
   * handed a number that was never measured.
   */
  measured_ms: number | null;
  accuracy_pct: number;
};

/**
 * Practice accuracy, over the questions that were ANSWERED.
 *
 * Exported and named rather than written inline, because the Overview tab
 * prints `correct`, `wrong` and this side by side, and the one rule that must
 * hold is that they agree: correct / (correct + wrong). It did not hold when
 * skips were removed from `wrong` and left in this denominator — measured in
 * a real browser as 10 correct, 14 incorrect, "Accuracy 36%", where 10 of 24
 * is 42%.
 *
 * Null, never 0, when nothing has been answered: 0% claims a student who has
 * never practised got everything wrong.
 */
export function accuracyOverAnswered(correct: number, wrong: number): number | null {
  const answered = correct + wrong;
  return answered > 0 ? Math.round((100 * correct) / answered) : null;
}

export type AnalysisPageData = {
  student_class: string | null;
  recent_sessions: PracticeSessionSummary[];
  totals: {
    correct: number;
    wrong: number;
    /**
     * §6.6 — questions the student passed over, counted separately from wrong
     * ones. Surfacing this is not decoration: accuracy now EXCLUDES skips, so
     * a student who skips heavily would otherwise look better without anything
     * on the screen saying why.
     */
    skipped: number;
    /** NULL when nothing has been attempted — never 0, which would read as
     *  "got everything wrong" for a student who has not started. */
    accuracy_pct: number | null;
  };
  /**
   * 24 buckets, Mon-index 0 = midnight, counting this student's attempts by
   * the hour of the VIEWER'S clock over the last 28 days.
   *
   * The Activity & Speed tab's "Most productive hour" tile rendered "—" for
   * every student, forever, on the belief that the hour was not recorded.
   * question_attempts.created_at has been set on every attempt all along —
   * 5,623 of them, across 11 distinct hours, measured 2026-09-18. The figure
   * was stored and unread, which is a different thing from missing.
   *
   * Bucketed in the browser rather than in SQL: the database runs in UTC and
   * holds no column saying where a student is, and India is UTC+5:30, so a
   * UTC hour bucket straddles two local hours and cannot be corrected
   * afterwards.
   */
  attempt_hours: number[];
};

/**
 * Did the student actually attempt anything in this session?
 *
 * correct + wrong + skipped IS the attempt count. `question_count` is not: for
 * a session the loader could not fill, rpc_finish_practice_session leaves it at
 * the REQUESTED count (it only overwrites when the attempt total is above
 * zero), so a shell reads as a full 20-question session scored 0%.
 *
 * Exported and tested rather than inlined, because "a session with no attempts
 * is not a session scored zero" is a rule every consumer of these rows needs to
 * apply the same way — the defect was one screen not applying it at all.
 */
export function sessionWasAttempted(row: {
  correct_count?: number | null;
  wrong_count?: number | null;
  skipped_count?: number | null;
}): boolean {
  return (row.correct_count ?? 0) + (row.wrong_count ?? 0) + (row.skipped_count ?? 0) > 0;
}

function sessionSummary(row: {
  id: string;
  subject: string;
  // Nullable in practice_sessions; carried through to the summary unchanged.
  chapter: string | null;
  question_count: number;
  correct_count: number;
  score: number;
  created_at: string;
  finished_at: string;
  accuracy?: number | null;
  wrong_count?: number | null;
  skipped_count?: number | null;
  total_time_ms?: number | null;
}): PracticeSessionSummary {
  // THE ONLY TIME SOURCE IS THE ONE THE APP MEASURED.
  //
  // `total_time_ms` is the sum of this session's question_attempts.time_taken_ms,
  // written by rpc_finish_practice_session. Migration 20261030000000 carries
  // that same sum back onto the rows that predate it, so a session with timed
  // attempts has it and a session without has nothing to report.
  const measured_ms =
    typeof row.total_time_ms === "number" && row.total_time_ms > 0 ? row.total_time_ms : null;
  // Prefer finish-RPC accuracy column — never re-derive when present.
  const accuracy_pct =
    typeof row.accuracy === "number"
      ? Math.round(Number(row.accuracy))
      : row.question_count > 0
        ? Math.round((100 * row.correct_count) / row.question_count)
        : 0;
  return {
    ...row,
    // Normalised at the boundary: the column is nullable in
    // practice_sessions, and a null that reached a `+` would make every
    // pooled denominator downstream NaN rather than simply wrong.
    wrong_count: row.wrong_count ?? 0,
    measured_ms,
    accuracy_pct,
  };
}

export function useAnalysisPageData(enabled = true) {
  const { user } = useAuth();
  const liveVersion = useAcademicLive(["xp", "profile", "battle"]);
  const [data, setData] = useState<AnalysisPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    if (!user) {
      setData(null);
      endLoading(setLoading);
      return;
    }

    beginLoading(setLoading);
    setError(null);

    try {
      // NO LEADERBOARD FETCH. §6.7 forbids analysis comparing the student to
      // other students, so the rank it fed has been removed from the screen —
      // and a 200-row class leaderboard pulled on every Analysis load to
      // compute a number nothing renders is the definition of dead weight.
      // Ranking lives on the surfaces §10.16 gives it to.
      const [sessionsRes, classRes, attemptsRes, correctRes, skippedRes, hoursRes] = await Promise.all([
        supabase
          .from("practice_sessions")
          .select("id, subject, chapter, question_count, correct_count, score, created_at, finished_at, accuracy, wrong_count, skipped_count, total_time_ms")
          .eq("user_id", user.id)
          .not("finished_at", "is", null)
          .order("finished_at", { ascending: false })
          .limit(40),
        supabase
          .from("students")
          .select("class_id, classes(name, section)")
          .eq("user_id", user.id)
          .maybeSingle(),
        // rpc_student_academic_snapshot USED TO BE CALLED HERE, and its result
        // was destructured into `snapRes` and then never read once. Analysis
        // already mounts useStudentAcademicSnapshot beside this hook, so the
        // page fired the same RPC twice on every load and threw one answer
        // away.
        //
        // That is not merely wasteful: the snapshot is a WRITE. It ends with
        // PERFORM _rebuild_revision_queue, which inserts, updates and
        // auto-clears rows in the AI layer's weak-topic worklist. Opening
        // Analysis ran that twice, concurrently, against the same rows.
        // THE ONE POPULATION ACCURACY IS COUNTED OVER (G5).
        //
        // `question_attempts` is the durable per-attempt record, and it is what
        // `_exam_readiness` counts for `practice_accuracy_pct` — the figure Home
        // shows. Counting the same rows here is what makes the two screens
        // agree; counting anything else is what made them disagree.
        //
        // `question attempts select self` is `user_id = auth.uid()`, so a
        // student counts their own and nobody else's.
        supabase
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        // CORRECT MEANS THE SAME THING HERE AS IT DOES IN THE RPC.
        //
        // This asked only `is_correct = true`, while
        // rpc_student_practice_analytics counts
        // `is_correct AND NOT COALESCE(skipped, false)` for every subject,
        // chapter and topic row on the same page. Two definitions of
        // "correct", agreeing only while no row is both.
        //
        // rpc_record_question_attempt forces is_correct false on a skip, so
        // no row written through it can be both — but seeded and legacy rows
        // were not written through it, and one such row would inflate the
        // Correct tile, deflate Incorrect TWICE over (wrong is
        // total - correct - skipped, and the row counts in both subtrahends),
        // and put the headline accuracy above what the subject rows show.
        // Matching the RPC costs one clause; not matching it is a defect
        // waiting for a single bad row.
        supabase
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_correct", true)
          .not("skipped", "is", true),
        // SKIPS ARE COUNTED SEPARATELY, because they are not wrong answers.
        //
        // rpc_record_question_attempt forces is_correct false on a skip, so
        // `total - correct` silently folded every skipped question into the
        // "Incorrect answers" tile and into the accuracy beside it. Measured
        // 2026-09-15: 241 of 4,841 attempts are skips.
        //
        // This is the same correction made to _weak_topics_for_user in
        // 20261013000000. Making it in one place and not the other is how two
        // screens start disagreeing about the same student again (G5).
        supabase
          .from("question_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("skipped", true),
        // WHEN they practise, for the hour tile. One column, bounded to the
        // same 28 days the heat map and the study-time tiles already cover, so
        // a heavy student fetches a month of timestamps and not a year of
        // them. head:false because the rows themselves are the answer here.
        supabase
          .from("question_attempts")
          .select("created_at")
          .eq("user_id", user.id)
          .gte("created_at", new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString())
          .order("created_at", { ascending: false })
          .limit(5000),
      ]);

      // A FAILED READ IS NOT AN EMPTY ONE. Each of these used to be read as
      // `count ?? 0` or `error ? [] : data`, so one query timing out — the
      // 8-second statement timeout this database hits under load — printed
      // "0 correct" and a 0% accuracy beside the real counts, or "No score
      // trend data yet" for a student with forty sessions. Any failure goes to
      // the error path below: absent figures render as a dash, and the page
      // offers Try again. The class label is the one read allowed to miss —
      // it is a caption, not a figure.
      const failed = [sessionsRes, attemptsRes, correctRes, skippedRes, hoursRes].find((r) => r.error);
      if (failed?.error) throw failed.error;

      const sessions = (sessionsRes.data ?? [])
            .filter((r): r is typeof r & { finished_at: string } => r.finished_at !== null)
            // A SESSION WITH NO ATTEMPTS IS NOT A SESSION SCORED ZERO.
            //
            // src/academic/metrics/practice.ts states this for the accuracy
            // helper, and Analysis was breaking it wholesale: a session where
            // the loader returned no questions is auto-finished (so Resume is
            // not polluted with shells), which stores correct_count 0 and
            // accuracy 0 while question_count keeps the REQUESTED count,
            // because rpc_finish_practice_session only overwrites it when the
            // attempt total is above zero. Analysis then averaged those zeros.
            //
            // Measured on production: the busiest student had 16 finished
            // sessions, 14 of them 0-attempt 'weak' shells left by the
            // weak-area loader returning nothing. Their Analysis was built
            // almost entirely out of sessions they never answered a question
            // in — 0% accuracy, no subject, no chapter.
            //
            // The loader bug is fixed separately (the weak filter is pushed to
            // the database now). This is the other half: even once shells are
            // rare, one is still not a result, and the rows already on
            // production have to stop counting.
            //
            // correct + wrong + skipped is the attempt count; question_count
            // is not, and is what made the shells look like full sessions.
            .filter(sessionWasAttempted)
            .map(sessionSummary);
      const latest = sessions[0];
      const previous = sessions[1];

      let student_class: string | null = null;

      const classRow = classRes.data as {
        classes?: { name: string; section: string } | null;
      } | null;
      if (classRow?.classes) {
        student_class = `Class ${classRow.classes.name}-${classRow.classes.section}`;
      }

      // COUNTED FROM `question_attempts`, THE SAME ROWS HOME COUNTS (G5).
      //
      // These came from `concept_mastery` — summed `total_attempts` and
      // `correct_attempts` across concepts — and that table has DRIFTED from
      // the attempt record it is derived from. Measured 2026-09-11 on a student
      // with 120 real attempts:
      //
      //     question_attempts   120 attempts,  20 correct  ->  17%   (Home)
      //     concept_mastery     200 attempts, 125 correct  ->  63%   (Analysis)
      //
      // Not a subset, not a window: MORE attempts than exist, and a rate 46
      // points apart for one student on two screens. That is the defect G5
      // names — "the same student's accuracy renders as 46%, 48%, 40% and 80%
      // across two screens" — and making the Overview tab internally
      // consistent with `concept_mastery` would only have made it consistently
      // wrong against Home.
      //
      // The session fallback is gone with it: `practice_sessions.correct_count`
      // is seeded on 240 of 244 rows and disagrees with its own attempts
      // (KNOWN_ISSUES 44), so falling back to it reintroduces the same class of
      // error by another route.
      const correct = correctRes.count ?? 0;
      const totalAttempts = attemptsRes.count ?? 0;
      const skipped = skippedRes.count ?? 0;
      // (`?? 0` here is only the shape of a successful head count: a failed
      // one has already been thrown above.)

      // A skip is "I did not answer this", not "I got this wrong". Subtracting
      // it here is what keeps the Incorrect tile, the accuracy derived from it,
      // and §6.6's skipped count from being three views of one confused number.
      const wrong = Math.max(0, totalAttempts - correct - skipped);

      // ACCURACY IS DERIVED FROM THE COUNTS SHOWN BESIDE IT (G5).
      //
      // This was `overallAccuracyFromSnapshot`, described in its own comment as
      // "the Test + practice blend". The Overview tab renders correct and
      // incorrect from `totalAttempts` — practice attempts — and then rendered
      // that blend next to them, so the tiles read "13 correct · 14 incorrect ·
      // 46% accuracy" and a student who divides gets 48%. Three sources for one
      // quantity on one screen, and the arithmetic on display disagreed with
      // the figure on display.
      //
      // The 10 September ruling settles which one is right: practice supplies
      // the detail, tests supply marks only, and "the two are NEVER combined
      // into one figure. No average, no composite, no single performance score
      // across both." A blend cannot be shown here whatever it is called.
      //
      // So it is computed from `correct` and `wrong` — the same two numbers the
      // tab prints. Null when nothing has been attempted: 0% would claim a
      // student who has never practised got everything wrong.
      // OVER THE COUNTS RENDERED BESIDE IT, which is now correct + wrong and
      // no longer totalAttempts.
      //
      // Subtracting skips from `wrong` above without changing this divided a
      // skip-free numerator by a skip-inclusive denominator: measured in the
      // browser at 10 correct, 14 incorrect, "Accuracy 36%" — but 10 + 14 is
      // 24 and 10/24 is 42%. The 36% was 10/28. Three tiles on one row that do
      // not add up is the exact G5 defect the comment above this block
      // describes, reintroduced by a half-applied fix.
      const accuracy_pct = accuracyOverAnswered(correct, wrong);

      // NO PACE FIGURE IS COMPUTED HERE. Per-question time is measured once,
      // on the attempt record, by deriveSubjectPace over
      // rpc_student_practice_analytics.by_subject — and there must not be two.
      // (deriveSpeedStats, the session-level measure this comment used to
      // name, is itself gone: it counted the gaps between questions while
      // every other time figure on the page did not.)
      //
      // This block used to produce `avg_sec_per_question` as the MEAN OF
      // PER-SESSION RATES, while deriveSpeedStats pools (total seconds over
      // total questions). Both rendered on one page: Overview's "Average time
      // per question" read 15s and the Practice tab's "Average per question"
      // read 6s for the same student, in the same minute, off the same rows.
      // That is G5 — one quantity, two definitions, two screens — and the fix
      // is to delete one, not to reconcile them.
      //
      // `last_session_minutes` went with it: declared, assigned, and read by
      // nothing.

      // NO SESSION-TO-SESSION DELTA IS PUBLISHED HERE.
      //
      // `improvement_pct` was `latest.accuracy - previous.accuracy` — a trend
      // declared from TWO sessions, which is the exact thing §6.4 and
      // TREND_MIN_SESSIONS (4) exist to forbid, and which this very page
      // enforces everywhere else through trendState(). Its one consumer was
      // the Milestones tab, where it produced "Accuracy up 12%" as a
      // CELEBRATION off a single lucky sitting against a single bad one.
      // Analysis now runs it through the same ladder as every other trend on
      // the screen.
      //
      // `previous_accuracy` and `current_accuracy` went with it: both were
      // assigned here and read by nothing at all.

      const attempt_hours = hourHistogram(
        (hoursRes.data ?? []).map((r) => r.created_at),
      );

      setData({
        student_class,
        recent_sessions: sessions,
        attempt_hours,
        totals: {
          correct,
          wrong,
          skipped,
          accuracy_pct,
        },
      });
    } catch (e) {
      setError(toErrorMessage(e, "Could not load analysis"));
      // NULL, NOT A ZEROED OBJECT.
      //
      // This handed the page totals of 0/0/0, so a student whose load failed
      // read "Questions solved 0 · Correct 0 · Incorrect 0" underneath a
      // banner saying the data could not be read. Nothing downstream could
      // tell them apart from a student who has genuinely answered nothing,
      // because by the time the figures reached the tiles they were
      // identical.
      //
      // Every consumer already reads this through `analysis?.`, and the page
      // renders an absent total as an em dash. A real zero — a present
      // totals object carrying 0 — still renders 0, because that is a
      // measurement.
      setData(null);
    } finally {
      endLoading(setLoading);
    }
  }, [user, beginLoading, endLoading]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }
    void reload();
  }, [enabled, reload, liveVersion]);

  return { data, loading: enabled ? showLoading(loading) : false, error, reload };
}
