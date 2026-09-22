-- ════════════════════════════════════════════════════════════════════════════
-- THE RECOVERY SESSION EXISTS BEFORE THE STUDENT GOES LOOKING FOR IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- Until now a recovery session came into being only when the student opened
-- the Recovery tab and pressed Start. Three things follow from that, and all
-- three are bad:
--
--   1. The tab had to BUILD the ladder while the student waited on it.
--   2. Tiers 1 and 2 are AI-written variants of the student's own wrong
--      questions (§4.2a). With nothing existing to aim at, there was no object
--      for generation to fill, and no moment at which it could sensibly run.
--      The bank holds ZERO variants; this is the structural reason.
--   3. The answer could change between two openings of the same tab, because
--      it was recomputed from scratch each time.
--
-- So the session is built when the practice session ENDS, for every chapter
-- that now has mistakes worth recovering. By the time the student reaches the
-- tab it is already there, and — once generation is wired — its missing rungs
-- have had the rest of the sitting to be written.
--
-- WHAT IT DOES NOT DO
--
-- It does not move the chapter to 'in_recovery'. A session that exists is not
-- a session that has been started, and marking the chapter as under way
-- because the app prepared something would tell the student they had begun
-- work they have not begun. rpc_start_recovery_session still owns that
-- transition, and now finds the session already waiting instead of building
-- one.
--
-- THE STALENESS PROBLEM, AND WHY THE PLAN IS REFRESHED AT START
--
-- Building early means the plan is built against the mistakes as they stood
-- then. Get three more wrong in that chapter tomorrow and yesterday's plan no
-- longer covers them — the exact "mistakes silently dropped" defect the
-- previous migration removed, reintroduced through the back door by timing.
--
-- So rpc_start_recovery_session REBUILDS a plan whose mistake set has moved,
-- and rewrites the stored tier totals with it. This is safe only because start
-- runs before the runner loads a single question; once answering begins the
-- plan is fixed, and scoring still joins answers to the ids the plan names.
--
-- ROLLBACK: supabase/migrations/rollback/20261009000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The curriculum fence, for a named student ───────────────────────────
-- _apply_chapter_state runs as a background step at the end of a session, not
-- as the student, so auth.uid() is not available to it. One implementation,
-- taking the user explicitly; the auth.uid() form delegates to it rather than
-- holding a second copy of the join.

CREATE OR REPLACE FUNCTION public._recovery_chapter_is_for(_uid uuid, _chapter_id uuid)
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
       AND st.user_id = _uid
  )
$fn$;

COMMENT ON FUNCTION public._recovery_chapter_is_for(uuid, uuid) IS
  'True when the named student''s section teaches the curriculum subject this chapter belongs to. The implementation; _recovery_chapter_is_mine is the auth.uid() form of it.';

