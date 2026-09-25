-- ===========================================================================
-- RECOVERY PLAN SERVES UPLOAD ORIGINALS (tier 0)
--
-- Binding: docs/custom-practice-upload-spec.md §9 / §9.1
-- Depends on: 20261070000000 (student_mistakes.upload_question_id)
--
-- Measured defect (2026-09-24, after 700):
--   700 added upload_question_id and rewrote the plan on disk, but live
--   _recovery_session_plan_for / _apply_chapter_state /
--   rpc_student_recovery_queue / rpc_start_recovery_session still require
--   question_id IS NOT NULL and treat it as question_bank.id. Upload mistakes
--   never enter the ladder; shoving an upload UUID into a bank lookup would
--   silently miss and leave a hollow tier 0.
--
-- Fix:
--   1. Count open mistakes with chapter_id AND
--      (question_id IS NOT NULL OR upload_question_id IS NOT NULL)
--   2. Tier 0: bank ids → from_bank; upload ids → from_upload only when a
--      student_upload_questions row exists for that owner (served, counted
--      in filled). Never put upload UUIDs into from_bank / variant_pool /
--      question_bank lookups.
--   3. Align trigger queue + start-session stale count with the same filter.
--
-- ROLLBACK: rollback/20261071000000_recovery_plan_serves_upload_originals.rollback.sql
-- ===========================================================================

BEGIN;

-- Guard: 700's column must exist.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'student_mistakes'
       AND column_name = 'upload_question_id'
  ) THEN
    RAISE EXCEPTION
      '20261071000000 requires student_mistakes.upload_question_id (apply 700 first)';
  END IF;
END $guard$;

-- ── 1. The plan ─────────────────────────────────────────────────────────────
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
  _used_upload   uuid[] := ARRAY[]::uuid[];
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
  _qid_text      text;
  _up_ok         boolean;
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
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _min_proc      := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc      := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  -- Bank OR private upload original. Legacy text-only rows (both null) stay out.
  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL);

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
    SELECT sm.question_id, sm.upload_question_id, sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL)
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id,
      'upload_question_id', _m.upload_question_id,
      'difficulty', _m.difficulty,
      'times_wrong', _m.times_wrong);

    IF _per[1] <= 0 THEN
      CONTINUE;
    END IF;

    IF _m.question_id IS NOT NULL AND NOT (_m.question_id = ANY (_used)) THEN
      -- Bank original only — never an upload UUID.
      _used := _used || _m.question_id;
    ELSIF _m.upload_question_id IS NOT NULL
          AND NOT (_m.upload_question_id = ANY (_used_upload)) THEN
      -- Tier 0 serves the private upload row when it still belongs to this student.
      SELECT EXISTS (
        SELECT 1 FROM public.student_upload_questions uq
         WHERE uq.id = _m.upload_question_id
           AND uq.owner_id = _uid
      ) INTO _up_ok;
      IF _up_ok THEN
        _used_upload := _used_upload || _m.upload_question_id;
      END IF;
    END IF;
  END LOOP;

  _need := _n * _per[1];
  -- Both bank and served upload originals count as filled tier 0.
  _filled := COALESCE(array_length(_used, 1), 0)
           + COALESCE(array_length(_used_upload, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _proc_filled := _proc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed', _need,
    'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'from_upload', to_jsonb(COALESCE(_used_upload, ARRAY[]::uuid[])),
    'filled', _filled,
    'shortfall', _short,
    'note',
      'the student''s own wrong questions; bank in from_bank, private uploads in from_upload'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        _qid_text := _src.v->>'question_id';
        -- Upload-sourced mistakes have no bank variant pool; do not cast their
        -- upload UUID into question_bank lookups.
        IF _qid_text IS NULL OR _qid_text = '' THEN
          CONTINUE;
        END IF;
        SELECT array_agg(t.qid) INTO _ids
          FROM (
            SELECT qid
              FROM public._recovery_variant_pool(
                     _qid_text::uuid, _tier, _src.v->>'difficulty') AS pool(qid)
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
  'Recovery ladder for one chapter and one named student. Tier 0 serves bank originals (from_bank) and private student_upload_questions (from_upload); upload UUIDs never enter question_bank lookups. rpc_recovery_session_plan is the auth.uid() form.';

-- Thin wrapper unchanged in shape; recreate so COMMENT/body stay coherent.
CREATE OR REPLACE FUNCTION public.rpc_recovery_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT public._recovery_session_plan_for(auth.uid(), _chapter_id)
$fn$;

-- ── 2. Trigger + queue counts match the plan ────────────────────────────────
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

  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id
       AND sm.status = 'open'
       AND sm.chapter_id IS NOT NULL
       AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL)
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

    BEGIN
      _rid := public._ensure_recovery_session(
        _ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id);
      IF _rid IS NOT NULL THEN _built := _built + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not prepare recovery for chapter %: %', _r.chapter_id, SQLERRM;
    END;
  END LOOP;

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
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;

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
               'ready',          (m.open_mistakes >= _trigger
                                  AND m.open_mistakes <= _relearn_above),
               'mode',           CASE
                                   WHEN m.open_mistakes > _relearn_above THEN 'relearn'
                                   WHEN m.open_mistakes < _trigger       THEN 'none'
                                   WHEN m.open_mistakes <= _deep_max     THEN 'deep'
                                   ELSE 'wide' END,
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
             AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL)
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
             AND completed_at IS NOT NULL
           GROUP BY chapter_id
        ) rs ON rs.chapter_id = m.chapter_id
    ) t;

  RETURN _out;
