-- ═══════════════════════════════════════════════════════════════════════════
-- A session you did not answer is not practice
--
-- rpc_finish_practice_session treated "finished" as "practised". A session the
-- loader could not fill is auto-finished with zero attempts — deliberately, so
-- Resume is not polluted with shells — and that empty finish was then paid
-- for five times over:
--
--   _xp := correct*5 + 25          the 25-point completion bonus, for a
--                                  session with nothing in it
--   _bump_academic_activity(…, 1)  +1 practice session and >= 1 minute on the
--                                  Analysis heatmap, and this call sat OUTSIDE
--                                  the "first finish" guard entirely, so a
--                                  re-finish counted again
--   student_xp.practice_sessions_count += 1
--   _progression_bump_study_streak     a streak day
--   rpc_apply_progression('practice.session.complete')
--
-- Measured live before this migration, on qa.automation@wisdomcampus.com:
--
--   14 finished sessions with ZERO attempts, 25 XP awarded for each — 350 XP
--   for answering nothing, and 350 in the progression ledger to match.
--   student_xp counted 16 practice sessions against 2 actually sat.
--   academic_daily_activity held 16 practice sessions and 20 minutes, against
--   a measured 0.54 minutes of question time across those two.
--
-- That is §7 exactly — "the design catches a student who clears without
-- learning rather than trusting them" — defeated by starting a session in a
-- mode with no questions and pressing nothing. Previous Year Questions is such
-- a mode today: 0 of 21,696 bank rows carry an exam year or a pyq source, so
-- every PYQ session is an empty one.
--
-- 20260925000000 fixed the SYMPTOM on one tile: the Analysis "Practice
-- sessions" count stopped including shells. This is the cause, and it is one
-- guard in one place — the same attempt count the client calls
-- sessionWasAttempted.
--
-- ── WHAT THE MINUTES NOW COME FROM ──────────────────────────────────────────
--
-- The bump recorded wall clock, finished_at - created_at, floored at one
-- minute. total_time_ms — the sum of the per-question timings this same
-- function has just written — is the time actually spent on the questions, and
-- every one of the four real sessions on this database carries it. Wall clock
-- remains the fallback for a session with no per-question timing (the
-- 240-session scale fixture is all of them), and the one-minute floor stays,
-- because a session that was sat is not zero minutes of work.
--
-- ── WHAT IS REPAIRED, AND WHAT IS DELIBERATELY NOT ──────────────────────────
--
-- Repaired: academic_daily_activity (the heatmap and the study-time tile) and
-- the practice-session counter on student_xp. Both are plain derived counters
-- and both are recomputed here from practice_sessions, which is their source.
--
-- NOT repaired: the 350 XP and the 14 progression_history rows behind it.
-- progression_history carries xp_before/xp_after and level_before/level_after
-- — it is a CHAINED ledger, and deleting rows out of the middle of it would
-- leave every later row's "before" pointing at a total that no longer exists.
-- The awards were really made; what changes is that they can no longer be
-- made. One QA automation account holds all 350, and it is reported rather
-- than quietly rewritten.
--
-- Also not repaired: activity rows that do not exist. 240 (user, date) pairs
-- have attempted sessions and no activity row, because the northfield scale
-- fixture inserted those sessions directly instead of through this function.
-- Deriving rows for them would mean writing ~18 minutes of wall-clock study
-- time per fixture session that nobody spent — inventing a measurement, which
-- is the thing this migration exists to stop.
--
-- Reverse: supabase/migrations/rollback/20260928000000_a_session_you_did_not_answer_is_not_practice.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_finish_practice_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_finish_practice_session not found';
  END IF;

  -- G11: anchored on the live body this was written against. A changed body
  -- aborts rather than being edited blind.
  IF md5(_def) <> '20827421699fc57353cb05487d5d4442' THEN
    RAISE EXCEPTION
      'rpc_finish_practice_session has changed since this migration was written (live md5 %)', md5(_def);
  END IF;

  -- The live body is stored with CRLF line endings — it was last written by a
  -- migration applied from a Windows checkout — and this file is LF, so a
  -- multi-line anchor below would match nothing and the second edit would
  -- silently no-op. Normalising once is the fix; it changes only the source
  -- text's line endings, and the assertion after the edits proves the \r are
  -- gone rather than assuming it.
  _def := replace(_def, E'\r\n', E'\n');

  -- 1. No attempts, no XP. Not even the completion bonus.
  _new := replace(_def,
    '_xp := GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END;',
    '_xp := CASE WHEN _total > 0'
      || E'\n              THEN GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END'
      || E'\n              ELSE 0 END;');
  IF _new = _def THEN RAISE EXCEPTION 'could not find the XP expression'; END IF;
  _def := _new;

  -- 2. The activity bump moves INSIDE the first-finish guard and gains the
  --    attempt guard, and its minutes come from the measured question time.
  --    The same guard is added to the XP / streak / progression block, which
  --    is the statement immediately after it.
  _new := replace(_def,
$old$  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  IF NOT _already THEN$old$,
$new$  -- A session with no attempts is not a session. It is not a day of
  -- activity, it is not a minute of study, it is not a practice session on
  -- the counter, it is not a streak day and it is not worth XP. `_total` is
  -- the attempt count this function has just measured from question_attempts
  -- — the same rule the client calls sessionWasAttempted.
  IF NOT _already AND _total > 0 THEN
    -- The time actually spent on the questions, not the clock on the wall.
    -- Wall clock is the fallback for a session with no per-question timing,
    -- and the one-minute floor stays: a session that was sat is not zero.
    _mins := GREATEST(
      CASE WHEN _time_ms > 0
           THEN round(_time_ms / 60000.0)::int
           ELSE COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1)
      END,
      1
    );
    PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);
  END IF;

  IF NOT _already AND _total > 0 THEN$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the activity bump and its following guard'; END IF;

  IF position(E'\r' in _new) > 0 THEN
    RAISE EXCEPTION 'the normalised body still carries a carriage return';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'rpc_finish_practice_session no longer pays for an unanswered session';
