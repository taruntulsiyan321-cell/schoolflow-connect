-- ════════════════════════════════════════════════════════════════════════════
-- THE RECOVERY SESSION IS SIZED BY THE MISTAKES, NOT BY A FIXED TEN
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE DEFECT
--
-- The ladder was a fixed 2/3/3/2. Tier 0 — "the exact questions they got
-- wrong" — was capped at TWO. Measured on production 2026-09-15, every open
-- mistake grouped by student and chapter:
--
--     1 mistake  5 students        2 mistakes  3 students        6 mistakes  1
--
-- For the student with six, FOUR of his mistakes never entered the session.
-- Not deferred, not queued, not shown later — dropped. Nothing downstream ever
-- brought them back, and `rpc_submit_recovery_session` would then declare the
-- chapter recovered on the strength of the two that made it in.
--
-- And in the other direction: the student with one mistake received ten
-- questions, eight of which were about nothing he had got wrong.
--
-- A fixed session size cannot be right for both, and a cap on tier 0 is the
-- one cap that silently discards the student's own evidence.
--
-- THE REWRITE
--
-- The ladder is per mistake, and the session is as long as the mistakes
-- require. Three modes, chosen by how many open mistakes the chapter holds:
--
--   DEEP    (<= RECOVERY_DEEP_MAX_MISTAKES, i.e. 1-2)
--           every mistake gets all four rungs. 4 or 8 questions.
--   WIDE    (up to RECOVERY_WIDE_MAX_MISTAKES, i.e. 3-8)
--           every mistake gets tiers 0, 1 and 2. 9 to 24 questions.
--           Tier 3 is dropped: a student with six open mistakes in one chapter
--           is not yet at the "does it transfer to a new application" question.
--   RELEARN (above RECOVERY_RELEARN_ABOVE, i.e. 9+)
--           NOT OFFERED. Nine or more mistakes in one chapter does not mean
--           twenty-seven variant questions are owed; it means the chapter was
--           not learned. Drilling there is punishment, and it is where a
--           student stops opening the app. The plan says so explicitly rather
--           than returning an empty session.
--
-- THERE IS DELIBERATELY NO CAP ON THE TOTAL. A cap is precisely how mistakes
-- got dropped before, and re-introducing one under another name would
-- re-introduce the defect this migration exists to remove.
--
-- WHAT STILL HOLDS
--   * §4.2b's two rates, never blended. WIDE keeps one tier-2 question per
--     mistake for exactly this reason: at three mistakes that is a
--     three-question conceptual rate, above RECOVERY_MIN_CONCEPTUAL_TO_OFFER.
--     An earlier draft used "the original plus one alternating variant", which
--     is shorter and yields a conceptual rate computed from ONE question.
--   * Bank-first (§4.2a). _recovery_variant_pool is unchanged and is still
--     asked before anything is considered short.
--   * The curriculum fence, in the query layer, raising rather than filtering.
--
-- The four RECOVERY_TIER0..3 constants are removed at the end — this is the
-- last reader of them, and _recovery_const raises on a missing key, so they
-- could not be removed before now.
--
-- ROLLBACK: supabase/migrations/rollback/20261007000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The plan ────────────────────────────────────────────────────────────

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

COMMENT ON FUNCTION public.rpc_recovery_session_plan(uuid) IS
  'The recovery ladder for one chapter, sized BY THE STUDENT''S MISTAKES. Deep (<=2 mistakes) gives every mistake all four rungs; wide (3-8) gives every mistake tiers 0-2; above RECOVERY_RELEARN_ABOVE it returns mode=relearn and refuses to drill. Tier 0 carries EVERY open mistake — the fixed cap of two silently discarded four of six for the one student who had six.';


-- ── 2. Starting a session ──────────────────────────────────────────────────
-- Rewritten only where the plan's shape changed: the tier totals are read from
-- what each tier FILLED (unchanged), and mode='relearn' is refused with its
-- own reason rather than falling through the generic "not enough material".

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


-- ── 3. The queue the Recovery tab reads ────────────────────────────────────
-- 'ready' stops being a threshold comparison the screen could get wrong and
-- becomes the mode the plan would choose, so the tab can distinguish "there is
-- a session here" from "this chapter needs relearning, not drilling".

