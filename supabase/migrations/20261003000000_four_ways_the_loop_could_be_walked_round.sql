-- ═══════════════════════════════════════════════════════════════════════════
-- Four ways the loop could be walked round
--
-- Found by attacking the engine as a real student under RLS, after the scores
-- were made evidence-based. Each was measured, not reasoned about.
--
--   B1  a revision "check" of ONE question, answered right, passed and
--       advanced the §5.3 ladder. REVISION_COUNT = 8 is what the client asks
--       the loader for; the server accepted any sitting with a single answer
--       in the chapter.
--
--   B2  a practice session finished A YEAR AGO was handed in as today's
--       check and passed. Good work could be banked and spent on any future
--       rung, which is the opposite of what spaced repetition measures.
--
--   B3  a successful recovery left every mistake in the book OPEN. §4.5 is
--       explicit — "those rows -> status = 'cleared', cleared_at set" — and
--       nothing did it. Measured: 6 open before, 6 open after, and the
--       chapter still offered as ready. The chapter can be "recovered" over
--       and over for ever, and recovery_pending never falls, so the badge
--       never goes out.
--
--   C2  tapping start twice opened a second and third unfinished recovery
--       session for the same chapter, inflating `round` — which §4.6 uses to
--       decide when generation is exhausted. Three taps burn three rounds.
--
-- Cross-user evidence and tier overlap were attacked too and held: a sitting
-- belonging to another student is "practice session not found", and no
-- question appears in two tiers of one plan.
--
-- Reverse: supabase/migrations/rollback/20261003000000_four_ways_the_loop_could_be_walked_round.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $precheck$
DECLARE _want jsonb := jsonb_build_object(
  'rpc_start_recovery_session',  'c6a2bd3cf9bcec9dd1c385d3a67d04f1',
  'rpc_submit_recovery_session', 'bd574ea6ad57f430a0042eaa8d14d470',
  'rpc_submit_revision_session', '6bc7a177f99b1d4772c4d479fd0bef20');
  _name text; _md5 text; _got text;
BEGIN
  FOR _name, _md5 IN SELECT * FROM jsonb_each_text(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f' AND p.proname=_name;
    IF _got IS DISTINCT FROM _md5 THEN
      RAISE EXCEPTION 'precheck: public.% is not the body this was written against (live %)', _name, _got;
    END IF;
  END LOOP;
END
$precheck$;

-- ── C2. One open recovery session per chapter ───────────────────────────────
DO $c2$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='rpc_start_recovery_session';
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$  -- The curriculum fence lives in the plan and raises there.
  _plan := public.rpc_recovery_session_plan(_chapter_id);$old$,
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
  _plan := public.rpc_recovery_session_plan(_chapter_id);$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the plan call in rpc_start_recovery_session'; END IF;
  EXECUTE _new;
END
$c2$;

-- ── B3. §4.5 — clearing a chapter clears its mistakes ───────────────────────
DO $b3$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='rpc_submit_recovery_session';
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$  IF _outcome = 'ready' THEN
    -- §5.1: recovery is what starts the revision clock.
    UPDATE public.chapter_state SET$old$,
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
    UPDATE public.chapter_state SET$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the ready branch in rpc_submit_recovery_session'; END IF;
  EXECUTE _new;
END
$b3$;

-- ── B1 + B2. A check must be a real sitting, and a recent one ───────────────
DO $b12$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='rpc_submit_revision_session';
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$  IF NOT EXISTS (
    SELECT 1 FROM public.practice_sessions ps
     WHERE ps.id = _practice_session_id AND ps.user_id = _uid
  ) THEN
    RAISE EXCEPTION 'practice session not found';
  END IF;$old$,
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
  END IF;$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the practice-session guard'; END IF;
  _def := _new;

  _new := replace(_def,
$old$  IF _total IS NULL OR _total = 0 THEN
    RAISE EXCEPTION 'that session answered no question in this chapter — a check with no questions is not a result';
  END IF;$old$,
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
  END IF;$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the zero-question guard'; END IF;
  _def := _new;

  _new := replace(_def,
    '  _next_at  timestamptz;' || E'\n' || '  _state    text;',
    '  _next_at  timestamptz;' || E'\n' || '  _state    text;' || E'\n' ||
    '  _sat_at   timestamptz;' || E'\n' || '  _since    timestamptz;' || E'\n' ||
    '  _want     int;' || E'\n' || '  _available int;');
  IF _new = _def THEN RAISE EXCEPTION 'could not find the declarations'; END IF;

  EXECUTE _new;
END
$b12$;

COMMIT;
