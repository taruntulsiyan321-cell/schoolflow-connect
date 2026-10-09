-- ═══════════════════════════════════════════════════════════════════════════
-- EVERY AI-WRITTEN QUESTION PASSES THE QUALITY GATE BEFORE IT IS STORED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/TODO.md A2. Owner, 2026-10-04: "The quality of the question generated
-- by our AI shall be top-notch … This is the only place where we can't
-- compromise." Until now an AI-written question had to pass an answer check
-- (solved again without its key) and nothing else: a key consistent with the
-- question says nothing about whether the question is good. Measured: case
-- passages carrying data the question never uses, loose match pairings
-- (KNOWN_ISSUES 114 item 2).
--
-- The gate is supabase/functions/_shared/questionGate.ts, against the rubric in
-- _shared/questionRubric.ts: rules decided with no model (a form the real
-- paper does not set, an "all of the above" option, a right option given away
-- by its length), then, each on its own reasoning call, the answer check and a
-- review against every criterion — one right answer, wrong options that tempt,
-- nothing missing or idle, the form done properly, inside the syllabus, worded
-- like the paper.
--
-- This migration makes the gate impossible to skip. AI-written questions reach
-- the bank through exactly two doors (measured: no other function inserts into
-- question_bank), and both now refuse a question without a passing review:
--
-- 1. question_bank.quality_review — the review a question passed, kept on the
--    row (its marks, judged difficulty, what the solves gave, model, time).
-- 2. public._question_rubric_ids() — the rubric's criteria; questionRubric.test.ts
--    holds them equal to RUBRIC in questionRubric.ts. _quality_review_passes()
--    is true only for a review that marks every one of them passed.
-- 3. store_generated_questions (AI Practice, chapter supply, recovery and
--    upload variants) skips an item without a passing quality_review — the
--    last of its checks, so every other refusal keeps its own reason — and
--    stores the review.
-- 4. apply_question_report_verdict refuses a rewrite without one, and stores
--    it on the replacement; a corrected key keeps none (old text, new key).
-- 5. question_gate_outcomes — every draft the gate saw, kept or refused, with
--    why and its marks: the measure A2 is done by, the record A3 audits
--    against and A5's sample page reads. Service role only.
--
-- The 287 AI-written questions stored before today have no review; A3 audits
-- them against the same rubric.
--
-- ROLLBACK: rollback/20261148000000_every_ai_question_passes_the_quality_gate.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The review a question passed ─────────────────────────────────────────

ALTER TABLE public.question_bank ADD COLUMN quality_review jsonb;

COMMENT ON COLUMN public.question_bank.quality_review IS
  'The CBT-rubric review this question passed (20261148000000, _shared/questionGate.ts): {"rubric","passed","marks":[{"criterion","pass","note"}],"difficulty","solved","model","reviewed_at"}. Required for every AI-written question stored from 2026-10-09; NULL for imports and for AI questions stored before the gate (TODO A3 audits them).';

-- ── 2. The rubric's criteria, and what a passing review is ───────────────────

CREATE FUNCTION public._question_rubric_ids()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- RUBRIC in supabase/functions/_shared/questionRubric.ts, held equal by questionRubric.test.ts.
  SELECT ARRAY['one_answer', 'distractors', 'complete', 'form', 'syllabus', 'register']::text[]
$$;

COMMENT ON FUNCTION public._question_rubric_ids() IS
  'The CBT rubric''s criteria (20261148000000) — RUBRIC in _shared/questionRubric.ts, held equal by questionRubric.test.ts.';