CREATE OR REPLACE FUNCTION public._recovery_chapter_is_mine(_chapter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT public._recovery_chapter_is_for(auth.uid(), _chapter_id)
$fn$;


-- ── 2. The plan, for a named student ───────────────────────────────────────
-- Same split, same reason. rpc_recovery_session_plan becomes the auth.uid()
-- form; every line of the ladder logic lives once, in the _for variant.

CREATE OR REPLACE FUNCTION public._recovery_session_plan_for(_uid uuid, _chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  _n             int;
  _deep_max      int;
  _wide_max      int;
  _relearn_above int;
  _mode          text;
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

  IF NOT public._recovery_chapter_is_for(_uid, _chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id
      USING HINT = 'The curriculum filter is enforced here, in the query layer, not in the UI.';
  END IF;

  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _wide_max      := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_RELEARN_ABOVE')::int;
  _min_proc      := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc      := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND sm.question_id IS NOT NULL;

  IF _n = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'none', 'open_mistakes', 0,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        'nothing is open in this chapter — there is no mistake to build a session from');
  END IF;

  IF _n > _relearn_above THEN
    RETURN jsonb_build_object(
      'mode', 'relearn', 'open_mistakes', _n, 'relearn_above', _relearn_above,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
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

  FOR _m IN
    SELECT sm.question_id, sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open' AND sm.question_id IS NOT NULL
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id, 'difficulty', _m.difficulty, 'times_wrong', _m.times_wrong);
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
    'needed', _need, 'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'filled', _filled, 'shortfall', _short,
    'note', 'the student''s own wrong questions, all of them; nothing to generate'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        SELECT array_agg(t.qid) INTO _ids
          FROM (
            SELECT qid
              FROM public._recovery_variant_pool(
                     (_src.v->>'question_id')::uuid, _tier, _src.v->>'difficulty') AS pool(qid)
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
      'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
      'filled', _filled, 'shortfall', _short,
      'note', 'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  _need := _n * _per[4];
  _got  := ARRAY[]::uuid[];

  IF _need > 0 THEN
    SELECT array_agg(id) INTO _got
      FROM (
        SELECT qb.id FROM public.question_bank qb
         WHERE qb.chapter_id = _chapter_id
           AND qb.is_active
           AND qb.source_question_id IS NULL
           AND qb.replaced_by_question_id IS NULL
           AND NOT (qb.id = ANY (_used))
           AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                            WHERE sm.user_id = _uid AND sm.question_id = qb.id)
         ORDER BY qb.created_at LIMIT _need
      ) t;
    IF _got IS NOT NULL THEN _used := _used || _got; END IF;
  END IF;

  _filled := COALESCE(array_length(_got, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _conc_filled := _conc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
    'filled', _filled, 'shortfall', _short,
    'note', CASE WHEN _need = 0 THEN 'not asked for in wide mode'
                 ELSE 'bank where coverage allows; AI otherwise' END));

  _offerable := (_proc_filled >= _min_proc) AND (_conc_filled >= _min_conc);

  RETURN jsonb_build_object(
    'mode', _mode, 'open_mistakes', _n, 'sources', _sources, 'tiers', _tiers,
    'shortfall', _total_short, 'complete', (_total_short = 0),
    'procedural_filled', _proc_filled, 'conceptual_filled', _conc_filled,
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

COMMENT ON FUNCTION public._recovery_session_plan_for(uuid, uuid) IS
  'The recovery ladder for one chapter and one named student. The implementation; rpc_recovery_session_plan is the auth.uid() form, and _apply_chapter_state calls this one because a background step at the end of a session has no auth.uid().';

CREATE OR REPLACE FUNCTION public.rpc_recovery_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT public._recovery_session_plan_for(auth.uid(), _chapter_id)
$fn$;


-- ── 3. Build it at the end of the practice session ─────────────────────────

CREATE OR REPLACE FUNCTION public._ensure_recovery_session(
  _uid uuid, _student_id uuid, _school_id uuid, _chapter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _plan  jsonb;
  _round int;
  _rid   uuid;
  _tot   int[] := ARRAY[0,0,0,0];
  _i     int;
BEGIN
  -- Already one waiting or in progress: leave it. Building a second would take
  -- the next `round`, and §4.6 reads `round` to decide when generation is
  -- exhausted — so an unopened session created nightly would burn the
  -- student's three rounds without a question being asked.
  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
     AND rs.completed_at IS NULL AND rs.plan IS NOT NULL
   LIMIT 1;
  IF _rid IS NOT NULL THEN RETURN _rid; END IF;

  _plan := public._recovery_session_plan_for(_uid, _chapter_id);

  -- 'relearn' and 'none' build nothing, by design. So does a plan too thin to
  -- diagnose: §4.1a says a session that cannot be completed is NOT OFFERED
  -- rather than offered short, and nobody is waiting on this one, so there is
  -- no reason to degrade it.
  IF _plan->>'mode' IN ('relearn', 'none') THEN RETURN NULL; END IF;
  IF NOT (COALESCE((_plan->>'complete')::boolean, false)
          OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false)) THEN
    RETURN NULL;
  END IF;

  FOR _i IN 0..3 LOOP
    _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _student_id, _school_id, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;

  -- Deliberately NO chapter_state write. A session that exists is not a
  -- session that has been started, and marking the chapter 'in_recovery'
  -- because the app prepared something would tell the student they had begun
  -- work they have not begun. rpc_start_recovery_session owns that.
  RETURN _rid;
END;
$fn$;

COMMENT ON FUNCTION public._ensure_recovery_session(uuid, uuid, uuid, uuid) IS
  'Build the recovery session for one chapter if one is not already waiting, so it exists before the student opens the tab. Returns NULL when the plan says relearn, none, or too thin to diagnose. Never touches chapter_state.';


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
  _built         int := 0;
  _r             record;
  _rid           uuid;
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
  -- Chapters holding open mistakes, and the session each one needs
  ------------------------------------------------------------------
  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id
       AND sm.status = 'open'
       AND sm.chapter_id IS NOT NULL
       -- Matches the plan's filter: a mistake with no bank question id has no
       -- original to ladder off, and counting it here would build a session
       -- the plan then refuses.
       AND sm.question_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger_count
  LOOP
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id, 'has_mistakes')
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET state = CASE WHEN public.chapter_state.state IN ('untouched', 'has_mistakes')
                       THEN 'has_mistakes' ELSE public.chapter_state.state END,
          updated_at = now();
    _triggered := _triggered + 1;

    -- THE SESSION IS BUILT NOW, not when the student comes looking.
    --
    -- Wrapped because one chapter that cannot build a plan — a curriculum
    -- change, a retired question — must not lose the student their whole
    -- session finish. The state machine runs inside the finish path, and an
    -- exception here would take the XP, the streak and the attempt record
    -- with it.
    BEGIN
      _rid := public._ensure_recovery_session(
        _ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id);
      IF _rid IS NOT NULL THEN _built := _built + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not prepare recovery for chapter %: %', _r.chapter_id, SQLERRM;
    END;
  END LOOP;

  ------------------------------------------------------------------
  -- The revision clock: every chapter this session really worked in
  ------------------------------------------------------------------
  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id
       AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (
      user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id,
            'untouched', now() + (_interval_1 || ' days')::interval, 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET next_revision_at = now() + (_interval_1 || ' days')::interval,
          updated_at       = now();
    _scheduled := _scheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'chapters_at_trigger', _triggered,
    'chapters_scheduled', _scheduled,
    'recovery_sessions_prepared', _built);
END;
$fn$;


-- ── 4. Starting one now finds it, and refreshes it if it has gone stale ────

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
  _tot    int[] := ARRAY[0,0,0,0];
  _i      int;
  _ok     boolean;
  _mode   text;
  _stale  boolean := false;
  _now_n  int;
  _r0 int; _r1 int; _r2 int; _r3 int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'no student record for this user';
  END IF;

  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id AND rs.completed_at IS NULL
     AND rs.plan IS NOT NULL
   ORDER BY rs.started_at DESC
   LIMIT 1;

  IF _rid IS NOT NULL THEN
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _r0, _r1, _r2, _r3, _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;

    -- IS THE WAITING PLAN STILL ABOUT THE RIGHT MISTAKES?
    --
    -- Sessions are now prepared at the end of practice, so one can sit unopened
    -- while the student gets three more questions wrong in that chapter. A
    -- plan built against four mistakes and handed over when there are seven
    -- drops three of them — exactly the defect the per-mistake ladder removed,
    -- reintroduced by timing rather than by a cap.
    --
    -- Rebuilding is safe HERE and nowhere later: start runs before the runner
    -- loads a question, so nothing has been answered against the old ids yet.
    SELECT count(*)::int INTO _now_n
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open' AND sm.question_id IS NOT NULL;

    _stale := COALESCE((_plan->>'open_mistakes')::int, -1) <> _now_n;

    IF _stale THEN
      _plan := public._recovery_session_plan_for(_uid, _chapter_id);
      _mode := _plan->>'mode';

      IF _mode IN ('relearn', 'none') THEN
        -- The chapter has moved out of drilling range since this was prepared.
        -- The waiting session is deleted rather than handed over: it is a
        -- session nobody should sit, and leaving it would have the resume
        -- branch offer it again on every future visit.
        DELETE FROM public.recovery_sessions WHERE id = _rid;
        RETURN jsonb_build_object(
          'started', false, 'mode', _mode,
          'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
          'reason', _plan->>'not_offerable_reason', 'plan', _plan);
      END IF;

      FOR _i IN 0..3 LOOP
        _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
      END LOOP;

      -- The totals are rewritten with the plan. Leaving them would score the
      -- student out of a denominator from the old ladder.
      UPDATE public.recovery_sessions SET
        plan = _plan,
        tier0_total = _tot[1], tier1_total = _tot[2],
        tier2_total = _tot[3], tier3_total = _tot[4]
      WHERE id = _rid;
      _r0 := _tot[1]; _r1 := _tot[2]; _r2 := _tot[3]; _r3 := _tot[4];
    END IF;

    _tot[1] := _r0; _tot[2] := _r1; _tot[3] := _r2; _tot[4] := _r3;

    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
    VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET state = 'in_recovery', updated_at = now();

    RETURN jsonb_build_object(
      'started', true,
      'resumed', true,
      'refreshed', _stale,
      'session_id', _rid,
      'round', _round,
      'mode', COALESCE(_plan->>'mode', 'deep'),
      'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
      'complete', COALESCE((_plan->>'complete')::boolean, false),
      'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
      'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
      'plan', _plan);
  END IF;

  -- Nothing waiting: build it here. Reached when the chapter crossed the
  -- trigger through a path that does not end a practice session — a battle, a
  -- test — or for a session prepared before this migration existed.
  _plan := public._recovery_session_plan_for(_uid, _chapter_id);
  _mode := _plan->>'mode';

  IF _mode = 'relearn' OR _mode = 'none' THEN
    RETURN jsonb_build_object(
      'started', false, 'mode', _mode,
      'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
      'reason', _plan->>'not_offerable_reason', 'plan', _plan);
  END IF;

  _ok := COALESCE((_plan->>'complete')::boolean, false)
      OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);

  IF NOT _ok THEN
    RETURN jsonb_build_object(
      'started', false, 'mode', _mode,
      'reason', COALESCE(_plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  FOR _i IN 0..3 LOOP
    _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _sid, _school, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;

  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
  VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
  ON CONFLICT (user_id, chapter_id) DO UPDATE
    SET state = 'in_recovery', updated_at = now();

  RETURN jsonb_build_object(
    'started', true, 'session_id', _rid, 'round', _round, 'mode', _mode,
    'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
    'complete', COALESCE((_plan->>'complete')::boolean, false),
    'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
    'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
    'plan', _plan);
END;
$fn$;

COMMIT;
