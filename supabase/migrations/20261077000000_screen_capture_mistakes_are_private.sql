-- ===========================================================================
-- SCREEN-CAPTURE MISTAKES ARE PRIVATE (Stage 1 intake)
--
-- Binding: docs/screen-capture-mistakes-spec.md §7, §9, §11
-- Cites (do not restate): docs/custom-practice-upload-spec.md §2, §5, §6, §9
--
-- Private rows for questions captured from another app. Raw frames are NEVER
-- stored (§11). Nothing from this feature may enter public.question_bank (§9).
-- Upload §10 promotion does NOT apply.
--
-- ROLLBACK: rollback/20261077000000_screen_capture_mistakes_are_private.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Private capture questions (upload §2 privacy, capture intake) ────────
CREATE TABLE public.student_capture_questions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id                  uuid NOT NULL REFERENCES public.schools(id),
  fingerprint                text NOT NULL,
  question_text              text NOT NULL,
  options                    jsonb,
  correct_index              integer,
  student_chosen_index       integer,
  correct_answer             text,
  -- screen = key/verdict visible on the captured frame; ai = model filled a gap
  answer_source              text NOT NULL CHECK (answer_source IN ('screen', 'ai')),
  explanation                text,
  difficulty                 text,
  chapter_id                 uuid REFERENCES public.chapters(id),
  topic_id                   uuid REFERENCES public.topics(id),
  matched_bank_question_id   uuid REFERENCES public.question_bank(id),
  source_package             text,
  times_seen                 integer NOT NULL DEFAULT 1 CHECK (times_seen >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_capture_questions_owner_fp UNIQUE (owner_id, fingerprint),
  CONSTRAINT student_capture_questions_answer_shape CHECK (
    (options IS NOT NULL AND jsonb_typeof(options) = 'array'
      AND correct_index IS NOT NULL AND correct_index >= 0)
    OR (correct_answer IS NOT NULL AND length(btrim(correct_answer)) > 0)
  )
);

CREATE INDEX student_capture_questions_owner_idx
  ON public.student_capture_questions (owner_id, created_at DESC);
CREATE INDEX student_capture_questions_chapter_idx
  ON public.student_capture_questions (owner_id, chapter_id)
  WHERE chapter_id IS NOT NULL;

COMMENT ON TABLE public.student_capture_questions IS
  'Private questions from screen-capture intake. Never promote to question_bank (screen-capture-mistakes-spec §9). Frames are never stored (§11).';
COMMENT ON COLUMN public.student_capture_questions.fingerprint IS
  'Normalised question-text fingerprint (§7.3). Repeat capture → same row, times_seen++.';
COMMENT ON COLUMN public.student_capture_questions.matched_bank_question_id IS
  'Inheritance pointer only — does NOT make this row shared (§7.2 / upload §5.2).';

ALTER TABLE public.student_capture_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_capture_questions_owner ON public.student_capture_questions
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- Allowlisted packages the student chose (§4 / §5.1). Stage 1 stores the list;
-- Stage 2 usage-access filters against it on-device.
CREATE TABLE public.student_capture_allowed_apps (
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_name text NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, package_name)
);

ALTER TABLE public.student_capture_allowed_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_capture_allowed_apps_owner ON public.student_capture_allowed_apps
  FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

COMMENT ON TABLE public.student_capture_allowed_apps IS
  'Apps the student opted into for screen-capture mistakes (§4). Unlisted packages are never read (§5.1).';

-- ── 2. Mistakes: capture_question_id + source screen_capture ────────────────
ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS capture_question_id uuid
    REFERENCES public.student_capture_questions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.student_mistakes.capture_question_id IS
  'Private screen-capture original (screen-capture-mistakes-spec §7.4 / upload §9.1). At most one of question_id / upload_question_id / capture_question_id.';

ALTER TABLE public.student_mistakes
  DROP CONSTRAINT IF EXISTS student_mistakes_question_xor_upload;

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_question_xor_sources CHECK (
    num_nonnulls(question_id, upload_question_id, capture_question_id) <= 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS student_mistakes_user_source_capture_q
  ON public.student_mistakes (user_id, source, capture_question_id)
  WHERE capture_question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_mistakes_capture_question_idx
  ON public.student_mistakes (capture_question_id)
  WHERE capture_question_id IS NOT NULL;

ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_source_check;
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_source_check
  CHECK (source = ANY (ARRAY[
    'test', 'battleground', 'exam', 'practice', 'upload', 'screen_capture'
  ]));

ALTER TABLE public.question_attempts DROP CONSTRAINT IF EXISTS question_attempts_source_check;
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source = ANY (ARRAY[
    'battle', 'test', 'practice', 'mistake_book', 'upload', 'screen_capture'
  ]));