END
$fix$;

-- ── Repair the two derived counters ─────────────────────────────────────────

-- The heatmap and the study-time tile. Every existing row is recomputed from
-- the sessions that were actually answered; test_count, homework_count and
-- battle_count are untouched, being different features that nothing here
-- measured.
UPDATE public.academic_daily_activity a
   SET self_practice_count = COALESCE((
         SELECT count(*)::int
           FROM public.practice_sessions ps
          WHERE ps.user_id = a.user_id
            AND ps.finished_at::date = a.activity_date
            AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
       ), 0),
       practice_minutes = COALESCE((
         SELECT sum(GREATEST(
                  CASE WHEN COALESCE(ps.total_time_ms, 0) > 0
                       THEN round(ps.total_time_ms / 60000.0)::int
                       ELSE round(EXTRACT(EPOCH FROM (ps.finished_at - ps.created_at)) / 60.0)::int
                  END, 1))::int
           FROM public.practice_sessions ps
          WHERE ps.user_id = a.user_id
            AND ps.finished_at::date = a.activity_date
            AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
       ), 0);

-- The practice-session counter on student_xp: a plain counter, so it can
-- simply be recounted. xp and level are NOT touched here — see the header.
UPDATE public.student_xp x
   SET practice_sessions_count = (
         SELECT count(*)::int
           FROM public.practice_sessions ps
          WHERE ps.user_id = x.user_id
            AND ps.finished_at IS NOT NULL
            AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
       ),
       updated_at = now()
 WHERE x.practice_sessions_count IS DISTINCT FROM (
         SELECT count(*)::int
           FROM public.practice_sessions ps
          WHERE ps.user_id = x.user_id
            AND ps.finished_at IS NOT NULL
            AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
       );

-- ── Prove it ────────────────────────────────────────────────────────────────
-- G11: every assertion can fail. Item 1 drives the real RPC on a real empty
-- session and requires nothing to move; item 2 drives one WITH an attempt and
-- requires everything to move, so a guard that simply switched practice off
-- fails item 2 rather than passing item 1. The proof WRITES, so it runs inside
-- an inner block — an implicit savepoint — and raises a sentinel at the end;
-- anything that is not the sentinel is re-raised and aborts the migration.
DO $prove$
DECLARE
  _uid   uuid;
  _q     record;
  _sess  uuid;
  _xp0 int; _xp1 int; _cnt0 int; _cnt1 int;
  _act0 int; _act1 int; _min0 int; _min1 int;
  _fin   jsonb;
  _bad   int;
