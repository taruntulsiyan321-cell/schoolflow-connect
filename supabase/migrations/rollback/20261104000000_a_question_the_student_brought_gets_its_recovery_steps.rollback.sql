-- ROLLBACK of 20261104000000_a_question_the_student_brought_gets_its_recovery_steps:
-- the plan as it stood, and the pool dropped.

BEGIN;

CREATE OR REPLACE FUNCTION public._recovery_session_plan_for(_uid uuid, _chapter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  _used_capture  uuid[] := ARRAY[]::uuid[];
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
  _cap_ok        boolean;
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

  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND (sm.question_id IS NOT NULL
          OR sm.upload_question_id IS NOT NULL
          OR sm.capture_question_id IS NOT NULL);

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
    SELECT sm.question_id, sm.upload_question_id, sm.capture_question_id,
           sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (sm.question_id IS NOT NULL
            OR sm.upload_question_id IS NOT NULL
            OR sm.capture_question_id IS NOT NULL)
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id,
      'upload_question_id', _m.upload_question_id,
      'capture_question_id', _m.capture_question_id,
      'difficulty', _m.difficulty,
      'times_wrong', _m.times_wrong);

    IF _per[1] <= 0 THEN
      CONTINUE;
    END IF;

    IF _m.question_id IS NOT NULL THEN
      -- Only a question the student can be shown: a bank question withdrawn
      -- after the mistake (retired, or its key disputed) is not an original
      -- that can be asked again (20261093000000).
      IF NOT (_m.question_id = ANY (_used)) AND EXISTS (
           SELECT 1 FROM public.question_bank q
            WHERE q.id = _m.question_id AND q.is_active AND q.is_approved) THEN
        _used := _used || _m.question_id;
      END IF;
    ELSIF _m.upload_question_id IS NOT NULL
          AND NOT (_m.upload_question_id = ANY (_used_upload)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_upload_questions uq
         WHERE uq.id = _m.upload_question_id
           AND uq.owner_id = _uid
      ) INTO _up_ok;
      IF _up_ok THEN
        _used_upload := _used_upload || _m.upload_question_id;
      END IF;
    ELSIF _m.capture_question_id IS NOT NULL
          AND NOT (_m.capture_question_id = ANY (_used_capture)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_capture_questions cq
         WHERE cq.id = _m.capture_question_id
           AND cq.owner_id = _uid
      ) INTO _cap_ok;
      IF _cap_ok THEN
        _used_capture := _used_capture || _m.capture_question_id;
      END IF;
    END IF;
  END LOOP;

  _need := _n * _per[1];
  _filled := COALESCE(array_length(_used, 1), 0)
           + COALESCE(array_length(_used_upload, 1), 0)
           + COALESCE(array_length(_used_capture, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _proc_filled := _proc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed', _need,
    'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'from_upload', to_jsonb(COALESCE(_used_upload, ARRAY[]::uuid[])),
    'from_capture', to_jsonb(COALESCE(_used_capture, ARRAY[]::uuid[])),
    'filled', _filled,
    'shortfall', _short,
    'note',
      'own wrongs: bank in from_bank, uploads in from_upload, captures in from_capture'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        _qid_text := _src.v->>'question_id';
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
$function$;


DROP FUNCTION public._recovery_step_pool(uuid, uuid, jsonb, smallint);

DELETE FROM public.schema_migrations WHERE version = '20261104000000_a_question_the_student_brought_gets_its_recovery_steps';

COMMIT;
