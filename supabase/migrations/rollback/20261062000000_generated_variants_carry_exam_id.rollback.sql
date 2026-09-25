-- ROLLBACK of 20261062000000_generated_variants_carry_exam_id: store_generated_questions
-- as 20261020020000 left it, before variants inherited their source's exam_id.
--
-- Stack order: 20261068000000 redefined this function after 20261062000000, so
-- roll that back first; running this alone today would also undo 68's upload
-- promotion.

BEGIN;

CREATE OR REPLACE FUNCTION public.store_generated_questions(_questions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _item      jsonb;
  _i         int := -1;
  _inserted  jsonb := '[]'::jsonb;
  _skipped   jsonb := '[]'::jsonb;
  _seen      text[] := ARRAY[]::text[];

  _topic_id  uuid;
  _src_id    uuid;
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
  _src       public.question_bank%ROWTYPE;
  _key       text;
  _dup       uuid;
  _n_opts    int;
  _new_id    uuid;
BEGIN
  IF _questions IS NULL OR jsonb_typeof(_questions) <> 'array' THEN
    RAISE EXCEPTION 'store_generated_questions expects a JSON array';
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_questions) LOOP
    _i := _i + 1;
    BEGIN
      _topic_id  := NULLIF(_item->>'topic_id', '')::uuid;
      _src_id    := NULLIF(_item->>'source_question_id', '')::uuid;
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
      _stream    := NULL;
      _board     := NULL;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'a field has the wrong type: ' || SQLERRM);
      CONTINUE;
    END;

    IF _source IS NULL THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'source is required — say what produced this question');
      CONTINUE;
    END IF;

    -- ── Where it belongs ────────────────────────────────────────────────
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
      _diff     := COALESCE(_diff, _src.difficulty);
    ELSIF _tier IS NOT NULL THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'variant_tier needs source_question_id');
      CONTINUE;
    END IF;

    IF _topic_id IS NULL THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'topic_id (or source_question_id) is required — an untagged question cannot be stored');
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
    -- A variant keeps its source's board ('both' stays 'both'); a fresh
    -- question takes the curriculum's.
    IF _src_id IS NOT NULL THEN
      _board := COALESCE(_src.board, _board);
    END IF;

    IF _stated_ch IS NOT NULL AND _stated_ch <> _chapter THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'the topic belongs to a different chapter than the chapter_id given');
      CONTINUE;
    END IF;

    -- ── What it is ──────────────────────────────────────────────────────
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

    -- ── Not a question the bank already has ─────────────────────────────
    _key := public._question_text_key(_question);
    IF _key = ANY (_seen) THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'the same question appears earlier in this call');
      CONTINUE;
    END IF;
    -- Scoped to (subject, class), not the chapter: question_bank_unique_active
    -- is UNIQUE (question, class_level, subject) over active rows, so a repeat
    -- from a sibling chapter would otherwise abort the whole call on a
    -- constraint instead of being skipped and reported.
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
      chapter_id, topic_id, chapter, subject, class_level, board, stream,
      difficulty, question_format, question, options, correct_index, answer, explanation,
      source, source_type, source_question_id, variant_tier,
      is_approved, is_active, embed_status
    ) VALUES (
      _chapter, _topic_id, _ch_name, _subject, _level, _board, _stream,
      _diff, _format, _question, _options, _ci, _answer, _expl,
      _source, 'ai_generated', _src_id, _tier,
      true, true, 'pending_embed'
    ) RETURNING id INTO _new_id;

    _inserted := _inserted || jsonb_build_object('index', _i, 'id', _new_id);
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', _inserted,
    'skipped',  _skipped,
    'inserted_count', jsonb_array_length(_inserted),
    'skipped_count',  jsonb_array_length(_skipped));
END;
$fn$;

DELETE FROM public.schema_migrations WHERE version = '20261062000000_generated_variants_carry_exam_id';

COMMIT;