CREATE FUNCTION public._quality_review_passes(_review jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _ids  text[] := public._question_rubric_ids();
  _seen text[];
BEGIN
  IF _review IS NULL OR jsonb_typeof(_review) <> 'object' THEN
    RETURN false;
  END IF;
  IF (_review->'passed') IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(_review->'marks') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  -- Every mark passed …
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_review->'marks') m
              WHERE jsonb_typeof(m) <> 'object' OR (m->'pass') IS DISTINCT FROM 'true'::jsonb) THEN
    RETURN false;
  END IF;
  -- … and every criterion of the rubric has one.
  SELECT array_agg(DISTINCT m->>'criterion') INTO _seen FROM jsonb_array_elements(_review->'marks') m;
  RETURN _seen IS NOT NULL AND _ids <@ _seen;
END $$;

COMMENT ON FUNCTION public._quality_review_passes(jsonb) IS
  'True only for a quality review that marks every criterion of the CBT rubric passed (20261148000000).';

REVOKE ALL ON FUNCTION public._question_rubric_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quality_review_passes(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._question_rubric_ids() TO service_role;
GRANT EXECUTE ON FUNCTION public._quality_review_passes(jsonb) TO service_role;

-- ── 3. Every draft the gate saw ─────────────────────────────────────────────

CREATE TABLE public.question_gate_outcomes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  writer        text NOT NULL,
  -- The AI Practice request, the variant's source question (bank or upload), or the reported question.
  ref           uuid,
  exam_id       uuid REFERENCES public.competitive_exams(id) ON DELETE SET NULL,
  subject       text,
  chapter_id    uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  topic_id      uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  form          text NOT NULL,
  question      text NOT NULL,
  options       jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array'),
  correct_index integer NOT NULL,
  stage         text NOT NULL CHECK (stage IN ('kept', 'rule', 'answer', 'review')),
  reason        text,
  failed        text[] NOT NULL DEFAULT '{}',
  review        jsonb,
  -- The bank row a kept draft became; NULL when the door did not store it (a
  -- repeat of one the bank holds) or the run stored nothing (a dry run).
  question_id   uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  CONSTRAINT question_gate_outcomes_writer_known
    CHECK (writer IN ('ai_practice', 'chapter_supply', 'recovery_variant', 'upload_variant', 'report_rewrite')),
  CONSTRAINT question_gate_outcomes_refusal_says_why CHECK ((stage = 'kept') = (reason IS NULL)),
  CONSTRAINT question_gate_outcomes_kept_passed CHECK (stage <> 'kept' OR public._quality_review_passes(review)),
  CONSTRAINT question_gate_outcomes_stored_was_kept CHECK (question_id IS NULL OR stage = 'kept')
);

COMMENT ON TABLE public.question_gate_outcomes IS
  'Every AI-written draft the quality gate saw (20261148000000, _shared/questionGate.ts): kept or refused at a rule, the answer check or the rubric review, with why and the review''s marks. Service role only.';

CREATE INDEX question_gate_outcomes_created ON public.question_gate_outcomes (created_at DESC);
CREATE INDEX question_gate_outcomes_subject_stage ON public.question_gate_outcomes (subject, stage);
CREATE INDEX question_gate_outcomes_ref ON public.question_gate_outcomes (ref);

ALTER TABLE public.question_gate_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_gate_outcomes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.question_gate_outcomes TO service_role;

COMMENT ON COLUMN public.ai_practice_requests.drafts IS
  'What became of the drafts (20261142000000, 20261148000000): {"batches":[{"asked","read","finish","refused":[reason…]}],"drafted","gated","kept"}. Each gated draft, with why it was kept or refused, is a question_gate_outcomes row whose ref is this request. NULL when nothing was written.';

