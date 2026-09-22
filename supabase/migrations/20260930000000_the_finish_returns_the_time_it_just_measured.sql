-- ═══════════════════════════════════════════════════════════════════════════
-- The finish returns the time it just measured
--
-- rpc_finish_practice_session sums every attempt's time_taken_ms into _time_ms,
-- writes it to practice_sessions.total_time_ms, and then does not return it.
-- Practice.tsx reads it anyway:
--
--     totalTimeMs: typeof fin.total_time_ms === "number" ? fin.total_time_ms : null
--
-- so that field is `undefined` on every finish, the ternary resolves to null,
-- and the result screen — which prefers serverStats over anything it can
-- derive — has no duration to show for the session the student has just this
-- second finished. The practice HISTORY list is fine, because it reads the
-- column straight off practice_sessions; it is only the hand-off from the
-- finish call that drops it.
--
-- One key, added to a RETURN that already carries eight others measured in the
-- same breath. It matters more since 20260928000000 made that same _time_ms
-- the source of the study minutes on the Analysis heatmap: the number the
-- server records and the number the student is shown should be one number.
--
-- Reverse: supabase/migrations/rollback/20260930000000_the_finish_returns_the_time_it_just_measured.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_finish_practice_session';

  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_finish_practice_session not found'; END IF;
  IF md5(_def) <> '18b6ed2ebad910d92e7ac57ba1a69cdf' THEN
    RAISE EXCEPTION 'rpc_finish_practice_session has changed since this was written (live md5 %)', md5(_def);
  END IF;

  _def := replace(_def, E'\r\n', E'\n');

  -- Read off the ROW, not off _time_ms. They are the same number on a first
  -- finish; on a re-finish the row is the one that stands, and what the screen
  -- is told should be what the record says.
  _new := replace(_def,
    $old$    'accuracy', _s.accuracy,$old$,
    $new$    'accuracy', _s.accuracy,
    'total_time_ms', _s.total_time_ms,$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the RETURN block'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'the finish now returns total_time_ms';
END
$fix$;

-- ── Prove it ────────────────────────────────────────────────────────────────
-- G11: driven, not read. One attempt with a known 90-second timing, and the
-- returned key must both EXIST and equal what the row was written with — a
-- return that hardcoded a zero, or one that returned _time_ms while the row
-- said something else, fails.
DO $prove$
DECLARE
  _uid uuid; _q record; _sess uuid; _fin jsonb; _row int;
BEGIN
  BEGIN
    SELECT s.user_id INTO _uid
      FROM public.students s
      JOIN public.practice_sessions ps ON ps.user_id = s.user_id
     WHERE s.deleted_at IS NULL
     GROUP BY s.user_id ORDER BY count(*) DESC LIMIT 1;
    IF _uid IS NULL THEN RAISE EXCEPTION 'nobody has ever practised'; END IF;

    SELECT qb.id, qb.subject, qb.chapter, qb.question, qb.correct_index INTO _q
      FROM public.question_bank qb
     WHERE qb.is_active AND qb.correct_index IS NOT NULL
       AND jsonb_array_length(qb.options) >= 2
     ORDER BY qb.id LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

    _sess := public.rpc_start_practice_session(_q.subject, _q.chapter, 1, 'chapter', NULL, NULL);
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

    SELECT total_time_ms INTO _row FROM public.practice_sessions WHERE id = _sess;

    IF NOT (_fin ? 'total_time_ms') THEN
      RAISE EXCEPTION 'the finish still does not return total_time_ms: %', _fin;
    END IF;
    IF (_fin->>'total_time_ms')::int IS DISTINCT FROM _row
       OR (_fin->>'total_time_ms')::int <> 90000 THEN
      RAISE EXCEPTION 'returned % but the row holds % (expected 90000)',
        _fin->>'total_time_ms', _row;
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'the finish returns the same timing it wrote to the row';
    ELSE
      RAISE;
    END IF;
  END;
END
$prove$;

COMMIT;
