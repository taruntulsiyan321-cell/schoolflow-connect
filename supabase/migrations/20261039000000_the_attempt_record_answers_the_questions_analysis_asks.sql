-- THE ATTEMPT RECORD ANSWERS THE QUESTIONS ANALYSIS ASKS.
--
-- ── WHAT ANALYSIS COULD NOT SAY, AND WHY ────────────────────────────────────
--
-- question_attempts holds one row per question a student has answered, with
-- subject, chapter, topic, difficulty, correctness, skip, time_taken_ms,
-- attempt_number and solution_viewed on every one. Measured 2026-09-18:
--
--     attempts                 5,623
--     carrying difficulty      5,623   (3 distinct)
--     carrying a topic           823   (every bank-backed attempt, and it
--                                       never disagrees with the bank)
--     distinct chapters           72
--     timed                    5,570
--     solution viewed            400
--     repeat attempts            653
--
-- Analysis reads almost none of it. Chapter analysis came from
-- concept_mastery, a derived table the codebase already documents as having
-- DRIFTED from the attempts it is built on (measured: 200 attempts recorded
-- against 120 that exist). Topic time was not shown at all, though "which
-- topic takes you longest" is the question the tab's own heading implies.
-- Accuracy by difficulty, how often a student reaches for the solution, and
-- whether they get it right first time were stored and never looked at.
--
-- ── WHY AN RPC AND NOT A WIDER SELECT ───────────────────────────────────────
--
-- The alternative was to pull every attempt into the browser and group it
-- there. A busy student has 564 attempts today and will have thousands; ten
-- columns of those on every page load is a cost paid to do in JavaScript what
-- Postgres does in one pass. Every other aggregate on this page already comes
-- from an RPC (_weak_topics_for_user, rpc_student_performance_charts), so this
-- is the shape the page already has.
--
-- The hour-of-day histogram is deliberately NOT here. It has to be bucketed in
-- the viewer's timezone and the database is UTC with no column saying where a
-- student is, so it stays in the browser where the clock is right.
--
-- ── WHAT IT DOES NOT INVENT ─────────────────────────────────────────────────
--
-- Every row carries its own `attempts` count so the screen can apply
-- MIN_ATTEMPTS_FOR_ACCURACY and refuse to report a rate that one answer would
-- decide. Accuracy is correct / ANSWERED — skips excluded — which is the one
-- definition this app has (§6.6, 20261021000000). NULL where nothing was
-- measured, never 0.
--
-- student_mistakes.error_type is NOT read: it is NULL on all 120 rows, so a
-- mistake-type breakdown would be a panel built on an empty column. The
-- recurring list below uses times_wrong, which is populated and real.

CREATE OR REPLACE FUNCTION public.rpc_student_practice_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN jsonb_build_object(
    -- ── by topic ─────────────────────────────────────────────────────────
    -- Slowest first: the tab asks which topic takes longest, so the answer
    -- leads. Only rows with a real topic; an attempt with no topic belongs to
    -- no topic and padding one in is how a chapter came to be called a topic.
    'by_topic', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.avg_sec DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.topic                                                   AS topic,
          max(qa.subject)                                            AS subject,
          max(qa.chapter)                                            AS chapter,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid AND COALESCE(btrim(qa.topic), '') <> ''
        GROUP BY qa.topic
      ) t
    ),

    -- ── by chapter ───────────────────────────────────────────────────────
    -- FROM THE ATTEMPTS, not concept_mastery. Same rows every other figure on
    -- the page counts, so the chapter grid can no longer disagree with the
    -- accuracy tile above it.
    'by_chapter', (
      SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.accuracy ASC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.chapter                                                 AS chapter,
          max(qa.subject)                                            AS subject,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND COALESCE(btrim(qa.chapter), '') <> ''
          AND lower(btrim(qa.chapter)) NOT IN
              ('subject', 'topic', 'daily', 'general', 'concept', 'chapter', 'mixed')
        GROUP BY qa.chapter
      ) c
    ),

    -- ── by difficulty ────────────────────────────────────────────────────
    -- Easy / medium / hard in that order, because the interesting reading is
    -- the SHAPE across them: a student scoring worse on easy than on hard is
    -- making careless errors, not hard-question errors, and that is a
    -- different thing to work on.
    'by_difficulty', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.rank), '[]'::jsonb)
      FROM (
        SELECT
          qa.difficulty                                              AS difficulty,
          CASE lower(qa.difficulty) WHEN 'easy' THEN 1 WHEN 'medium' THEN 2
                                    WHEN 'hard' THEN 3 ELSE 4 END    AS rank,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid AND COALESCE(btrim(qa.difficulty), '') <> ''
        GROUP BY qa.difficulty
      ) d
    ),

    -- ── effort ───────────────────────────────────────────────────────────
    -- How the work was done, not just how it scored. All three are columns
    -- that have been written on every attempt and read by nothing.
    'effort', (
      SELECT jsonb_build_object(
        'attempts',          count(*)::int,
        'solution_viewed',   count(*) FILTER (WHERE COALESCE(qa.solution_viewed, false))::int,
        'repeat_attempts',   count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) > 1)::int,
        -- First-try accuracy against the rest: whether a student gets it right
        -- when they first meet a question, or only after seeing it again.
        'first_try_attempts', count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) = 1
                                                 AND NOT COALESCE(qa.skipped, false))::int,
        'first_try_correct',  count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) = 1
                                                 AND qa.is_correct AND NOT COALESCE(qa.skipped, false))::int
      )
      FROM public.question_attempts qa WHERE qa.user_id = _uid
    ),

    -- ── recurring mistakes ───────────────────────────────────────────────
    -- times_wrong is populated and meaningful — measured, one question wrong
    -- eight times, another seven. A question a student has missed repeatedly
    -- is the single most actionable row this page can show, and nothing
    -- showed it.
    'recurring', (
      SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.times_wrong DESC, r.last_wrong_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          sm.topic                  AS topic,
          sm.chapter                AS chapter,
          sm.subject                AS subject,
          sm.times_wrong            AS times_wrong,
          sm.last_wrong_at          AS last_wrong_at,
          left(sm.question_text, 160) AS question_text
        FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.status = 'open' AND COALESCE(sm.times_wrong, 0) > 1
        ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
        LIMIT 8
      ) r
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_student_practice_analytics() FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_student_practice_analytics() TO authenticated;

COMMENT ON FUNCTION public.rpc_student_practice_analytics() IS
  'Per-topic, per-chapter and per-difficulty practice analytics for the calling student, aggregated from question_attempts — the same rows every other figure on Analysis counts. Replaces the concept_mastery-derived chapter grid, which had drifted from the attempts it was built on. Accuracy is correct/answered with skips excluded (§6.6), and NULL rather than 0 where nothing was answered.';