-- ── 4. The two doors ────────────────────────────────────────────────────────

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
  _review    jsonb;
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
      _review    := _item->'quality_review';
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

    -- The quality gate (docs/TODO.md A2, 20261148000000): every AI-written question is reviewed against
    -- the CBT rubric before it is stored (supabase/functions/_shared/questionGate.ts),
    -- and only a review that passed every criterion opens this door. Checked
    -- last, so each check above still refuses for its own reason.
    IF NOT public._quality_review_passes(_review) THEN
      _skipped := _skipped || jsonb_build_object('index', _i, 'reason', 'no passing quality review — an AI-written question is stored only after it passes every criterion of the CBT rubric');
      CONTINUE;
    END IF;
    _seen := _seen || _key;

    INSERT INTO public.question_bank (
      chapter_id, topic_id, chapter, subject, class_level, board, stream, exam_id,
      difficulty, question_format, question, options, correct_index, answer, explanation,
      source, source_type, source_question_id, source_upload_question_id, variant_tier,
      is_approved, is_active, embed_status, quality_review
    ) VALUES (
      _chapter, _topic_id, _ch_name, _subject, _level, _board, _stream, _exam_id,
      _diff, _format, _question, _options, _ci, _answer, _expl,
      _source, 'ai_generated', _src_id, _up_src_id, _tier,
      true, true, 'pending_embed', _review
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
    -- The quality gate (docs/TODO.md A2, 20261148000000): a rewrite is an AI-written question, so it passes
    -- the same quality gate as every other before it replaces anything.
    IF _kind = 'rewrite' AND NOT public._quality_review_passes(_verdict->'quality_review') THEN
      RAISE EXCEPTION 'a rewrite needs a passing quality review';
    END IF;

    -- Out of service first: the same text cannot be live twice
    -- (question_bank_unique_active), and a correction keeps the text.
    UPDATE public.question_bank SET is_active = false WHERE id = _question_id;

    INSERT INTO public.question_bank (
      class_level, subject, chapter, difficulty, question, options, correct_index, explanation,
      source, created_by, is_approved, board, source_type, exam_year, stream, question_format,
      is_active, embedding, embedding_basis, embed_status, chapter_id,
      source_question_id, source_upload_question_id, variant_tier, review_note, answer, topic_id, exam_id,
      quality_review)
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
           q.answer, q.topic_id, q.exam_id,
           -- A corrected key is the old text under a new key: its old review no longer applies.
           CASE WHEN _kind = 'rewrite' THEN _verdict->'quality_review' END
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

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Each proof runs the real doors on a real CUET topic inside a subtransaction
-- that is rolled back on purpose ('proved'), so nothing it writes survives.
-- Every assertion can fail: the refusals are checked by their reasons, and the
-- acceptances by what the stored row holds.

DO $verify$
DECLARE
  _ids  text[] := public._question_rubric_ids();
  _pass jsonb;
BEGIN
  IF cardinality(_ids) <> 6 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the rubric has % criteria, not 6', cardinality(_ids);
  END IF;
  _pass := jsonb_build_object('rubric', 'proof', 'passed', true, 'difficulty', 'medium',
             'marks', (SELECT jsonb_agg(jsonb_build_object('criterion', c, 'pass', true)) FROM unnest(_ids) c));
  IF NOT public._quality_review_passes(_pass) THEN
    RAISE EXCEPTION 'VERIFY FAILED: a review passing every criterion does not pass';
  END IF;
  -- Each way a review can fall short, refused.
  IF public._quality_review_passes(NULL)
     OR public._quality_review_passes('{}'::jsonb)
     OR public._quality_review_passes('[]'::jsonb)
     OR public._quality_review_passes(jsonb_set(_pass, '{passed}', 'false'))
     OR public._quality_review_passes(jsonb_set(_pass, '{passed}', '"true"'))
     OR public._quality_review_passes(jsonb_set(_pass, '{marks,2,pass}', 'false'))
     OR public._quality_review_passes(_pass #- '{marks,5}')
     OR public._quality_review_passes(jsonb_set(_pass, '{marks}', '"all passed"'))
     OR public._quality_review_passes(jsonb_set(_pass, '{marks,0,criterion}', '"distractors"')) THEN
    RAISE EXCEPTION 'VERIFY FAILED: a review that falls short passes';
  END IF;
END $verify$;

DO $verify$
DECLARE
  _ids    text[] := public._question_rubric_ids();
  _pass   jsonb;
  _topic  uuid;
  _exam   uuid;
  _user   uuid;
  _r      jsonb;
  _qid    uuid;
  _new    uuid;
  _row    public.question_bank%ROWTYPE;
  _item   jsonb;
  _err    text;
BEGIN
  _pass := jsonb_build_object('rubric', 'proof', 'passed', true, 'difficulty', 'medium',
             'marks', (SELECT jsonb_agg(jsonb_build_object('criterion', c, 'pass', true)) FROM unnest(_ids) c));
  SELECT t.id, s.exam_id INTO _topic, _exam
    FROM public.topics t
    JOIN public.exam_syllabus_chapters s ON s.chapter_id = t.chapter_id
    JOIN public.competitive_exams e ON e.id = s.exam_id
   WHERE e.code = 'cuet'
   ORDER BY t.id
   LIMIT 1;
  SELECT id INTO _user FROM auth.users ORDER BY created_at LIMIT 1;
  IF _topic IS NULL OR _user IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: no CUET topic or user to prove the doors on';
  END IF;
  _item := jsonb_build_object(
    'topic_id', _topic, 'exam_id', _exam, 'difficulty', 'medium', 'source', 'ai_practice',
    'question', 'Quality gate proof ' || gen_random_uuid() || ': which of these is the proof''s answer?',
    'options', jsonb_build_array('First proof option', 'Second proof option', 'Third proof option', 'Fourth proof option'),
    'correct_index', 1,
    'explanation', 'Proof only.');

  BEGIN
    -- The store door: no review, a failing review — skipped, saying why.
    _r := public.store_generated_questions(jsonb_build_array(
      _item,
      _item || jsonb_build_object('quality_review', jsonb_set(_pass, '{marks,1,pass}', 'false'))));
    IF (_r->>'inserted_count')::int <> 0 OR (_r->>'skipped_count')::int <> 2
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(_r->'skipped') k
                   WHERE k->>'reason' NOT LIKE 'no passing quality review%') THEN
      RAISE EXCEPTION 'VERIFY FAILED: the store door let in a question without a passing review: %', _r;
    END IF;

    -- The review is the door's last check: a question that fails an earlier one
    -- is still refused for that, so each earlier check keeps its meaning.
    _r := public.store_generated_questions(jsonb_build_array(_item || jsonb_build_object('correct_index', 9)));
    IF (_r->'skipped'->0->>'reason') NOT LIKE 'correct_index 9 is not one of the 4 options%' THEN
      RAISE EXCEPTION 'VERIFY FAILED: the review check runs before the door''s own checks: %', _r;
    END IF;

    -- A passing review — stored, with the review on the row.
    _r := public.store_generated_questions(jsonb_build_array(_item || jsonb_build_object('quality_review', _pass)));
    IF (_r->>'inserted_count')::int <> 1 THEN
      RAISE EXCEPTION 'VERIFY FAILED: the store door refused a question with a passing review: %', _r;
    END IF;
    _qid := (_r->'inserted'->0->>'id')::uuid;
    SELECT * INTO _row FROM public.question_bank WHERE id = _qid;
    IF _row.quality_review IS DISTINCT FROM _pass THEN
      RAISE EXCEPTION 'VERIFY FAILED: the stored question does not keep its review';
    END IF;

    -- The report door: a rewrite without a passing review is refused.
    INSERT INTO public.question_reports (user_id, question_id, reason, note, question_text, options, status, checked_at)
    VALUES (_user, _qid, 'question_error', 'proof', _row.question, _row.options, 'checking', now());
    BEGIN
      PERFORM public.apply_question_report_verdict(_qid, jsonb_build_object(
        'kind', 'rewrite', 'outcome', 'Proof.',
        'reports', (SELECT jsonb_agg(jsonb_build_object('id', id)) FROM public.question_reports WHERE question_id = _qid),
        'question', 'Quality gate proof rewrite ' || gen_random_uuid(),
        'options', jsonb_build_array('Rewritten first', 'Rewritten second', 'Rewritten third', 'Rewritten fourth'),
        'correct_index', 2,
        'explanation', _row.explanation));
      _err := 'none';
    EXCEPTION WHEN raise_exception THEN
      _err := SQLERRM;
    END;
    IF _err <> 'a rewrite needs a passing quality review' THEN
      RAISE EXCEPTION 'VERIFY FAILED: a rewrite without a review was not refused for it (%)', _err;
    END IF;

    -- With a passing review the rewrite replaces the question, and keeps it.
    _r := public.apply_question_report_verdict(_qid, jsonb_build_object(
      'kind', 'rewrite', 'outcome', 'Proof.', 'note', 'Proof.',
      'reports', (SELECT jsonb_agg(jsonb_build_object('id', id)) FROM public.question_reports WHERE question_id = _qid),
      'question', 'Quality gate proof rewrite ' || gen_random_uuid(),
      'options', jsonb_build_array('Rewritten first', 'Rewritten second', 'Rewritten third', 'Rewritten fourth'),
      'correct_index', 2,
      'explanation', concat_ws(E'\n',
        'Answer: (C) Rewritten third', '',
        'This is the working of the quality gate proof, written out in full. It is long enough to count as working, and it says nothing else of any use.', '',
        'Why the other options are wrong:',
        '(A) The first option is wrong for the proof''s own reason.',
        '(B) The second option is wrong for the proof''s own reason.',
        '(D) The fourth option is wrong for the proof''s own reason.'),
      'quality_review', _pass));
    _new := (_r->>'replacement')::uuid;
    IF _new IS NULL OR (SELECT quality_review FROM public.question_bank WHERE id = _new) IS DISTINCT FROM _pass
       OR (SELECT is_active FROM public.question_bank WHERE id = _qid) THEN
      RAISE EXCEPTION 'VERIFY FAILED: a reviewed rewrite did not replace the question with its review: %', _r;
    END IF;

    -- A corrected key is the old text under a new key: the replacement keeps no review.
    INSERT INTO public.question_reports (user_id, question_id, reason, claimed_index, question_text, options, status, checked_at)
    SELECT _user, _new, 'wrong_answer', 0, question, options, 'checking', now() FROM public.question_bank WHERE id = _new;
    _r := public.apply_question_report_verdict(_new, jsonb_build_object(
      'kind', 'correct_key', 'outcome', 'Proof.', 'note', 'Proof.',
      'reports', (SELECT jsonb_agg(jsonb_build_object('id', id)) FROM public.question_reports WHERE question_id = _new),
      'correct_index', 0,
      'explanation', concat_ws(E'\n',
        'Answer: (A) Rewritten first', '',
        'This is the working of the quality gate proof, written out in full. It is long enough to count as working, and it says nothing else of any use.', '',
        'Why the other options are wrong:',
        '(B) The second option is wrong for the proof''s own reason.',
        '(C) The third option is wrong for the proof''s own reason.',
        '(D) The fourth option is wrong for the proof''s own reason.')));
    IF (_r->>'replacement') IS NULL
       OR (SELECT quality_review FROM public.question_bank WHERE id = (_r->>'replacement')::uuid) IS NOT NULL THEN
      RAISE EXCEPTION 'VERIFY FAILED: a corrected key kept the old text''s review: %', _r;
    END IF;

    RAISE EXCEPTION 'proved';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proved' THEN RAISE; END IF;
  END;
END $verify$;

DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.question_gate_outcomes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.question_gate_outcomes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.question_gate_outcomes', 'INSERT') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a signed-in user or anon can reach the gate''s record';
  END IF;
  IF has_function_privilege('anon', 'public._quality_review_passes(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._quality_review_passes(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._question_rubric_ids()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the rubric helpers are open to callers';
  END IF;
  IF has_function_privilege('authenticated', 'public.store_generated_questions(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_question_report_verdict(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a signed-in user can open a bank door';
  END IF;
END $verify$;

COMMIT;
