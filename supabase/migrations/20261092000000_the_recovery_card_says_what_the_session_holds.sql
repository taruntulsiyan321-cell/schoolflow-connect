-- ===========================================================================
-- THE RECOVERY CARD SAYS WHAT THE SESSION HOLDS
--
-- rpc_student_recovery_queue sized a chapter's session with a formula —
-- open mistakes x the questions each tier asks for — and offered "Start
-- recovery" on the mistake count alone. The session itself is built by
-- _recovery_session_plan_for, from what the bank can actually serve. Measured
-- 2026-09-25 on the CUET audit account: a Macroeconomics card said "8
-- questions, covering all four steps" and served 4 (its originals were
-- AI-answered uploads, which get no generated variants, upload spec §6.2); a
-- chapter whose mistakes all came from screen capture (spec §9: nothing
-- derived from captured content is generated) can have no session at all, and
-- the card still offered one — the tap answered with a toast.
--
-- Now each ready chapter's card is sized from that same plan:
--   planned_size   the questions the session would hold if started now
--   startable      the plan can be offered (complete, or offerable once
--                  generation is exhausted — rpc_start_recovery_session's rule)
--   blocked_reason why not, in the plan's own words, when it cannot
-- Everything else is unchanged.
--
-- ROLLBACK: rollback/20261092000000_the_recovery_card_says_what_the_session_holds.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_student_recovery_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid           uuid := auth.uid();
  _trigger       int;
  _deep_max      int;
  _relearn_above int;
  _out           jsonb := '[]'::jsonb;
  _m             record;
  _plan          jsonb;
  _size          int;
  _startable     boolean;
  _why           text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  _trigger       := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;

  FOR _m IN
    SELECT m.chapter_id, m.open_mistakes, c.name AS chapter, sub.name AS subject,
           cs.state, cs.last_recovery_readiness, cs.recovered_at, COALESCE(rs.rounds, 0) AS rounds,
           (m.open_mistakes >= _trigger AND m.open_mistakes <= _relearn_above) AS ready
      FROM (
        SELECT sm.chapter_id, count(*)::int AS open_mistakes
          FROM public.student_mistakes sm
         WHERE sm.user_id = _uid
           AND sm.status = 'open'
           AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.chapter_id
      ) m
      LEFT JOIN public.chapters c ON c.id = m.chapter_id
      LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
      LEFT JOIN public.chapter_state cs ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
      LEFT JOIN (
        SELECT chapter_id, count(*)::int AS rounds
          FROM public.recovery_sessions
         WHERE user_id = _uid AND completed_at IS NOT NULL
         GROUP BY chapter_id
      ) rs ON rs.chapter_id = m.chapter_id
  LOOP
    _size := 0; _startable := false; _why := NULL;
    IF _m.ready THEN
      BEGIN
        _plan := public._recovery_session_plan_for(_uid, _m.chapter_id);
        SELECT COALESCE(sum((t.value->>'filled')::int), 0)::int INTO _size
          FROM jsonb_each(COALESCE(_plan->'tiers', '{}'::jsonb)) t;
        _startable := COALESCE((_plan->>'complete')::boolean, false)
                   OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);
        IF NOT _startable THEN
          _why := COALESCE(_plan->>'not_offerable_reason',
                           'not enough material to produce a diagnosis for this chapter yet');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        _why := SQLERRM;
      END;
    END IF;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'chapter_id',     _m.chapter_id,
      'chapter',        _m.chapter,
      'subject',        _m.subject,
      'open_mistakes',  _m.open_mistakes,
      'trigger_count',  _trigger,
      'ready',          _m.ready,
      'mode',           CASE
                          WHEN _m.open_mistakes > _relearn_above THEN 'relearn'
                          WHEN _m.open_mistakes < _trigger       THEN 'none'
                          WHEN _m.open_mistakes <= _deep_max     THEN 'deep'
                          ELSE 'wide' END,
      'planned_size',   _size,
      'startable',      _startable,
      'blocked_reason', _why,
      'relearn_above',  _relearn_above,
      'state',          COALESCE(_m.state, 'has_mistakes'),
      'in_recovery',    (_m.state = 'in_recovery'),
      'last_recovery_readiness', _m.last_recovery_readiness,
      'recovered_at',   _m.recovered_at,
      'rounds_taken',   _m.rounds
    ));
  END LOOP;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ready')::boolean DESC, (r->>'open_mistakes')::int DESC), '[]'::jsonb)
    INTO _out FROM jsonb_array_elements(_out) r;
  RETURN _out;
END;
$function$;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE _uid uuid; _q jsonb; _r jsonb; _plan jsonb; _sum int;
BEGIN
  -- A student with a ready chapter: the card's size is its plan's size.
  SELECT sm.user_id INTO _uid FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL AND sm.question_id IS NOT NULL LIMIT 1;
  IF _uid IS NULL THEN RAISE WARNING 'no student with an open mistake to probe'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  _q := public.rpc_student_recovery_queue();
  SELECT r INTO _r FROM jsonb_array_elements(_q) r WHERE (r->>'ready')::boolean LIMIT 1;
  IF _r IS NULL THEN RAISE WARNING 'no ready chapter to probe'; RETURN; END IF;
  IF NOT (_r ? 'startable') OR NOT (_r ? 'blocked_reason') THEN RAISE EXCEPTION 'the card lost its startable/blocked_reason'; END IF;
  _plan := public._recovery_session_plan_for(_uid, (_r->>'chapter_id')::uuid);
  SELECT COALESCE(sum((t.value->>'filled')::int), 0)::int INTO _sum FROM jsonb_each(_plan->'tiers') t;
  IF (_r->>'planned_size')::int <> _sum THEN
    RAISE EXCEPTION 'card says % questions, the plan holds %', _r->>'planned_size', _sum;
  END IF;
END
$proof$;

COMMIT;