-- ── 3. Mistake writer: optional capture_question_id (16-arg) ────────────────
DROP FUNCTION IF EXISTS public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(
  _assessment_type text,
  _source_id uuid,
  _question_id uuid DEFAULT NULL::uuid,
  _subject text DEFAULT 'General'::text,
  _chapter text DEFAULT NULL::text,
  _concept text DEFAULT NULL::text,
  _subconcept text DEFAULT NULL::text,
  _class_level integer DEFAULT NULL::integer,
  _question_text text DEFAULT ''::text,
  _options jsonb DEFAULT '[]'::jsonb,
  _student_answer jsonb DEFAULT '{}'::jsonb,
  _correct_answer jsonb DEFAULT '{}'::jsonb,
  _explanation text DEFAULT NULL::text,
  _chapter_id uuid DEFAULT NULL::uuid,
  _upload_question_id uuid DEFAULT NULL::uuid,
  _capture_question_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _mid uuid;
  _concept_f text;
  _sub_f text;
  _src text;
  _atype text;
  _bank_qid uuid := _question_id;
  _up_qid uuid := _upload_question_id;
  _cap_qid uuid := _capture_question_id;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  -- Prefer a single pointer: bank > upload > capture when callers pass extras.
  IF _bank_qid IS NOT NULL THEN
    _up_qid := NULL;
    _cap_qid := NULL;
  ELSIF _up_qid IS NOT NULL THEN
    _cap_qid := NULL;
  END IF;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  _src := CASE _assessment_type
    WHEN 'battle' THEN 'battleground'
    WHEN 'practice' THEN 'practice'
    WHEN 'upload' THEN 'upload'
    WHEN 'screen_capture' THEN 'screen_capture'
    ELSE _assessment_type
  END;
  _atype := CASE
    WHEN _assessment_type IN ('upload', 'screen_capture') THEN 'practice'
    ELSE _assessment_type
  END;

  IF _cap_qid IS NOT NULL THEN
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, NULL, _cap_qid, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      1, now()
    )
    ON CONFLICT (user_id, source, capture_question_id)
      WHERE capture_question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  ELSIF _up_qid IS NOT NULL THEN
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, _up_qid, NULL, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      1, now()
    )
    ON CONFLICT (user_id, source, upload_question_id)
      WHERE upload_question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  ELSE
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, _bank_qid, NULL, NULL, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  END IF;

  PERFORM public._upsert_concept_mastery(
    _uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  IF _assessment_type IN ('practice', 'test', 'battle', 'upload', 'screen_capture')
     AND _sid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.revision_queue
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '')
    ) THEN
      INSERT INTO public.revision_queue (
        user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _uid, _sid, _subject, _chapter, _concept_f,
        CASE _assessment_type
          WHEN 'practice' THEN 'practice_wrong'
          WHEN 'upload' THEN 'upload_wrong'
          WHEN 'screen_capture' THEN 'screen_capture_wrong'
          ELSE _assessment_type || '_wrong'
        END,
        75, CURRENT_DATE
      );
    ELSE
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, 75),
        due_date = LEAST(due_date, CURRENT_DATE),
        reason = CASE _assessment_type
          WHEN 'practice' THEN 'practice_wrong'
          WHEN 'upload' THEN 'upload_wrong'
          WHEN 'screen_capture' THEN 'screen_capture_wrong'
          ELSE _assessment_type || '_wrong'
        END
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '');
    END IF;
  END IF;

  RETURN _mid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid
) TO authenticated;

-- ── 4. Recovery counts + tier 0 from_capture (upload §9 / capture §7.4) ─────
-- Filter: bank OR upload OR capture original. Capture UUIDs never enter bank lookups.
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

    IF _m.question_id IS NOT NULL AND NOT (_m.question_id = ANY (_used)) THEN
      _used := _used || _m.question_id;
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
$fn$;

COMMENT ON FUNCTION public._recovery_session_plan_for(uuid, uuid) IS
  'Tier 0: from_bank + from_upload + from_capture. Capture/upload UUIDs never enter question_bank lookups.';

-- Align chapter-state trigger count with capture originals.
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
       AND (sm.question_id IS NOT NULL
            OR sm.upload_question_id IS NOT NULL
            OR sm.capture_question_id IS NOT NULL)
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
    'triggered', _triggered, 'scheduled', _scheduled, 'built', _built);
END;
$fn$;

-- Patch start-session open-count filter to include capture_question_id.
DO $patch$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT pg_get_functiondef('public.rpc_start_recovery_session(uuid)'::regprocedure)
    INTO _def;
  IF _def IS NULL THEN
    RAISE NOTICE 'rpc_start_recovery_session(uuid) missing — skip capture count patch';
    RETURN;
  END IF;
  IF position('capture_question_id IS NOT NULL' IN _def) > 0 THEN
    RAISE NOTICE 'rpc_start_recovery_session already counts capture_question_id';
    RETURN;
  END IF;
  _new := replace(
    _def,
    'sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL',
    'sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL'
  );
  IF _new = _def THEN
    RAISE EXCEPTION
      'capture count patch matched nothing — re-read live rpc_start_recovery_session';
  END IF;
  EXECUTE _new;
END;
$patch$;

-- Same for queue if present.
DO $patchq$
DECLARE
  _def text;
  _new text;
  _oid oid;
BEGIN
  SELECT p.oid INTO _oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_student_recovery_queue'
   LIMIT 1;
  IF _oid IS NULL THEN RETURN; END IF;
  SELECT pg_get_functiondef(_oid) INTO _def;
  IF position('capture_question_id IS NOT NULL' IN _def) > 0 THEN RETURN; END IF;
  IF position('upload_question_id IS NOT NULL' IN _def) = 0 THEN RETURN; END IF;
  _new := replace(
    _def,
    'sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL',
    'sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL'
  );
  IF _new <> _def THEN EXECUTE _new; END IF;
END;
$patchq$;

-- ── 5. VERIFY (must be able to fail) ────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.student_capture_questions') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_capture_questions missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'student_mistakes'
       AND column_name = 'capture_question_id'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: capture_question_id column missing';
  END IF;

  IF position('from_capture' IN pg_get_functiondef(
       'public._recovery_session_plan_for(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: plan lacks from_capture';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_mistakes_question_xor_sources'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: xor sources constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_mistakes_source_check'
       AND pg_get_constraintdef(oid) ILIKE '%screen_capture%'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_mistakes.source does not admit screen_capture';
  END IF;

  IF position('_capture_question_id' IN pg_get_functiondef(
       'public.rpc_record_concept_mistake(text,uuid,uuid,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,uuid,uuid,uuid)'::regprocedure
     )) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_record_concept_mistake ignores _capture_question_id';
  END IF;
END;
$$;

COMMIT;
