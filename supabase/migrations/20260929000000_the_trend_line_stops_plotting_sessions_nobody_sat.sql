-- ═══════════════════════════════════════════════════════════════════════════
-- The trend line stops plotting sessions nobody sat
--
-- Analysis draws its score trend from rpc_student_performance_charts'
-- practice_trend, which reads practice_sessions and scores each point as
--
--     round(100.0 * correct_count / NULLIF(question_count, 0), 1)
--
-- with no filter but "finished, in the last 30 days, has a chapter". A session
-- the loader could not fill is auto-finished with zero attempts, and
-- rpc_finish_practice_session leaves question_count at the REQUESTED count for
-- exactly that case — so a 20-question shell plots as a 0% point on the
-- student's trend line.
--
-- 20260928000000 stopped those sessions paying XP and stopped them reaching
-- the heatmap, but the session row is still created and still finished: that
-- is deliberate, so Resume is not polluted with shells. This is the last read
-- that still treats one as a result.
--
-- Not currently visible on this database — the 14 shells are older than the
-- 30-day window and carry a NULL chapter, so today the trend has zero of them
-- — and reachable on purpose: pick a chapter the bank has no questions for,
-- start it, and the empty session is finished WITH that chapter name attached.
--
-- ── ONE HOME FOR THE RULE, IN SQL ───────────────────────────────────────────
--
-- This predicate is now made in three server-side places and one client one:
--
--     rpc_student_academic_snapshot   self_practice.sessions_completed
--     rpc_student_performance_charts  practice_trend
--     rpc_finish_practice_session     whether the finish pays for anything
--     useAnalysisPageData.ts          sessionWasAttempted, for the session list
--
-- The finish RPC has the live attempt count in hand and needs no helper. The
-- two READS were each carrying their own copy of the arithmetic, which is the
-- shape §10 item 7 warns about, so they now call one function. The client copy
-- stays — it filters rows already fetched, and crossing the wire to ask the
-- database whether a row it is holding counts would be worse — and it is the
-- same rule in the same words, which is what its own comment says.
--
-- Reverse: supabase/migrations/rollback/20260929000000_the_trend_line_stops_plotting_sessions_nobody_sat.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- The rule, once. IMMUTABLE because it is arithmetic on its arguments and
-- nothing else, which also lets the planner fold it away.
CREATE OR REPLACE FUNCTION public._practice_session_attempted(
  _correct integer, _wrong integer, _skipped integer
) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $fn$
  SELECT (COALESCE(_correct, 0) + COALESCE(_wrong, 0) + COALESCE(_skipped, 0)) > 0;
$fn$;

COMMENT ON FUNCTION public._practice_session_attempted(integer, integer, integer) IS
  'Did the student attempt anything in this session? correct + wrong + skipped IS the attempt count; question_count is not — it keeps the REQUESTED count for a session the loader could not fill. Mirrored in TypeScript as sessionWasAttempted in src/hooks/useAnalysisPageData.ts.';

REVOKE EXECUTE ON FUNCTION public._practice_session_attempted(integer, integer, integer) FROM anon, authenticated;

DO $fix$
DECLARE _def text; _new text;
BEGIN
  ----------------------------------------------------------------------------
  -- 1. practice_trend stops plotting unanswered sessions
  ----------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_student_performance_charts';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_student_performance_charts not found';
  END IF;
  IF md5(_def) <> '6abcbaf6f9ba271d86121ff8e92e9edf' THEN
    RAISE EXCEPTION 'rpc_student_performance_charts has changed since this was written (live md5 %)', md5(_def);
  END IF;

  -- Stored with CRLF; this file is LF, so a multi-line anchor would match
  -- nothing. Normalise once, then assert no carriage return survives.
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$      FROM public.practice_sessions
      WHERE user_id = _uid AND finished_at IS NOT NULL
        AND finished_at >= now() - interval '30 days'
        AND chapter IS NOT NULL$old$,