END;
$fn$;

-- ── 3. Start-session stale count must match the plan filter ─────────────────
DO $rewrite$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_start_recovery_session';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_start_recovery_session not found';
  END IF;
  IF position(E'\r' IN _def) > 0 THEN
    RAISE EXCEPTION 'a carriage return survived normalisation';
  END IF;

  IF position(
       'sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL' IN _def
     ) > 0 THEN
    RAISE NOTICE 'rpc_start_recovery_session already counts upload_question_id';
    RETURN;
  END IF;

  _new := replace(_def,
    'AND sm.status = ''open'' AND sm.question_id IS NOT NULL;',
    'AND sm.status = ''open''
       AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL);');

  IF _new = _def THEN
    RAISE EXCEPTION
      'start-session stale-count anchor matched nothing — dump live rpc_start_recovery_session with pg_get_functiondef and re-anchor';
  END IF;

  EXECUTE _new;
END $rewrite$;

-- ── 4. VERIFY (must be able to fail) ────────────────────────────────────────
DO $prove$
DECLARE
  _src text;
  _uid uuid;
  _school uuid;
  _chap uuid;
  _up uuid;
  _upload uuid;
  _mid uuid;
  _plan jsonb;
  _from_up jsonb;
  _from_bank jsonb;
BEGIN
  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_recovery_session_plan_for';
  IF position('upload_question_id IS NOT NULL' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: plan still requires bank question_id only';
  END IF;
  IF position('from_upload' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: plan tier 0 does not list from_upload';
  END IF;
  IF position('student_upload_questions' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: plan does not serve student_upload_questions';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_apply_chapter_state';
  IF position('upload_question_id IS NOT NULL' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: _apply_chapter_state still bank-only';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_student_recovery_queue';
  IF position('upload_question_id IS NOT NULL' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_student_recovery_queue still bank-only';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_start_recovery_session';
  IF position('upload_question_id IS NOT NULL' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_start_recovery_session stale count still bank-only';
  END IF;

  -- Positive control: an upload-only open mistake is counted and served in tier 0,
  -- and its UUID never appears in from_bank.
  SELECT s.user_id, s.school_id INTO _uid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  -- Prefer an empty chapter so the probe stays in deep mode (relearn has no tiers).
  SELECT c.id INTO _chap
    FROM public.chapters c
   WHERE public._recovery_chapter_is_for(_uid, c.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.chapter_id = c.id AND sm.status = 'open'
          AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL)
     )
   LIMIT 1;
  IF _chap IS NULL THEN
    SELECT c.id INTO _chap
      FROM public.chapters c
     WHERE public._recovery_chapter_is_for(_uid, c.id)
     LIMIT 1;
  END IF;
  SELECT u.id INTO _upload
    FROM public.student_uploads u
   WHERE u.owner_id = _uid
   LIMIT 1;
  SELECT q.id INTO _up
    FROM public.student_upload_questions q
   WHERE _upload IS NOT NULL AND q.upload_id = _upload AND q.owner_id = _uid
   LIMIT 1;

  IF _uid IS NULL OR _chap IS NULL OR _up IS NULL THEN
    RAISE WARNING 'no owner/chapter/upload-question fixture; body markers verified only';
    RETURN;
  END IF;

  INSERT INTO public.student_mistakes (
    user_id, school_id, source, subject, question_text, chapter_id, upload_question_id, status
  ) VALUES (
    _uid, _school, 'upload', '__probe_710_plan__', '__probe_710_plan__', _chap, _up, 'open'
  )
  RETURNING id INTO _mid;

  _plan := public._recovery_session_plan_for(_uid, _chap);
  IF COALESCE((_plan->>'open_mistakes')::int, 0) < 1 THEN
    DELETE FROM public.student_mistakes WHERE id = _mid;
    RAISE EXCEPTION 'VERIFY FAILED: upload-only mistake not counted (open_mistakes=%), plan=%',
      _plan->>'open_mistakes', left(_plan::text, 200);
  END IF;

  IF (_plan->>'mode') = 'relearn' THEN
    -- Count path proven; tier lists are empty in relearn. Prefer empty-chapter fixture.
    DELETE FROM public.student_mistakes WHERE id = _mid;
    RAISE WARNING 'VERIFY: chapter already above relearn boundary; count proven, tier-0 serve skipped';
    RETURN;
  END IF;

  _from_up := _plan->'tiers'->'0'->'from_upload';
  IF _from_up IS NULL OR NOT (_from_up @> to_jsonb(_up)) THEN
    DELETE FROM public.student_mistakes WHERE id = _mid;
    RAISE EXCEPTION 'VERIFY FAILED: tier 0 from_upload missing % — got %', _up, _from_up;
  END IF;

  _from_bank := _plan->'tiers'->'0'->'from_bank';
  IF _from_bank IS NOT NULL AND _from_bank @> to_jsonb(_up) THEN
    DELETE FROM public.student_mistakes WHERE id = _mid;
    RAISE EXCEPTION 'VERIFY FAILED: upload UUID % shoved into from_bank', _up;
  END IF;

  DELETE FROM public.student_mistakes WHERE id = _mid;
END $prove$;

COMMIT;