BEGIN
  BEGIN
    SELECT s.user_id INTO _uid
      FROM public.students s
      JOIN public.practice_sessions ps ON ps.user_id = s.user_id
     WHERE s.deleted_at IS NULL
     GROUP BY s.user_id
     ORDER BY count(*) DESC
     LIMIT 1;

    IF _uid IS NULL THEN
      RAISE EXCEPTION 'nobody has ever practised; this could not be exercised';
    END IF;

    SELECT qb.id, qb.chapter_id, qb.subject, qb.chapter, qb.question, qb.correct_index
      INTO _q
      FROM public.question_bank qb
     WHERE qb.is_active AND qb.correct_index IS NOT NULL
       AND jsonb_array_length(qb.options) >= 2
     ORDER BY qb.id LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

    SELECT COALESCE(x.xp, 0), COALESCE(x.practice_sessions_count, 0) INTO _xp0, _cnt0
      FROM public.student_xp x WHERE x.user_id = _uid;
    SELECT COALESCE(sum(self_practice_count), 0), COALESCE(sum(practice_minutes), 0)
      INTO _act0, _min0
      FROM public.academic_daily_activity WHERE user_id = _uid;

    -- 1. An EMPTY session pays nothing.
    _sess := public.rpc_start_practice_session(
      COALESCE(_q.subject, 'Mathematics'), _q.chapter, 1, 'chapter', NULL, NULL);
    _fin  := public.rpc_finish_practice_session(_sess, '[]'::jsonb, true, true);

    SELECT COALESCE(x.xp, 0), COALESCE(x.practice_sessions_count, 0) INTO _xp1, _cnt1
      FROM public.student_xp x WHERE x.user_id = _uid;
    SELECT COALESCE(sum(self_practice_count), 0), COALESCE(sum(practice_minutes), 0)
      INTO _act1, _min1
      FROM public.academic_daily_activity WHERE user_id = _uid;

    IF (_fin->>'xp_earned')::int <> 0 OR _xp1 <> _xp0 OR _cnt1 <> _cnt0
       OR _act1 <> _act0 OR _min1 <> _min0 THEN
      RAISE EXCEPTION
        'an unanswered session still paid: xp_earned=%, xp %->%, sessions %->%, activity %->%, minutes %->%',
        _fin->>'xp_earned', _xp0, _xp1, _cnt0, _cnt1, _act0, _act1, _min0, _min1;
    END IF;

    -- 2. POSITIVE CONTROL: an ANSWERED session still pays, or the guard is
    --    just a switch that turned practice off.
    _sess := public.rpc_start_practice_session(
      COALESCE(_q.subject, 'Mathematics'), _q.chapter, 1, 'chapter', NULL, NULL);
    PERFORM public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', _q.correct_index),
      _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                                'bank_question_id', _q.id),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', _q.correct_index),
      _session_id         => _sess,
      _bank_question_id   => _q.id,
      _time_taken_ms      => 90000,
      _source             => 'practice');
    _fin := public.rpc_finish_practice_session(_sess, NULL, true, true);

    SELECT COALESCE(x.xp, 0), COALESCE(x.practice_sessions_count, 0) INTO _xp1, _cnt1
      FROM public.student_xp x WHERE x.user_id = _uid;
    SELECT COALESCE(sum(self_practice_count), 0), COALESCE(sum(practice_minutes), 0)
      INTO _act1, _min1
      FROM public.academic_daily_activity WHERE user_id = _uid;

    IF (_fin->>'xp_earned')::int <= 0 OR _cnt1 <> _cnt0 + 1 OR _act1 <> _act0 + 1 THEN
      RAISE EXCEPTION
        'an ANSWERED session stopped counting: xp_earned=%, sessions %->%, activity %->%',
        _fin->>'xp_earned', _cnt0, _cnt1, _act0, _act1;
    END IF;

    -- 90 seconds of question time rounds to 2 minutes, and must NOT be the
    -- wall-clock figure, which is under a second inside this transaction and
    -- would floor to 1. A rewrite that kept wall clock fails here.
    IF _min1 - _min0 <> 2 THEN
      RAISE EXCEPTION
        'the heatmap minutes did not come from the measured question time: expected +2 for 90s, got +%',
        _min1 - _min0;
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'an unanswered session pays nothing; an answered one still pays, and its minutes are the measured question time';
    ELSE
      RAISE;
    END IF;
  END;

  -- The repair, asserted over the whole table rather than over one row.
  SELECT count(*) INTO _bad
    FROM public.academic_daily_activity a
   WHERE a.self_practice_count IS DISTINCT FROM COALESCE((
           SELECT count(*)::int
             FROM public.practice_sessions ps
            WHERE ps.user_id = a.user_id
              AND ps.finished_at::date = a.activity_date
              AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
         ), 0);

  IF _bad > 0 THEN
    RAISE EXCEPTION '% activity row(s) still disagree with the sessions behind them', _bad;
  END IF;

  SELECT count(*) INTO _bad
    FROM public.student_xp x
   WHERE x.practice_sessions_count IS DISTINCT FROM (
           SELECT count(*)::int
             FROM public.practice_sessions ps
            WHERE ps.user_id = x.user_id
              AND ps.finished_at IS NOT NULL
              AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
         );

  IF _bad > 0 THEN
    RAISE EXCEPTION '% student_xp row(s) still count sessions nobody answered', _bad;
  END IF;

  RAISE NOTICE 'both derived counters agree with practice_sessions';
END
$prove$;

COMMIT;