$new$      FROM public.practice_sessions
      WHERE user_id = _uid AND finished_at IS NOT NULL
        AND finished_at >= now() - interval '30 days'
        -- A session with no attempts is not a point on a trend line. Its
        -- question_count is the count that was ASKED FOR, so it plots as a
        -- flat 0% for a student who was never shown a question.
        AND public._practice_session_attempted(correct_count, wrong_count, skipped_count)
        AND chapter IS NOT NULL$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the practice_trend source clause'; END IF;
  IF position(E'\r' in _new) > 0 THEN RAISE EXCEPTION 'a carriage return survived normalisation'; END IF;

  EXECUTE _new;

  ----------------------------------------------------------------------------
  -- 2. The snapshot asks the same function instead of repeating the sum
  ----------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_student_academic_snapshot';

  IF md5(_def) <> '9b90131e1df34c252bcc6d2a2bdb497c' THEN
    RAISE EXCEPTION 'rpc_student_academic_snapshot has changed since this was written (live md5 %)', md5(_def);
  END IF;
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
    'AND (COALESCE(correct_count, 0) + COALESCE(wrong_count, 0) + COALESCE(skipped_count, 0)) > 0;',
    'AND public._practice_session_attempted(correct_count, wrong_count, skipped_count);');
  IF _new = _def THEN RAISE EXCEPTION 'could not find the sessions_completed predicate'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'both reads now ask _practice_session_attempted';
END
$fix$;

-- ── Prove it ────────────────────────────────────────────────────────────────
-- G11: the helper is exercised at its boundary, and then the real RPC is
-- driven for a real student with an empty session created inside the proof.
-- Item 2's positive control answers the obvious wrong fix — a filter that
-- excluded everything would leave the trend empty and fail it.
DO $prove$
DECLARE
  _uid   uuid;
  _q     record;
  _sess  uuid;
  _before int; _after int; _with int;
  _charts jsonb;
BEGIN
  IF public._practice_session_attempted(0, 0, 0)
     OR NOT public._practice_session_attempted(0, 0, 1)
     OR NOT public._practice_session_attempted(1, 0, 0)
     OR NOT public._practice_session_attempted(0, 1, 0)
     OR public._practice_session_attempted(NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'the helper does not agree with "correct + wrong + skipped > 0"';
  END IF;

  BEGIN
    SELECT ps.user_id INTO _uid
      FROM public.practice_sessions ps
     WHERE ps.finished_at IS NOT NULL
     GROUP BY ps.user_id ORDER BY count(*) DESC LIMIT 1;

    IF _uid IS NULL THEN
      RAISE EXCEPTION 'nobody has ever finished a session; this could not be exercised';
    END IF;

    SELECT qb.subject, qb.chapter, qb.question, qb.id, qb.correct_index INTO _q
      FROM public.question_bank qb
     WHERE qb.is_active AND qb.chapter IS NOT NULL AND qb.correct_index IS NOT NULL
     ORDER BY qb.id LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

    _charts := public.rpc_student_performance_charts();
    _before := jsonb_array_length(_charts->'practice_trend');

    -- An EMPTY session, finished, with a chapter attached: exactly the shape
    -- that used to plot as 0%.
    _sess := public.rpc_start_practice_session(_q.subject, _q.chapter, 20, 'chapter', NULL, NULL);
    PERFORM public.rpc_finish_practice_session(_sess, '[]'::jsonb, true, true);

    _charts := public.rpc_student_performance_charts();
    _after := jsonb_array_length(_charts->'practice_trend');

    IF _after <> _before THEN
      RAISE EXCEPTION 'an unanswered session still reached the trend line: % -> % points', _before, _after;
    END IF;

    -- POSITIVE CONTROL: an ANSWERED session in the same chapter DOES reach it.
    _sess := public.rpc_start_practice_session(_q.subject, _q.chapter, 1, 'chapter', NULL, NULL);
    PERFORM public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', _q.correct_index),
      _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                                'bank_question_id', _q.id),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', _q.correct_index),
      _session_id         => _sess,
      _bank_question_id   => _q.id,
      _source             => 'practice');
    PERFORM public.rpc_finish_practice_session(_sess, NULL, true, true);

    _charts := public.rpc_student_performance_charts();
    _with := jsonb_array_length(_charts->'practice_trend');

    IF _with <> _before + 1 THEN
      RAISE EXCEPTION
        'the filter removed real sessions too: % points before, % after an answered one', _before, _with;
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'an unanswered session is not a point on the trend; an answered one still is';
    ELSE
      RAISE;
    END IF;
  END;
END
$prove$;

COMMIT;
