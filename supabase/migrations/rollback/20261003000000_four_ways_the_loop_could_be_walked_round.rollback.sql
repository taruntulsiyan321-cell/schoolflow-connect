-- ROLLBACK 20261003000000_four_ways_the_loop_could_be_walked_round — AND 20261004000000_the_resume_branch_could_not_read_its_own_row,
-- whose header says "Reverse: none. 20261003000000's rollback restores the pre-resume body". Written 2026-09-22; the
-- forward migration named this file but it was never written.
--
-- Both migrations edited live function bodies by exact text replacement. This reverses every one of those edits —
-- the same pairs, swapped, applied newest first — generated mechanically from the two forward files so no character
-- can drift. Each step refuses if its text is not there, so it will not run over a body a later migration changed:
-- roll back everything after 20261004000000 first (the rollbacks of 20261006000000 onward), newest first.
--
-- THIS RESTORES FOUR DEFECTS (20261003's header measured each):
--   B1  a revision "check" of one question passes and climbs the §5.3 ladder;
--   B2  a practice session from any time in the past can be handed in as today's check;
--   B3  a successful recovery leaves every mistake in the book open, so the chapter recovers for ever;
--   C2  tapping start twice opens a second recovery session and burns another round —
-- and, with 20261004's edit gone, the resume branch 20261003 added would fail on plpgsql's array INTO, but that branch
-- goes too.
--
-- NOT REVERSED: the mistakes B3 marked cleared since. They were cleared by a recovery that passed; reopening them would
-- invent failures nobody made.

DO $rev_rpc_start_recovery_session$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_start_recovery_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rollback: public.rpc_start_recovery_session is missing'; END IF;
  -- 20261004000000_the_resume_branch_could_not_read_its_own_row.sql, edit 3 of 3, reversed
  _new := replace(_def,
'  _ok     boolean;' || E'\n' ||
                        '  _r0 int; _r1 int; _r2 int; _r3 int;',
'  _ok     boolean;');
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_start_recovery_session does not carry edit 3 of 20261004000000_the_resume_branch_could_not_read_its_own_row.sql — is a later migration still applied?'; END IF;
  _def := _new;
  -- 20261004000000_the_resume_branch_could_not_read_its_own_row.sql, edit 2 of 3, reversed
  _new := replace(_def,
$new$    -- Scalars, not array subscripts: plpgsql's INTO cannot bind _tot[1].
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _r0, _r1, _r2, _r3, _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;
    _tot[1] := _r0; _tot[2] := _r1; _tot[3] := _r2; _tot[4] := _r3;$new$,
$old$    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _tot[1], _tot[2], _tot[3], _tot[4], _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;$old$);
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_start_recovery_session does not carry edit 2 of 20261004000000_the_resume_branch_could_not_read_its_own_row.sql — is a later migration still applied?'; END IF;
  _def := _new;
  -- 20261003000000_four_ways_the_loop_could_be_walked_round.sql, edit 1 of 3, reversed
  _new := replace(_def,
$new$  -- ONE OPEN SESSION PER CHAPTER. Tapping start twice used to open a second
  -- and a third, each taking the next `round` — and §4.6 reads `round` to
  -- decide when generation is exhausted, so three taps burned three rounds
  -- without a single question being answered. A session already open IS the
  -- answer to "start recovery", so it is handed back.
  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id AND rs.completed_at IS NULL
   ORDER BY rs.started_at DESC
   LIMIT 1;

  IF _rid IS NOT NULL THEN
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _tot[1], _tot[2], _tot[3], _tot[4], _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;
    RETURN jsonb_build_object(
      'started', true,
      'resumed', true,
      'session_id', _rid,
      'round', _round,
      'complete', COALESCE((_plan->>'complete')::boolean, false),
      'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
      'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
      'plan', _plan);
  END IF;

  -- The curriculum fence lives in the plan and raises there.
  _plan := public.rpc_recovery_session_plan(_chapter_id);$new$,
$old$  -- The curriculum fence lives in the plan and raises there.
  _plan := public.rpc_recovery_session_plan(_chapter_id);$old$);
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_start_recovery_session does not carry edit 1 of 20261003000000_four_ways_the_loop_could_be_walked_round.sql — is a later migration still applied?'; END IF;
  _def := _new;
  EXECUTE _def;
END
$rev_rpc_start_recovery_session$;

DO $rev_rpc_submit_recovery_session$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_submit_recovery_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rollback: public.rpc_submit_recovery_session is missing'; END IF;
  -- 20261003000000_four_ways_the_loop_could_be_walked_round.sql, edit 1 of 1, reversed
  _new := replace(_def,
$new$  IF _outcome = 'ready' THEN
    -- §4.5, which nothing implemented: "Those rows -> status = 'cleared',
    -- cleared_at set." Without it the chapter stays above
    -- RECOVERY_TRIGGER_COUNT after being recovered, so it is offered for
    -- recovery again immediately and for ever, and recovery_pending never
    -- falls. Measured before this: 6 open mistakes before a successful
    -- recovery, 6 after, chapter still listed as ready.
    --
    -- Only the chapter's OWN open rows, and only on a pass. §5.5 keeps
    -- previously cleared entries cleared; this is the other half of that
    -- sentence.
    UPDATE public.student_mistakes SET
      status = 'cleared', cleared_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id AND status = 'open';

    -- §5.1: recovery is what starts the revision clock.
    UPDATE public.chapter_state SET$new$,
$old$  IF _outcome = 'ready' THEN
    -- §5.1: recovery is what starts the revision clock.
    UPDATE public.chapter_state SET$old$);
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_submit_recovery_session does not carry edit 1 of 20261003000000_four_ways_the_loop_could_be_walked_round.sql — is a later migration still applied?'; END IF;
  _def := _new;
  EXECUTE _def;
END
$rev_rpc_submit_recovery_session$;

DO $rev_rpc_submit_revision_session$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_submit_revision_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rollback: public.rpc_submit_revision_session is missing'; END IF;
  -- 20261003000000_four_ways_the_loop_could_be_walked_round.sql, edit 3 of 3, reversed
  _new := replace(_def,
'  _next_at  timestamptz;' || E'\n' || '  _state    text;' || E'\n' ||
    '  _sat_at   timestamptz;' || E'\n' || '  _since    timestamptz;' || E'\n' ||
    '  _want     int;' || E'\n' || '  _available int;',
'  _next_at  timestamptz;' || E'\n' || '  _state    text;');
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_submit_revision_session does not carry edit 3 of 20261003000000_four_ways_the_loop_could_be_walked_round.sql — is a later migration still applied?'; END IF;
  _def := _new;
  -- 20261003000000_four_ways_the_loop_could_be_walked_round.sql, edit 2 of 3, reversed
  _new := replace(_def,
$new$  IF _total IS NULL OR _total = 0 THEN
    RAISE EXCEPTION 'that session answered no question in this chapter — a check with no questions is not a result';
  END IF;

  -- B1: A CHECK IS REVISION_COUNT QUESTIONS, NOT ONE.
  --
  -- §5.4 fixes the length at REVISION_COUNT (8). That was only ever passed to
  -- the client's loader, so a one-question sitting answered right scored
  -- 1/1 = 100% and advanced the ladder. The bar is the section's number, or
  -- everything the bank holds for this chapter when it holds fewer — a thin
  -- chapter must still be revisable, and saying so is better than a silent
  -- pass on a sample of one.
  _want := public._recovery_const('REVISION_COUNT')::int;
  SELECT count(*)::int INTO _available
    FROM public.question_bank qb
   WHERE qb.chapter_id = _chapter_id AND qb.is_active AND qb.is_approved;
  _want := LEAST(_want, GREATEST(_available, 1));

  IF _total < _want THEN
    RAISE EXCEPTION
      'a revision check needs % questions from this chapter; that sitting answered %',
      _want, _total;
  END IF;$new$,
$old$  IF _total IS NULL OR _total = 0 THEN
    RAISE EXCEPTION 'that session answered no question in this chapter — a check with no questions is not a result';
  END IF;$old$);
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_submit_revision_session does not carry edit 2 of 20261003000000_four_ways_the_loop_could_be_walked_round.sql — is a later migration still applied?'; END IF;
  _def := _new;
  -- 20261003000000_four_ways_the_loop_could_be_walked_round.sql, edit 1 of 3, reversed
  _new := replace(_def,
$new$  SELECT ps.created_at INTO _sat_at
    FROM public.practice_sessions ps
   WHERE ps.id = _practice_session_id AND ps.user_id = _uid;
  IF _sat_at IS NULL THEN
    RAISE EXCEPTION 'practice session not found';
  END IF;

  -- B2: THE SITTING MUST BE SINCE THE LAST TIME THIS CHAPTER WAS ASSESSED.
  --
  -- A session finished a year ago could be handed in as today's check and
  -- passed, so good work could be banked and spent on any future rung — the
  -- opposite of what spaced repetition measures. The bound is the moment this
  -- chapter was last assessed (recovered, or its previous check), never a
  -- clock: §5.3 says timing is a suggestion and is never enforced, so an
  -- early check is still allowed, a stale one is not.
  SELECT GREATEST(
           COALESCE(_cs.recovered_at, _cs.created_at),
           COALESCE((SELECT max(vs.completed_at) FROM public.revision_sessions vs
                      WHERE vs.user_id = _uid AND vs.chapter_id = _chapter_id), _cs.created_at),
           _cs.created_at)
    INTO _since;

  IF _sat_at < _since THEN
    RAISE EXCEPTION 'that sitting is older than this chapter''s last assessment — sit the check now';
  END IF;$new$,
$old$  IF NOT EXISTS (
    SELECT 1 FROM public.practice_sessions ps
     WHERE ps.id = _practice_session_id AND ps.user_id = _uid
  ) THEN
    RAISE EXCEPTION 'practice session not found';
  END IF;$old$);
  IF _new = _def THEN RAISE EXCEPTION 'rollback: rpc_submit_revision_session does not carry edit 1 of 20261003000000_four_ways_the_loop_could_be_walked_round.sql — is a later migration still applied?'; END IF;
  _def := _new;
  EXECUTE _def;
END
$rev_rpc_submit_revision_session$;

DO $check$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _d FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rpc_start_recovery_session';
  IF position('ONE OPEN SESSION PER CHAPTER' IN _d) > 0 OR position('_r0 int' IN _d) > 0 THEN
    RAISE EXCEPTION 'rollback: rpc_start_recovery_session still resumes an open session';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO _d FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rpc_submit_recovery_session';
  IF position('status = ''cleared'', cleared_at = now()' IN _d) > 0 THEN
    RAISE EXCEPTION 'rollback: rpc_submit_recovery_session still clears the mistakes';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO _d FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rpc_submit_revision_session';
  IF position('_sat_at' IN _d) > 0 OR position('a revision check needs % questions' IN _d) > 0 THEN
    RAISE EXCEPTION 'rollback: rpc_submit_revision_session still checks the sitting''s age or size';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version IN ('20261004000000_the_resume_branch_could_not_read_its_own_row',
                   '20261003000000_four_ways_the_loop_could_be_walked_round');