CREATE OR REPLACE FUNCTION public.rpc_student_recovery_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid           uuid := auth.uid();
  _trigger       int;
  _deep_max      int;
  _relearn_above int;
  _out           jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  _trigger       := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_RELEARN_ABOVE')::int;

  SELECT COALESCE(
           jsonb_agg(row ORDER BY (row->>'ready')::boolean DESC,
                                  (row->>'open_mistakes')::int DESC),
           '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id',     m.chapter_id,
               'chapter',        c.name,
               'subject',        sub.name,
               'open_mistakes',  m.open_mistakes,
               'trigger_count',  _trigger,
               -- The one place these comparisons are made. A screen redoing
               -- them would need its own copy of three constants.
               'ready',          (m.open_mistakes >= _trigger
                                  AND m.open_mistakes <= _relearn_above),
               'mode',           CASE
                                   WHEN m.open_mistakes > _relearn_above THEN 'relearn'
                                   WHEN m.open_mistakes < _trigger       THEN 'none'
                                   WHEN m.open_mistakes <= _deep_max     THEN 'deep'
                                   ELSE 'wide' END,
               -- What the session will actually be, so the tab can say "12
               -- questions" instead of a fixed ten that stopped being true.
               'planned_size',   CASE
                                   WHEN m.open_mistakes > _relearn_above THEN 0
                                   WHEN m.open_mistakes <= _deep_max
                                     THEN m.open_mistakes * (
                                       public._recovery_const('RECOVERY_DEEP_TIER0')::int
                                     + public._recovery_const('RECOVERY_DEEP_TIER1')::int
                                     + public._recovery_const('RECOVERY_DEEP_TIER2')::int
                                     + public._recovery_const('RECOVERY_DEEP_TIER3')::int)
                                   ELSE m.open_mistakes * (
                                       public._recovery_const('RECOVERY_WIDE_TIER0')::int
                                     + public._recovery_const('RECOVERY_WIDE_TIER1')::int
                                     + public._recovery_const('RECOVERY_WIDE_TIER2')::int
                                     + public._recovery_const('RECOVERY_WIDE_TIER3')::int)
                                 END,
               'relearn_above',  _relearn_above,
               'state',          COALESCE(cs.state, 'has_mistakes'),
               'in_recovery',    (cs.state = 'in_recovery'),
               'last_recovery_readiness', cs.last_recovery_readiness,
               'recovered_at',   cs.recovered_at,
               'rounds_taken',   COALESCE(rs.rounds, 0)
             ) AS row
        FROM (
          SELECT sm.chapter_id, count(*)::int AS open_mistakes
            FROM public.student_mistakes sm
           WHERE sm.user_id = _uid
             AND sm.status = 'open'
             AND sm.chapter_id IS NOT NULL
             -- Matches the plan's own filter. A chapter listed here whose
             -- mistakes all lack a question_id would offer a session the plan
             -- then refuses to build.
             AND sm.question_id IS NOT NULL
           GROUP BY sm.chapter_id
        ) m
        LEFT JOIN public.chapters c ON c.id = m.chapter_id
        LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
        LEFT JOIN public.chapter_state cs
               ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
        LEFT JOIN (
          SELECT chapter_id, count(*)::int AS rounds
            FROM public.recovery_sessions
           WHERE user_id = _uid
           GROUP BY chapter_id
        ) rs ON rs.chapter_id = m.chapter_id
    ) t;

  RETURN _out;
END;
$fn$;


-- ── 4. The four constants this was the last reader of ──────────────────────

DELETE FROM public.recovery_constants
 WHERE key IN ('RECOVERY_TIER0', 'RECOVERY_TIER1', 'RECOVERY_TIER2', 'RECOVERY_TIER3');

DO $check$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.recovery_constants
   WHERE key LIKE 'RECOVERY_TIER%';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'the old fixed-ladder constants are still present (% rows)', _n;
  END IF;

  -- Nothing may still be reading them. A function that does would raise at run
  -- time, for one student, on one chapter, long after this migration.
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%RECOVERY_TIER0%';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'RECOVERY_TIER0 is still read by % function(s) but no longer exists', _n;
  END IF;
END $check$;

COMMIT;
