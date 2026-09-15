-- Rollback for 20261009000000_recovery_is_waiting_when_the_session_ends.sql
--
-- Puts the loop back to "the session is built when the student presses Start".
--
-- What this re-introduces, stated plainly because it is not a neutral undo:
--   * The Recovery tab builds the ladder while the student waits on it.
--   * There is no object for variant generation to aim at, so tiers 1 and 2
--     have no moment at which they could sensibly be written.
--   * The plan is recomputed on each opening, so the same tab can give
--     different answers.
--
-- recovery_sessions rows the forward migration prepared are NOT deleted. An
-- unopened prepared session is a valid row under the restored code too — the
-- restored rpc_start_recovery_session resumes it exactly as it resumes any
-- other open session. Deleting them would discard work the student may be
-- about to do.
--
-- The three function bodies below are the ones 20261006000000 and
-- 20261007000000 installed, restored verbatim.

BEGIN;

-- _recovery_chapter_is_mine goes back to holding the join itself.
CREATE OR REPLACE FUNCTION public._recovery_chapter_is_mine(_chapter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = auth.uid()
  )
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_recovery_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid           uuid := auth.uid();
  _n             int;
  _deep_max      int;
  _wide_max      int;
  _relearn_above int;
  _mode          text;
  -- Indexed by tier + 1, because plpgsql arrays are 1-based and the tiers are
  -- 0-based. Every read of this array pays that +1 explicitly.
  _per           int[] := ARRAY[0, 0, 0, 0];
  _sources       jsonb := '[]'::jsonb;
  _tiers         jsonb := '{}'::jsonb;
  _used          uuid[] := ARRAY[]::uuid[];
  _m             record;
  _src           record;
  _tier          smallint;
  _need          int;
  _got           uuid[];
  _ids           uuid[];
  _short         int;
  _total_short   int := 0;
  _proc_filled   int := 0;
  _conc_filled   int := 0;
  _min_proc      int;
  _min_conc      int;
  _filled        int;
  _offerable     boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id
      USING HINT = 'The curriculum filter is enforced here, in the query layer, not in the UI.';
  END IF;

  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _wide_max      := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_RELEARN_ABOVE')::int;
  _min_proc      := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc      := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  -- ── How many mistakes are we recovering? ────────────────────────────────
  -- question_id NOT NULL is required, not preferred: tier 0 IS the original
  -- question, and a mistake that does not name one cannot be laddered off.
  -- 480 rows in this table are a 2026-08-28 backfill from the retired
  -- question_records with no question_id and no chapter_id; they are invisible
  -- here for that reason, and that is correct rather than a gap to paper over.
  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND sm.question_id IS NOT NULL;

  IF _n = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'none',
      'open_mistakes', 0,
      'sources', '[]'::jsonb,
      'tiers', '{}'::jsonb,
      'shortfall', 0,
      'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        'nothing is open in this chapter — there is no mistake to build a session from');
  END IF;

  IF _n > _relearn_above THEN
    -- A refusal to DRILL, and never a silent one. The count and the threshold
    -- both travel with it so the screen can say what the app concluded.
    RETURN jsonb_build_object(
      'mode', 'relearn',
      'open_mistakes', _n,
      'relearn_above', _relearn_above,
      'sources', '[]'::jsonb,
      'tiers', '{}'::jsonb,
      'shortfall', 0,
      'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        format('%s open mistakes in one chapter is not a set of slips to drill away. '
               'Practising %s variant questions would not teach the chapter. '
               'Work through the material again first.', _n, _n * 3));
  END IF;

  IF _n <= _deep_max THEN
    _mode := 'deep';
    _per := ARRAY[
      public._recovery_const('RECOVERY_DEEP_TIER0')::int,
      public._recovery_const('RECOVERY_DEEP_TIER1')::int,
      public._recovery_const('RECOVERY_DEEP_TIER2')::int,
      public._recovery_const('RECOVERY_DEEP_TIER3')::int];
  ELSE
    _mode := 'wide';
    _per := ARRAY[
      public._recovery_const('RECOVERY_WIDE_TIER0')::int,
      public._recovery_const('RECOVERY_WIDE_TIER1')::int,
      public._recovery_const('RECOVERY_WIDE_TIER2')::int,
      public._recovery_const('RECOVERY_WIDE_TIER3')::int];
  END IF;

  -- ── Tier 0: EVERY mistake, not the first two ───────────────────────────
  -- Most-repeated first (§6.3 pins those to the top), but the ordering is now
  -- presentation only: nothing is cut off the end.
  FOR _m IN
    SELECT sm.question_id, sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND sm.question_id IS NOT NULL
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id,
      'difficulty',  _m.difficulty,
      'times_wrong', _m.times_wrong);
    IF _per[1] > 0 AND NOT (_m.question_id = ANY (_used)) THEN
      _used := _used || _m.question_id;
    END IF;
  END LOOP;

  _need   := _n * _per[1];
  _filled := COALESCE(array_length(_used, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _proc_filled := _proc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed',    _need,
    'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'filled',    _filled,
    'shortfall', _short,
    'note',      'the student''s own wrong questions, all of them; nothing to generate'));

  -- ── Tiers 1 and 2: bank variants, per mistake ──────────────────────────
  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        -- Per MISTAKE, not per session: the budget belongs to the mistake, so
        -- one well-covered question cannot eat the allowance of the next.
        SELECT array_agg(t.qid) INTO _ids
          FROM (
            SELECT qid
              FROM public._recovery_variant_pool(
                     (_src.v->>'question_id')::uuid, _tier, _src.v->>'difficulty') AS pool(qid)
             -- Global dedup, not per tier. A question serving two tiers at
             -- once would be scored into both rates from one answer.
             WHERE NOT (qid = ANY (_used))
             LIMIT _per[_tier + 1]
          ) t;
        IF _ids IS NOT NULL THEN
          _got  := _got || _ids;
          _used := _used || _ids;
        END IF;
      END LOOP;
    END IF;

    _filled := COALESCE(array_length(_got, 1), 0);
    _short  := greatest(0, _need - _filled);
    _total_short := _total_short + _short;
    IF _tier = 1 THEN _proc_filled := _proc_filled + _filled;
                 ELSE _conc_filled := _conc_filled + _filled; END IF;

    _tiers := jsonb_set(_tiers, ARRAY[_tier::text], jsonb_build_object(
      'needed',    _need,
      'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
      'filled',    _filled,
      'shortfall', _short,
      'note',      'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  -- ── Tier 3: the bank, where coverage allows ────────────────────────────
  -- Chapter-level rather than per-source, because a FAR application is by
  -- definition not tied to the question it moved away from. Originals only —
  -- a variant of their own wrong question is not a different application —
  -- and never a question they have already got wrong, which would be tier 0
  -- wearing a different label.
  _need := _n * _per[4];
  _got  := ARRAY[]::uuid[];

  IF _need > 0 THEN
    SELECT array_agg(id) INTO _got
      FROM (
        SELECT qb.id
          FROM public.question_bank qb
         WHERE qb.chapter_id = _chapter_id
           AND qb.is_active
           AND qb.source_question_id IS NULL
           AND qb.replaced_by_question_id IS NULL
           AND NOT (qb.id = ANY (_used))
           AND NOT EXISTS (
             SELECT 1 FROM public.student_mistakes sm
              WHERE sm.user_id = _uid AND sm.question_id = qb.id)
         ORDER BY qb.created_at
         LIMIT _need
      ) t;
    IF _got IS NOT NULL THEN _used := _used || _got; END IF;
  END IF;

  _filled := COALESCE(array_length(_got, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _conc_filled := _conc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed',    _need,
    'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
    'filled',    _filled,
    'shortfall', _short,
    'note',      CASE WHEN _need = 0
                      THEN 'not asked for in wide mode'
                      ELSE 'bank where coverage allows; AI otherwise' END));

  -- ── Is it offerable? ───────────────────────────────────────────────────
  -- The floors are per RATE, never on the total (§4.2b). A session of nine
  -- procedural questions and no conceptual ones clears any total-based floor
  -- and still cannot say WHICH half failed, which is the single-number failure
  -- the two rates exist to prevent.
  _offerable := (_proc_filled >= _min_proc) AND (_conc_filled >= _min_conc);

  RETURN jsonb_build_object(
    'mode',          _mode,
    'open_mistakes', _n,
    'sources',       _sources,
    'tiers',         _tiers,
    'shortfall',     _total_short,
    'complete',      (_total_short = 0),
    'procedural_filled',  _proc_filled,
    'conceptual_filled',  _conc_filled,
    'offerable_if_generation_exhausted', _offerable,
    'not_offerable_reason',
      CASE WHEN _offerable THEN NULL
           WHEN _conc_filled < _min_conc AND _proc_filled < _min_proc THEN
             'the bank holds neither enough procedural nor enough conceptual material for this chapter yet'
           WHEN _conc_filled < _min_conc THEN
             'no conceptual questions exist for these mistakes yet, so the session could not tell you whether you understand it or merely remember the steps'
           ELSE
             'not enough procedural questions exist for these mistakes yet'
      END);
END;
$fn$;


CREATE OR REPLACE FUNCTION public.rpc_start_recovery_session(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid    uuid := auth.uid();
  _sid    uuid;
  _school uuid;
  _plan   jsonb;
  _round  int;
  _rid    uuid;
  _t      jsonb;
  _tot    int[] := ARRAY[0,0,0,0];
  _i      int;
  _ok     boolean;
  _mode   text;
  _r0 int; _r1 int; _r2 int; _r3 int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'no student record for this user';
  END IF;

  -- ONE OPEN SESSION PER CHAPTER. Tapping start twice used to open a second
  -- and a third, each taking the next `round`, and §4.6 reads `round` to
  -- decide when generation is exhausted. A session already open IS the answer
  -- to "start recovery", so it is handed back. Only a session that can still
  -- be SCORED is worth resuming, hence plan IS NOT NULL.
  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id AND rs.completed_at IS NULL
     AND rs.plan IS NOT NULL
   ORDER BY rs.started_at DESC
   LIMIT 1;

  IF _rid IS NOT NULL THEN
    -- Scalars, not array subscripts: plpgsql's INTO cannot bind _tot[1].
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _r0, _r1, _r2, _r3, _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;
    _tot[1] := _r0; _tot[2] := _r1; _tot[3] := _r2; _tot[4] := _r3;
    RETURN jsonb_build_object(
      'started', true,
      'resumed', true,
      'session_id', _rid,
      'round', _round,
      'mode', COALESCE(_plan->>'mode', 'deep'),
      'complete', COALESCE((_plan->>'complete')::boolean, false),
      'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
      'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
      'plan', _plan);
  END IF;

  -- The curriculum fence lives in the plan and raises there.
  _plan := public.rpc_recovery_session_plan(_chapter_id);
  _mode := _plan->>'mode';

  -- 'relearn' is a real answer, not a failure to build one. It is returned
  -- with its own mode so the screen can say what was concluded instead of
  -- showing the generic "not enough material", which would be a lie: there is
  -- plenty of material, and drilling it is the wrong response.
  IF _mode = 'relearn' OR _mode = 'none' THEN
    RETURN jsonb_build_object(
      'started', false,
      'mode', _mode,
      'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
      'reason', _plan->>'not_offerable_reason',
      'plan', _plan);
  END IF;

  _ok := COALESCE((_plan->>'complete')::boolean, false)
      OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);

  IF NOT _ok THEN
    RETURN jsonb_build_object(
      'started', false,
      'mode', _mode,
      'reason', COALESCE(
        _plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  -- Tier totals are what the plan FILLED, not what it needed. A session that
  -- came up short is scored out of what was asked, never out of the target —
  -- scoring against questions that were never put in front of the student
  -- reports a false not_ready.
  FOR _i IN 0..3 LOOP
    _t := _plan->'tiers'->(_i::text);
    _tot[_i + 1] := COALESCE((_t->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan
  ) VALUES (
    _uid, _sid, _school, _chapter_id, _round,
    _tot[1], _tot[2], _tot[3], _tot[4], _plan
  ) RETURNING id INTO _rid;

  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
  VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
  ON CONFLICT (user_id, chapter_id) DO UPDATE
    SET state = 'in_recovery', updated_at = now();

  RETURN jsonb_build_object(
    'started', true,
    'session_id', _rid,
    'round', _round,
    'mode', _mode,
    'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
    'complete', COALESCE((_plan->>'complete')::boolean, false),
    'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
    'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
    'plan', _plan);
END;
$fn$;



CREATE OR REPLACE FUNCTION public._apply_chapter_state(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _ps            record;
  _trigger_count int;
  _engage_min    int;
  _interval_1    int;
  _triggered     int := 0;
  _scheduled     int := 0;
  _r             record;
BEGIN
  SELECT * INTO _ps FROM public.practice_sessions WHERE id = _session_id;
  IF _ps IS NULL THEN RETURN jsonb_build_object('error', 'no such session'); END IF;

  _trigger_count := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _engage_min    := public._recovery_const('REVISION_ENGAGEMENT_MIN')::int;
  _interval_1    := public._revision_interval_days(1);

  IF _trigger_count IS NULL OR _engage_min IS NULL OR _interval_1 IS NULL THEN
    RAISE EXCEPTION 'recovery constants missing — refusing to run the state machine on defaults';
  END IF;

  ------------------------------------------------------------------
  -- The trigger: chapters that now have >= RECOVERY_TRIGGER_COUNT open
  -- mistakes. At one, that is any chapter with an open mistake.
  ------------------------------------------------------------------
  -- Counted over the whole mistake book for the chapter, not just this
  -- session: a mistake made two sessions ago is still open and still the
  -- student's. The trigger is a level, not an event.
  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id
       AND sm.status = 'open'
       AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger_count
  LOOP
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id, 'has_mistakes')
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      -- A chapter already being worked on is not dragged backwards. Recovery
      -- and revision own their own transitions.
      SET state = CASE WHEN public.chapter_state.state IN ('untouched', 'has_mistakes')
                       THEN 'has_mistakes' ELSE public.chapter_state.state END,
          updated_at = now();
    _triggered := _triggered + 1;
  END LOOP;

  ------------------------------------------------------------------
  -- The clock: every chapter this session really worked in.
  ------------------------------------------------------------------
  -- NOT gated on recovery, on mistakes, or on the chapter's state. A student
  -- who practised a chapter and got everything right is exactly the student
  -- whose revision matters, and under the previous design he was the one who
  -- never got one.
  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id
       AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (
      user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (
      _ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id,
      -- 'untouched' is the honest state for a chapter whose only claim on the
      -- engine is that it was practised. The old body wrote 'has_mistakes'
      -- here, which labelled a student who scored 20/20 as having mistakes.
      'untouched',
      now() + (_interval_1 || ' days')::interval, 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      -- §5.2: re-engaging RESETS the clock — a student actively working on
      -- something does not need reminding to revise it. So the DATE moves.
      --
      -- The STAGE does not. The old body reset revision_stage to 1 here,
      -- which meant a student who kept practising a chapter could never reach
      -- solid: every visit threw away checks they had already passed. A pass
      -- is earned; practising afterwards does not un-earn it.
      SET next_revision_at = now() + (_interval_1 || ' days')::interval,
          updated_at       = now();
    _scheduled := _scheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'chapters_at_trigger', _triggered,
    'chapters_scheduled', _scheduled
  );
END;
$fn$;


-- Dropped last: the restored bodies above no longer reference them, and
-- dropping first would have failed on the dependency.
DROP FUNCTION IF EXISTS public._ensure_recovery_session(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._recovery_session_plan_for(uuid, uuid);
DROP FUNCTION IF EXISTS public._recovery_chapter_is_for(uuid, uuid);

COMMIT;
