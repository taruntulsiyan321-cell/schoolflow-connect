-- ===========================================================================
-- ENQUEUE + PROMOTE FROM PRIVATE UPLOAD QUESTIONS
--
-- Binding: docs/custom-practice-upload-spec.md §10.1–§10.4
--
-- 660 made variant_generation_queue accept source_upload_question_id with
-- exactly one source set. This migration:
--   1. Records provenance on promoted bank rows (source_upload_question_id,
--      source_question_id left null).
--   2. Extends store_generated_questions so a service_role generator can
--      promote an upload-sourced variant with that shape.
--   3. Adds rpc_enqueue_upload_variant_generation — owner-scoped door into
--      the queue (queue is REVOKEd from clients). Not practice-session load.
--   4. Teaches the drain to resolve upload-sourced jobs from the bank, and
--      to skip dispatching them until a generator accepts upload sources
--      (bank jobs keep flowing).
--
-- ROLLBACK: rollback/20261068000000_enqueue_upload_variant_and_promote.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Provenance on the shared bank (§10.4) ────────────────────────────────
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS source_upload_question_id uuid
    REFERENCES public.student_upload_questions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.question_bank.source_upload_question_id IS
  'Spec §10.4: promoted variant generated from a private upload question. Mutually exclusive with source_question_id.';

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_one_variant_source;

ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_one_variant_source CHECK (
    num_nonnulls(source_question_id, source_upload_question_id) <= 1
  );

CREATE INDEX IF NOT EXISTS question_bank_source_upload_idx
  ON public.question_bank (source_upload_question_id)
  WHERE source_upload_question_id IS NOT NULL;

-- ── 2. store_generated_questions accepts upload provenance ──────────────────
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
  'The one way an AI-generated question enters question_bank. Bank variants set source_question_id; upload-promoted variants set source_upload_question_id and leave source_question_id null (§10). service_role only.';

