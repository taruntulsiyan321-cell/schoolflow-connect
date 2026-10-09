-- ROLLBACK of 20261148000000_every_ai_question_passes_the_quality_gate.
-- The two doors go back to their definitions as they were live on 2026-10-09
-- (read from production with pg_get_functiondef), then the gate's record,
-- helpers and column go. Every quality review stored is lost with the column.
BEGIN;

CREATE OR REPLACE FUNCTION public.store_generated_questions(_questions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _item      jsonb;
  _i         int := -1;
  _inserted  jsonb := '[]'::jsonb;
  _skipped   jsonb := '[]'::jsonb;
  _seen      text[] := ARRAY[]::text[];

  _topic_id  uuid;
  _src_id    uuid;
  _up_src_id uuid;
  _tier      smallint;
  _chapter   uuid;
  _stated_ch uuid;
  _format    text;
  _question  text;
  _options   jsonb;
  _ci        int;
  _answer    text;
  _expl      text;
  _diff      text;
  _source    text;

  _ch_name   text;
  _subject   text;
  _level     int;
  _board     text;
  _stream    text;
  _exam_id   uuid;
  _src       public.question_bank%ROWTYPE;
  _up        public.student_upload_questions%ROWTYPE;
  _key       text;
  _dup       uuid;
  _n_opts    int;
  _new_id    uuid;
  _stated_ex uuid;
  _status    text;
BEGIN
  IF _questions IS NULL OR jsonb_typeof(_questions) <> 'array' THEN
    RAISE EXCEPTION 'store_generated_questions expects a JSON array';
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_questions) LOOP
    _i := _i + 1;
    BEGIN
      _topic_id  := NULLIF(_item->>'topic_id', '')::uuid;
      _src_id    := NULLIF(_item->>'source_question_id', '')::uuid;
      _up_src_id := NULLIF(_item->>'source_upload_question_id', '')::uuid;
      _tier      := NULLIF(_item->>'variant_tier', '')::smallint;
      _stated_ch := NULLIF(_item->>'chapter_id', '')::uuid;
      _format    := COALESCE(NULLIF(_item->>'question_format', ''), 'mcq');
      _question  := btrim(COALESCE(_item->>'question', ''));
      _options   := _item->'options';
      _ci        := NULLIF(_item->>'correct_index', '')::int;
      _answer    := NULLIF(btrim(COALESCE(_item->>'answer', '')), '');
      _expl      := NULLIF(btrim(COALESCE(_item->>'explanation', '')), '');
      _diff      := NULLIF(_item->>'difficulty', '');
      _source    := NULLIF(btrim(COALESCE(_item->>'source', '')), '');
      _stated_ex := NULLIF(_item->>'exam_id', '')::uuid;
      _stream    := NULL;
      _board     := NULL;
      _exam_id   := NULL;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'a field has the wrong type: ' || SQLERRM);
      CONTINUE;
    END;

    IF _source IS NULL THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'source is required — say what produced this question');
      CONTINUE;
    END IF;

    IF _src_id IS NOT NULL AND _up_src_id IS NOT NULL THEN
      _skipped := _skipped || jsonb_build_object(
        'index', _i,
        'reason', 'set exactly one of source_question_id / source_upload_question_id (§10.3)');
      CONTINUE;
    END IF;

    IF _src_id IS NOT NULL THEN
      SELECT * INTO _src FROM public.question_bank WHERE id = _src_id;
      IF NOT FOUND THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'source_question_id does not exist');
        CONTINUE;
      END IF;
      IF _src.topic_id IS NULL THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'the source question has no topic to inherit');
        CONTINUE;
      END IF;
      IF _topic_id IS NOT NULL AND _topic_id <> _src.topic_id THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'topic_id disagrees with the source question''s topic — a variant is the same topic');
        CONTINUE;
      END IF;
      _topic_id := _src.topic_id;
      _board    := _src.board;
      _stream   := _src.stream;
      _exam_id  := _src.exam_id;
      _diff     := COALESCE(_diff, _src.difficulty);
    ELSIF _up_src_id IS NOT NULL THEN
      -- §10.1: never promote the upload itself — only a generated variant,
      -- tagged back to the private source and with source_question_id NULL.
      SELECT * INTO _up FROM public.student_upload_questions WHERE id = _up_src_id;
      IF NOT FOUND THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'source_upload_question_id does not exist');
        CONTINUE;
      END IF;
      IF _up.answer_source = 'ai' THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'AI-answered upload source cannot promote (§6.2 / §10.2.4)');
        CONTINUE;
      END IF;
      IF _up.chapter_id IS NULL THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'upload source has no real chapter_id (§10.2.1)');
        CONTINUE;
      END IF;
      IF _up.topic_id IS NULL AND _topic_id IS NULL THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'upload source has no topic_id to inherit');
        CONTINUE;
      END IF;
      IF _topic_id IS NOT NULL AND _up.topic_id IS NOT NULL AND _topic_id <> _up.topic_id THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'topic_id disagrees with the upload source topic');
        CONTINUE;
      END IF;
      _topic_id := COALESCE(_up.topic_id, _topic_id);
      _diff     := COALESCE(_diff, NULLIF(_up.difficulty, ''));
      _src_id   := NULL; -- §10 promotion shape
    ELSIF _tier IS NOT NULL THEN
      _skipped := _skipped || jsonb_build_object(
        'index', _i,
        'reason', 'variant_tier needs source_question_id or source_upload_question_id');
      CONTINUE;
    END IF;

    IF _topic_id IS NULL THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'topic_id (or a source) is required — an untagged question cannot be stored');
      CONTINUE;
    END IF;

    SELECT t.chapter_id, c.name, cs.name, cc.level, bo.code
      INTO _chapter, _ch_name, _subject, _level, _board
      FROM public.topics t
      JOIN public.chapters c             ON c.id  = t.chapter_id
      JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
      JOIN public.curriculum_classes cc  ON cc.id = cs.curriculum_class_id
      JOIN public.boards bo              ON bo.id = cc.board_id
     WHERE t.id = _topic_id;
    IF NOT FOUND THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'topic_id does not exist');
      CONTINUE;
    END IF;
    IF _src_id IS NOT NULL THEN
      _board := COALESCE(_src.board, _board);
      _exam_id := _src.exam_id;
    END IF;
    IF _up_src_id IS NOT NULL AND _up.chapter_id IS NOT NULL AND _up.chapter_id <> _chapter THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'upload source chapter disagrees with the topic''s chapter');
      CONTINUE;
    END IF;

    -- A question written for an exam (AI Practice, 20261138000000) has no
    -- source to inherit the exam from; it names it, and its chapter must be in
    -- that exam's syllabus. A variant still takes its source's exam, never one
    -- stated beside it.
    IF _stated_ex IS NOT NULL THEN
      IF _src_id IS NOT NULL OR _up_src_id IS NOT NULL THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'exam_id is for a question with no source — a variant takes its source''s exam');
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.exam_syllabus_chapters s
                      WHERE s.exam_id = _stated_ex AND s.chapter_id = _chapter) THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'the topic''s chapter is not in that exam''s syllabus');
        CONTINUE;
      END IF;
      _exam_id := _stated_ex;
    END IF;

    IF _stated_ch IS NOT NULL AND _stated_ch <> _chapter THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'the topic belongs to a different chapter than the chapter_id given');
      CONTINUE;
    END IF;

    IF _diff IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.question_bank qb WHERE qb.difficulty = _diff LIMIT 1) THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', format('difficulty %L is not one the bank uses', _diff));
      CONTINUE;
    END IF;

    IF length(_question) = 0 THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'question text is empty');
      CONTINUE;
    END IF;

    IF _format IN ('short', 'long') THEN
      IF _answer IS NULL THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'a written-answer question needs an answer');
        CONTINUE;
      END IF;
      _options := NULL;
      _ci := NULL;
    ELSE
      IF _options IS NULL OR jsonb_typeof(_options) <> 'array' THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'options must be an array');
        CONTINUE;
      END IF;
      SELECT count(*) INTO _n_opts
        FROM jsonb_array_elements(_options) AS o(v)
       WHERE jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') <> '';
      IF _n_opts < 2 OR _n_opts <> jsonb_array_length(_options) THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'options must be at least two non-empty strings');
        CONTINUE;
      END IF;
      IF (SELECT count(DISTINCT lower(btrim(v))) FROM jsonb_array_elements_text(_options) AS o(v)) <> _n_opts THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'options are not distinct');
        CONTINUE;
      END IF;
      IF _ci IS NULL OR _ci < 0 OR _ci >= _n_opts THEN
        _skipped := _skipped || jsonb_build_object('index', _i, 'reason', format('correct_index %s is not one of the %s options', COALESCE(_ci::text, 'null'), _n_opts));
        CONTINUE;
      END IF;
      _answer := NULL;
    END IF;

    _key := public._question_text_key(_question);
    IF _key = ANY (_seen) THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'the same question appears earlier in this call');
      CONTINUE;
    END IF;
    _dup := NULL;
    SELECT qb.id INTO _dup
      FROM public.question_bank qb
     WHERE qb.subject = _subject
       AND qb.class_level = _level
       AND qb.is_active
       AND public._question_text_key(qb.question) = _key
     LIMIT 1;
    IF _dup IS NOT NULL THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'already in the bank', 'existing_id', _dup);
      CONTINUE;
    END IF;
    _seen := _seen || _key;

    INSERT INTO public.question_bank (
      chapter_id, topic_id, chapter, subject, class_level, board, stream, exam_id,
      difficulty, question_format, question, options, correct_index, answer, explanation,
      source, source_type, source_question_id, source_upload_question_id, variant_tier,
      is_approved, is_active, embed_status
    ) VALUES (
      _chapter, _topic_id, _ch_name, _subject, _level, _board, _stream, _exam_id,
      _diff, _format, _question, _options, _ci, _answer, _expl,
      _source, 'ai_generated', _src_id, _up_src_id, _tier,
      true, true, 'pending_embed'
    ) RETURNING id, explanation_status INTO _new_id, _status;

    _inserted := _inserted || jsonb_build_object('index', _i, 'id', _new_id, 'explanation_status', _status);
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', _inserted,
    'skipped',  _skipped,
    'inserted_count', jsonb_array_length(_inserted),
    'skipped_count',  jsonb_array_length(_skipped));
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_question_report_verdict(_question_id uuid, _verdict jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _kind    text := _verdict->>'kind';
  _default text := nullif(btrim(_verdict->>'outcome'), '');
  _q       public.question_bank%ROWTYPE;
  _claimed uuid[];
  _new     uuid;
  _st      text;
  _status  text;
  _expl    text;
  _key     integer;
  _settled uuid[];
  _effects jsonb := '{}'::jsonb;
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('keep', 'correct_key', 'rewrite', 'withdraw', 'unresolved') THEN
    RAISE EXCEPTION 'verdict kind %', coalesce(_kind, '(none)');
  END IF;
  IF _default IS NULL THEN
    RAISE EXCEPTION 'a verdict needs an outcome for the student';
  END IF;

  SELECT * INTO _q FROM public.question_bank WHERE id = _question_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'question % not found', _question_id;
  END IF;
  PERFORM 1 FROM public.question_reports
   WHERE question_id = _question_id AND status IN ('open', 'checking')
     FOR UPDATE;

  SELECT array_agg((e->>'id')::uuid) INTO _claimed
    FROM jsonb_array_elements(coalesce(_verdict->'reports', '[]'::jsonb)) e;
  IF _claimed IS NULL OR EXISTS (
       SELECT 1 FROM unnest(_claimed) c
        WHERE NOT EXISTS (SELECT 1 FROM public.question_reports r
                           WHERE r.id = c AND r.question_id = _question_id AND r.status = 'checking')) THEN
    RAISE EXCEPTION 'stale claim: a report in this verdict is not being checked for this question';
  END IF;
  IF _kind <> 'unresolved' AND NOT _q.is_active THEN
    RAISE EXCEPTION 'the question was retired while it was checked';
  END IF;

  IF _kind = 'keep' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_verdict->'reports') e
                WHERE coalesce(e->>'status', '') NOT IN ('answer_stands', 'no_problem', 'explanation_rewritten')) THEN
      RAISE EXCEPTION 'a kept question''s report is answer_stands, no_problem or explanation_rewritten';
    END IF;
    _expl := nullif(btrim(_verdict->>'explanation'), '');
    IF _expl IS NOT NULL AND _expl IS DISTINCT FROM _q.explanation THEN
      UPDATE public.question_bank SET explanation = _expl, updated_at = now()
       WHERE id = _question_id
      RETURNING explanation_status INTO _st;
      IF _st <> 'proper' THEN
        RAISE EXCEPTION 'the explanation written for the report is not proper';
      END IF;
    ELSIF _expl IS NULL AND _q.explanation_status = 'proper' THEN
      _expl := _q.explanation;
    END IF;

  ELSIF _kind IN ('correct_key', 'rewrite') THEN
    _key := (_verdict->>'correct_index')::int;
    IF _kind = 'correct_key' AND (_key IS NULL OR _key = _q.correct_index OR _key < 0
                                  OR _key >= jsonb_array_length(_q.options)) THEN
      RAISE EXCEPTION 'a corrected key must be another of the question''s options';
    END IF;
    IF _kind = 'rewrite' AND (coalesce(btrim(_verdict->>'question'), '') = ''
                              OR jsonb_typeof(_verdict->'options') IS DISTINCT FROM 'array'
                              OR jsonb_array_length(_verdict->'options') NOT BETWEEN 2 AND 8
                              OR _key IS NULL OR _key < 0 OR _key >= jsonb_array_length(_verdict->'options')) THEN
      RAISE EXCEPTION 'a rewrite needs a question, 2 to 8 options and a key among them';
    END IF;

    -- Out of service first: the same text cannot be live twice
    -- (question_bank_unique_active), and a correction keeps the text.
    UPDATE public.question_bank SET is_active = false WHERE id = _question_id;

    INSERT INTO public.question_bank (
      class_level, subject, chapter, difficulty, question, options, correct_index, explanation,
      source, created_by, is_approved, board, source_type, exam_year, stream, question_format,
      is_active, embedding, embedding_basis, embed_status, chapter_id,
      source_question_id, source_upload_question_id, variant_tier, review_note, answer, topic_id, exam_id)
    SELECT q.class_level, q.subject, q.chapter, q.difficulty,
           CASE WHEN _kind = 'rewrite' THEN btrim(_verdict->>'question') ELSE q.question END,
           CASE WHEN _kind = 'rewrite' THEN _verdict->'options' ELSE q.options END,
           _key, _verdict->>'explanation',
           q.source, q.created_by, true, q.board,
           CASE WHEN _kind = 'rewrite' THEN 'ai_generated' ELSE q.source_type END,
           -- A rewrite is no longer that year's paper.
           CASE WHEN _kind = 'rewrite' THEN NULL ELSE q.exam_year END,
           q.stream, q.question_format, true,
           -- The same text keeps its vector; new text waits for the embedding drain.
           CASE WHEN _kind = 'correct_key' THEN q.embedding END,
           CASE WHEN _kind = 'correct_key' THEN q.embedding_basis END,
           CASE WHEN _kind = 'correct_key' THEN q.embed_status ELSE 'pending_embed' END,
           q.chapter_id, q.source_question_id, q.source_upload_question_id, q.variant_tier,
           format('Replaces %s after a student report (%s).', q.id, to_char(now(), 'YYYY-MM-DD')),
           q.answer, q.topic_id, q.exam_id
      FROM public.question_bank q
     WHERE q.id = _question_id
    RETURNING id, explanation_status INTO _new, _st;
    IF _st <> 'proper' THEN
      RAISE EXCEPTION 'the replacement''s explanation is not proper';
    END IF;
    _effects := public._retire_reported_question(_question_id, _new, _kind = 'correct_key', _verdict->>'note');
    _expl := _verdict->>'explanation';
    _status := 'fixed';

  ELSIF _kind = 'withdraw' THEN
    _effects := public._retire_reported_question(_question_id, NULL, false, _verdict->>'note');
    _status := 'withdrawn';

  ELSE
    -- Unresolved: the question joins the disputed list with what was found.
    UPDATE public.question_bank
       SET explanation_status = 'disputed', explanation_claimed_at = NULL,
           review_note = concat_ws(E'\n', nullif(btrim(review_note), ''), nullif(btrim(_verdict->>'note'), '')),
           updated_at = now()
     WHERE id = _question_id;
    _status := 'unresolved';
  END IF;

  WITH per AS (
    SELECT (e->>'id')::uuid AS id, e->>'status' AS status, nullif(btrim(e->>'outcome'), '') AS outcome
      FROM jsonb_array_elements(_verdict->'reports') e
  ), s AS (
    UPDATE public.question_reports r
       SET status = CASE WHEN _kind = 'keep' THEN per.status ELSE _status END,
           outcome = coalesce(per.outcome, _default),
           outcome_explanation = _expl,
           replacement_question_id = _new,
           resolved_at = now(),
           updated_at = now()
      FROM public.question_reports r0
      LEFT JOIN per ON per.id = r0.id
     WHERE r.id = r0.id
       AND r0.question_id = _question_id
       AND (r0.id = ANY (_claimed)
            OR (_kind IN ('correct_key', 'rewrite', 'withdraw') AND r0.status IN ('open', 'checking')))
    RETURNING r.id
  )
  SELECT array_agg(s.id) INTO _settled FROM s;

  INSERT INTO public.notifications (user_id, school_id, type, title, body, link)
  SELECT r.user_id,
         (SELECT st.school_id FROM public.students st WHERE st.user_id = r.user_id ORDER BY st.created_at, st.id LIMIT 1),
         'question_report',
         CASE r.status
           WHEN 'fixed' THEN 'The question you reported is fixed'
           WHEN 'withdrawn' THEN 'The question you reported is withdrawn'
           WHEN 'unresolved' THEN 'Your report needs a closer look'
           ELSE 'Your report was checked'
         END,
         r.outcome,
         '/student/mistakes/reports'
    FROM public.question_reports r
   WHERE r.id = ANY (_settled);

  RETURN jsonb_build_object(
    'kind', _kind,
    'replacement', _new,
    'settled', coalesce(array_length(_settled, 1), 0),
    'effects', _effects);
END $function$;

DROP TABLE public.question_gate_outcomes;
DROP FUNCTION public._quality_review_passes(jsonb);
DROP FUNCTION public._question_rubric_ids();
ALTER TABLE public.question_bank DROP COLUMN quality_review;

COMMENT ON COLUMN public.ai_practice_requests.drafts IS
  'What became of the drafts (20261142000000): {"batches":[{"asked","read","finish","refused":[reason…]}],"drafted","agreed","kept"}. NULL when nothing was written.';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'question_bank' AND column_name = 'quality_review')
     OR to_regclass('public.question_gate_outcomes') IS NOT NULL
     OR to_regprocedure('public._quality_review_passes(jsonb)') IS NOT NULL
     OR pg_get_functiondef('public.store_generated_questions(jsonb)'::regprocedure) LIKE '%quality_review%'
     OR pg_get_functiondef('public.apply_question_report_verdict(uuid,jsonb)'::regprocedure) LIKE '%quality_review%' THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: the quality gate is still in place';
  END IF;
END $verify$;

COMMIT;
