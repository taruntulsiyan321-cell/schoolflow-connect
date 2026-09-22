-- ═══════════════════════════════════════════════════════════════════════════
-- A GENERATED QUESTION IS FILED WHERE IT BELONGS, BY THE DATABASE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Spec: docs/locked-decisions.md §10.9 ("AI-generated questions are saved to
-- it and reused. Every question is tagged: board · class · subject · chapter ·
-- topic · difficulty"), §10.22 ("AI-generated questions follow the same rule —
-- pick an existing topic"; "a topic only means something inside its chapter,
-- and that pairing is enforced"). Owner ruling 2026-09-15 (rule 31 as amended):
-- every question the AI writes is tagged and stored automatically, so the
-- next student who needs it costs no tokens.
--
-- WHAT WAS WRONG
--
-- Every generator carried its own copy of "what a stored question looks like".
-- ai-recovery-variants copied subject, chapter, class, board and the old
-- per-question `topic`/`concept` strings off its source row; the question-paper
-- screen wrote `topic: null`; dpp-generate-questions stored nothing at all.
-- Three generators, three answers to one question, and in every case the
-- labels were whatever the CALLER said — nothing checked them against the
-- curriculum.
--
-- WHAT THIS IS
--
-- ONE way in: public.store_generated_questions(jsonb). A generator states only
-- what it actually knows —
--
--     topic_id              which topic it wrote for (or source_question_id)
--     question, format, options/correct_index or answer, explanation
--     difficulty            easy | medium | hard
--     source                what produced it ('ai_recovery_variant', …)
--
-- — and the database derives everything else from the topic's chapter:
-- chapter_id, the chapter's name, subject and class from the curriculum tree,
-- board from the curriculum's board. A caller cannot mislabel a question,
-- because it is not asked for the labels.
--
-- A VARIANT (source_question_id) inherits topic, chapter, subject, class,
-- board and stream from its source, and its difficulty unless one is given.
-- A topic_id given alongside a source must BE the source's topic — a variant
-- is the same topic by definition, and disagreement means the caller is
-- confused, so the row is skipped rather than guessed.
--
-- SKIPPED, NOT FAKED. A row that fails a check is not inserted and is reported
-- with its reason; nothing is padded or repaired. Checks:
--   * the topic (or source) exists, and an optional chapter_id agrees with it
--   * difficulty is one the bank uses; format is one question_bank admits
--   * an MCQ has distinct non-empty options and a correct_index inside them;
--     a written-answer question has an answer
--   * it is not the same question as one already active in that subject and
--     class, or as an earlier row of the same call (compared on normalised
--     text)
--
-- NOT CHECKED HERE: near-duplicates by meaning. Embedding similarity cannot
-- tell "the same question" from "same method, different numbers" — measured in
-- aiRouter.ts, a same-template-different-values pair scored 0.94 while a true
-- paraphrase scored 0.79 — and a tier-1 variant IS the second kind. Refusing
-- on similarity would refuse exactly the questions recovery exists to write.
--
-- Stored rows are is_approved and is_active (spec §4.2a — unapproved is
-- invisible, so the cache never pays), source_type 'ai_generated',
-- embed_status 'pending_embed' for the embedding job.
--
-- WHO MAY CALL IT: service_role only. Generators run server-side; a signed-in
-- user calling this directly would write unreviewed content into the shared
-- bank for every school.
--
-- Rollback: supabase/migrations/rollback/20261020020000_a_generated_question_is_filed_where_it_belongs.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._question_text_key(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  -- The comparison form for "is this the same question": case, surrounding
  -- space and runs of whitespace are not what makes two questions different.
  SELECT lower(regexp_replace(btrim(COALESCE(_text, '')), '\s+', ' ', 'g'))
$fn$;

COMMENT ON FUNCTION public._question_text_key(text) IS
  'Normalised question text used to refuse storing a question already in its chapter. One home: store_generated_questions and its proof both call this.';


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

COMMENT ON FUNCTION public.store_generated_questions(jsonb) IS
  'The one way an AI-generated question enters question_bank. The caller names the topic (or source question); chapter, subject, class and board are derived from the curriculum, never taken from the caller. Returns {inserted:[{index,id}], skipped:[{index,reason}]}. service_role only.';

REVOKE ALL ON FUNCTION public.store_generated_questions(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_generated_questions(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._question_text_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._question_text_key(text) TO service_role;


-- ── Proof, run against the real bank and rolled back ──────────────────────

DO $proof$
DECLARE
  _topic   public.topics%ROWTYPE;
  _other   public.topics%ROWTYPE;
  _srcq    public.question_bank%ROWTYPE;
  _res     jsonb;
  _row     public.question_bank%ROWTYPE;
  _reasons text;
BEGIN
  BEGIN
    SELECT t.* INTO _topic FROM public.topics t
     WHERE EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.topic_id = t.id AND qb.is_active AND qb.options IS NOT NULL)
     ORDER BY t.id LIMIT 1;
    SELECT t.* INTO _other FROM public.topics t WHERE t.chapter_id <> _topic.chapter_id ORDER BY t.id LIMIT 1;
    SELECT qb.* INTO _srcq FROM public.question_bank qb
     WHERE qb.topic_id = _topic.id AND qb.is_active AND qb.options IS NOT NULL ORDER BY qb.id LIMIT 1;

    _res := public.store_generated_questions(jsonb_build_array(
      -- 0: good, by topic
      jsonb_build_object('topic_id', _topic.id, 'question', 'PROOF 20261020020000: a fresh question?',
        'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct_index', 2, 'explanation', 'because',
        'difficulty', 'easy', 'source', 'migration_proof'),
      -- 1: good, variant — inherits everything
      jsonb_build_object('source_question_id', _srcq.id, 'variant_tier', 1, 'question', 'PROOF 20261020020000: a variant?',
        'options', jsonb_build_array('w', 'x', 'y', 'z'), 'correct_index', 0, 'source', 'migration_proof'),
      -- 2: topic and chapter disagree
      jsonb_build_object('topic_id', _topic.id, 'chapter_id', _other.chapter_id, 'question', 'PROOF: wrong chapter',
        'options', jsonb_build_array('a', 'b'), 'correct_index', 0, 'difficulty', 'easy', 'source', 'migration_proof'),
      -- 3: already in the bank (the source question's own text, reshaped)
      jsonb_build_object('topic_id', _topic.id, 'question', '  ' || upper(_srcq.question) || '  ',
        'options', jsonb_build_array('a', 'b'), 'correct_index', 0, 'difficulty', 'easy', 'source', 'migration_proof'),
      -- 4: no topic at all
      jsonb_build_object('question', 'PROOF: untagged', 'options', jsonb_build_array('a', 'b'),
        'correct_index', 0, 'difficulty', 'easy', 'source', 'migration_proof'),
      -- 5: answer key outside the options
      jsonb_build_object('topic_id', _topic.id, 'question', 'PROOF: bad key', 'options', jsonb_build_array('a', 'b'),
        'correct_index', 5, 'difficulty', 'easy', 'source', 'migration_proof'),
      -- 6: duplicate of row 0 within the call
      jsonb_build_object('topic_id', _topic.id, 'question', 'proof 20261020020000:   a FRESH question?',
        'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct_index', 2, 'difficulty', 'easy', 'source', 'migration_proof'),
      -- 7: variant naming a different topic from its source
      jsonb_build_object('source_question_id', _srcq.id, 'topic_id', _other.id, 'question', 'PROOF: confused variant',
        'options', jsonb_build_array('a', 'b'), 'correct_index', 0, 'source', 'migration_proof')
    ));

    IF (_res->>'inserted_count')::int <> 2 OR (_res->>'skipped_count')::int <> 6 THEN
      RAISE EXCEPTION 'proof: expected 2 inserted and 6 skipped, got %', _res;
    END IF;
    IF (SELECT array_agg((e->>'index')::int ORDER BY (e->>'index')::int) FROM jsonb_array_elements(_res->'skipped') e)
       <> ARRAY[2, 3, 4, 5, 6, 7] THEN
      RAISE EXCEPTION 'proof: the wrong rows were skipped: %', _res->'skipped';
    END IF;

    -- Row 0: every label derived from the curriculum, none from the caller.
    SELECT qb.* INTO _row FROM public.question_bank qb
     WHERE qb.id = ((_res->'inserted'->0)->>'id')::uuid;
    IF _row.topic_id <> _topic.id OR _row.chapter_id <> _topic.chapter_id
       OR _row.subject IS DISTINCT FROM (SELECT cs.name FROM public.chapters c JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id WHERE c.id = _topic.chapter_id)
       OR _row.class_level IS DISTINCT FROM (SELECT cc.level FROM public.chapters c JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id WHERE c.id = _topic.chapter_id)
       OR _row.chapter IS DISTINCT FROM (SELECT c.name FROM public.chapters c WHERE c.id = _topic.chapter_id)
       OR _row.source_type <> 'ai_generated' OR NOT _row.is_approved OR NOT _row.is_active
       OR _row.embed_status <> 'pending_embed' THEN
      RAISE EXCEPTION 'proof: row 0 was stored with labels that do not match its topic''s chapter: %', to_jsonb(_row) - 'embedding';
    END IF;

    -- Row 1: the variant inherited topic, board, stream and difficulty.
    SELECT qb.* INTO _row FROM public.question_bank qb
     WHERE qb.id = ((_res->'inserted'->1)->>'id')::uuid;
    IF _row.topic_id <> _srcq.topic_id OR _row.board IS DISTINCT FROM _srcq.board
       OR _row.stream IS DISTINCT FROM _srcq.stream OR _row.difficulty IS DISTINCT FROM _srcq.difficulty
       OR _row.source_question_id <> _srcq.id OR _row.variant_tier <> 1 THEN
      RAISE EXCEPTION 'proof: the variant did not inherit from its source: %', to_jsonb(_row) - 'embedding';
    END IF;

    SELECT string_agg(e->>'reason', ' | ' ORDER BY (e->>'index')::int) INTO _reasons FROM jsonb_array_elements(_res->'skipped') e;
    IF _reasons NOT LIKE '%different chapter%' OR _reasons NOT LIKE '%already in the bank%'
       OR _reasons NOT LIKE '%untagged%' OR _reasons NOT LIKE '%correct_index 5%'
       OR _reasons NOT LIKE '%earlier in this call%' OR _reasons NOT LIKE '%a variant is the same topic%' THEN
      RAISE EXCEPTION 'proof: a skip reason is missing or wrong: %', _reasons;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__proof_passed_roll_back__';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '__proof_passed_roll_back__' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.question_bank WHERE source = 'migration_proof') THEN
    RAISE EXCEPTION 'proof: fixture rows survived the rollback';
  END IF;

  -- Grants: the door is not a client door.
  IF has_function_privilege('authenticated', 'public.store_generated_questions(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.store_generated_questions(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'proof: a client role can call store_generated_questions';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.store_generated_questions(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'proof control: service_role cannot call store_generated_questions — the privilege check is blind';
  END IF;
END
$proof$;

COMMIT;