REVOKE ALL ON FUNCTION public.store_generated_questions(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_generated_questions(jsonb) TO service_role;

-- ── 3. Owner-scoped enqueue (not practice finish) ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_enqueue_upload_variant_generation(
  _upload_question_id uuid,
  _tier smallint DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _q   public.student_upload_questions%ROWTYPE;
  _job uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _upload_question_id IS NULL THEN
    RAISE EXCEPTION 'upload question id is required';
  END IF;
  IF _tier IS NULL OR _tier NOT IN (1, 2) THEN
    RAISE EXCEPTION 'tier must be 1 or 2';
  END IF;

  SELECT * INTO _q
    FROM public.student_upload_questions
   WHERE id = _upload_question_id
     AND owner_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'upload question not found or not yours';
  END IF;

  -- §6.2 / §10.2.4 — AI-answered never promotes; do not spend generation on it.
  IF _q.answer_source = 'ai' THEN
    RAISE EXCEPTION 'AI-answered upload questions are not eligible for promotion';
  END IF;

  -- §10.2.1 — no real chapter → variant cannot clear the promotion gate.
  IF _q.chapter_id IS NULL THEN
    RAISE EXCEPTION 'upload question has no chapter_id — not eligible for promotion';
  END IF;

  -- Already have an active promoted variant at this tier? Bank is the truth.
  IF EXISTS (
    SELECT 1 FROM public.question_bank qb
     WHERE qb.source_upload_question_id = _upload_question_id
       AND qb.variant_tier = _tier
       AND qb.is_active
       AND qb.replaced_by_question_id IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.variant_generation_queue (
    source_question_id,
    source_upload_question_id,
    tier
  ) VALUES (
    NULL,                 -- §10.3 / promotion: bank source stays null
    _upload_question_id,
    _tier
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO _job;

  RETURN _job;
END;
$fn$;

COMMENT ON FUNCTION public.rpc_enqueue_upload_variant_generation(uuid, smallint) IS
  'Spec §10: owner enqueues AI variant generation from a private upload question. Inserts with source_upload_question_id set and source_question_id null. Not called from Practice session load.';

REVOKE ALL ON FUNCTION public.rpc_enqueue_upload_variant_generation(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_enqueue_upload_variant_generation(uuid, smallint) TO authenticated;

-- ── 4. Drain: resolve upload jobs; do not dispatch them yet ─────────────────
CREATE OR REPLACE FUNCTION public.dispatch_variant_generation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _drain    text;
  _batch    int;
  _max_try  int;
  _sent     int := 0;
  _resolved int;
  _r        record;
BEGIN
  WITH done AS (
    UPDATE public.variant_generation_queue q
       SET status = 'done', resolved_at = now()
     WHERE q.status = 'pending'
       AND (
         (q.source_question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.question_bank qb
             WHERE qb.source_question_id = q.source_question_id
               AND qb.variant_tier = q.tier
               AND qb.is_active
               AND qb.replaced_by_question_id IS NULL))
         OR
         (q.source_upload_question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.question_bank qb
             WHERE qb.source_upload_question_id = q.source_upload_question_id
               AND qb.variant_tier = q.tier
               AND qb.is_active
               AND qb.replaced_by_question_id IS NULL))
       )
    RETURNING 1)
  SELECT count(*)::int INTO _resolved FROM done;

  _batch   := public._recovery_const('GENERATION_BATCH_SIZE')::int;
  _max_try := public._recovery_const('GENERATION_MAX_RETRIES')::int;

  UPDATE public.variant_generation_queue
     SET status = 'failed', resolved_at = now(),
         last_error = COALESCE(last_error, 'exhausted retries with no variant in the bank')
   WHERE status = 'pending' AND attempts >= _max_try;

  SELECT decrypted_secret INTO _drain
    FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain';

  IF _drain IS NULL THEN
    RAISE WARNING 'dispatch_variant_generation: vault secret variant_generation_drain is missing; % job(s) wait',
      (SELECT count(*) FROM public.variant_generation_queue WHERE status = 'pending');
    RETURN 0;
  END IF;

  -- Bank-sourced jobs only until ai-recovery-variants accepts upload sources.
  FOR _r IN
    SELECT q.id, q.source_question_id, q.tier
      FROM public.variant_generation_queue q
     WHERE q.status = 'pending'
       AND q.attempts < _max_try
       AND q.source_question_id IS NOT NULL
     ORDER BY q.created_at
     LIMIT _batch
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM net.http_post(
      url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/ai-recovery-variants',
      body := jsonb_build_object(
        'source_question_id', _r.source_question_id,
        'tier', _r.tier,
        'count', 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-variant-drain', _drain),
      timeout_milliseconds := 60000
    );

    UPDATE public.variant_generation_queue
       SET attempts = attempts + 1, dispatched_at = now()
     WHERE id = _r.id;

    _sent := _sent + 1;
  END LOOP;

  RETURN _sent;
END;
$fn$;

COMMENT ON FUNCTION public.dispatch_variant_generation() IS
  'Cron drain for variant generation. Resolves bank- and upload-sourced jobs from the BANK; dispatches bank-sourced jobs only until the generator accepts upload sources.';

REVOKE ALL ON FUNCTION public.dispatch_variant_generation() FROM anon, authenticated;

-- ── 5. VERIFY ───────────────────────────────────────────────────────────────
DO $prove$
DECLARE
  _rpc text;
  _body text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'question_bank'
       AND column_name = 'source_upload_question_id'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: question_bank.source_upload_question_id missing';
  END IF;

  IF to_regprocedure('public.rpc_enqueue_upload_variant_generation(uuid, smallint)') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_enqueue_upload_variant_generation missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.rpc_enqueue_upload_variant_generation(uuid, smallint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: authenticated cannot execute enqueue RPC';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.rpc_enqueue_upload_variant_generation(uuid, smallint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: anon can execute enqueue RPC';
  END IF;

  _body := pg_get_functiondef('public.store_generated_questions(jsonb)'::regprocedure);
  IF position('source_upload_question_id' IN _body) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: store_generated_questions ignores source_upload_question_id';
  END IF;

  _body := pg_get_functiondef('public.dispatch_variant_generation()'::regprocedure);
  IF position('source_upload_question_id' IN _body) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispatch_variant_generation ignores upload sources';
  END IF;

  -- Positive control: enqueue body names the null bank source.
  _rpc := pg_get_functiondef(
    'public.rpc_enqueue_upload_variant_generation(uuid, smallint)'::regprocedure);
  IF position('source_upload_question_id' IN _rpc) = 0
     OR position('NULL' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: enqueue RPC does not set upload source / null bank source';
  END IF;
END $prove$;

COMMIT;
