-- ═══════════════════════════════════════════════════════════════════════════
-- AI PRACTICE, AND EXPLANATIONS THAT EXPLAIN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ruled by the owner 2026-10-02.
--
-- 1. EVERY QUESTION CARRIES A PROPER EXPLANATION. Measured that day: of the
--    1,124 active CUET questions the median explanation was 37 characters,
--    and 795 (71%) were under 80 — most of them the words "Answer (a) — from
--    chapter answer key." The ruling: the working, step by step, and for each
--    wrong option, why it is wrong.
--
--    public.explanation_is_proper(explanation, correct_index, option_count) is
--    the ONE definition of that, in this exact shape:
--
--        Answer: (B) <the right option>
--
--        <the working: at least 120 characters>
--
--        Why the other options are wrong:
--        (A) <at least 25 characters>
--        (C) …
--        (D) …
--
--    supabase/functions/_shared/explanationFormat.ts writes the shape;
--    explanationFormat.test.ts holds the two to each other. A trigger keeps
--    question_bank.explanation_status at 'proper' or 'pending' as a question's
--    text, options, key or explanation change. The cron job
--    'rewrite-question-explanations' hands pending exam questions to the
--    question-explanations function, which solves each one WITHOUT the key
--    first: if it agrees, it writes the explanation; if not, the question is
--    'disputed' and keeps its old explanation for the owner to look at.
--
-- 2. AI PRACTICE. A student asks in their own words ("20 medium questions on
--    goodwill"); the ai-practice function serves the bank's matching questions
--    first and writes only the shortfall. Every written question is solved a
--    second time, independently, and kept only if the two agree; it then
--    enters the shared bank through store_generated_questions — the one door
--    for generated questions — which now accepts the exam a question is
--    written for (it had no way to file a question with no source under an
--    exam, so a CUET student could not have been served one).
--    ai_practice_requests is the student's log of what they asked and got.
--
-- 3. LIMITS (owner: every feature has one). ai_practice.request — 2 a day on
--    the free plan, unlimited on paid plans. question_mark.voice_note — the
--    voice notes added by 20261137000000: 10 a day free, unlimited paid,
--    counted by a trigger on question_marks.
--
-- 4. topics.origin: 'ai_drafted' marks a topic list AI Practice drafted for a
--    syllabus chapter that had none (32 of CUET's 61, measured 2026-10-02), so
--    the owner can review every one.
--
-- ROLLBACK: rollback/20261138000000_ai_practice_and_explanations_that_explain.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. What a proper explanation is ────────────────────────────────────────
CREATE FUNCTION public.explanation_is_proper(_explanation text, _correct_index integer, _option_count integer)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
DECLARE
  _letters constant text := 'ABCDEFGH';
  _heading constant text := E'\n\nWhy the other options are wrong:\n';
  _right   text;
  _head    text;
  _wrong   text;
  _working text;
  _i       integer;
BEGIN
  IF _explanation IS NULL OR _correct_index IS NULL OR _option_count IS NULL
     OR _option_count < 2 OR _option_count > 8
     OR _correct_index < 0 OR _correct_index >= _option_count THEN
    RETURN false;
  END IF;
  _right := substr(_letters, _correct_index + 1, 1);
  IF _explanation !~ ('^Answer: \(' || _right || '\) \S') THEN
    RETURN false;
  END IF;
  IF position(_heading IN _explanation) = 0 THEN
    RETURN false;
  END IF;
  _head  := split_part(_explanation, _heading, 1);
  _wrong := split_part(_explanation, _heading, 2);
  IF position(E'\n' IN _head) = 0 THEN
    RETURN false;
  END IF;
  _working := btrim(substr(_head, position(E'\n' IN _head) + 1));
  IF char_length(_working) < 120 THEN
    RETURN false;
  END IF;
  FOR _i IN 0 .. _option_count - 1 LOOP
    CONTINUE WHEN _i = _correct_index;
    IF _wrong !~ ('(^|\n)\(' || substr(_letters, _i + 1, 1) || '\) [^\n]{25,}') THEN
      RETURN false;
    END IF;
  END LOOP;
  IF _wrong ~ ('(^|\n)\(' || _right || '\) ') THEN
    RETURN false;
  END IF;
  -- Nor a line for an option the question does not have.
  IF _option_count < 8
     AND _wrong ~ ('(^|\n)\([' || substr(_letters, _option_count + 1) || ']\) ') THEN
    RETURN false;
  END IF;
  RETURN true;
END $fn$;

COMMENT ON FUNCTION public.explanation_is_proper(text, integer, integer) IS
  'The one definition of a proper explanation (20261138000000): the answer line, the working (>=120 chars), and a line of >=25 chars for every wrong option.';

GRANT EXECUTE ON FUNCTION public.explanation_is_proper(text, integer, integer) TO authenticated, service_role;

-- ── 2. Every question knows whether its explanation is one ─────────────────
ALTER TABLE public.question_bank
  ADD COLUMN explanation_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT question_bank_explanation_status_check
    CHECK (explanation_status IN ('proper', 'pending', 'rewriting', 'disputed', 'failed')),
  ADD COLUMN explanation_claimed_at timestamptz;

COMMENT ON COLUMN public.question_bank.explanation_status IS
  'proper: passes explanation_is_proper. pending: does not, waiting for question-explanations. rewriting: claimed by it. disputed: its solver disagreed with the key (old explanation kept). failed: it could not write one.';

CREATE FUNCTION public._question_bank_explanation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- Only what the status depends on can change it: a 'disputed' question
  -- stays disputed through an edit to its difficulty, not through a new key.
  IF TG_OP = 'UPDATE'
     AND NEW.question      IS NOT DISTINCT FROM OLD.question
     AND NEW.options       IS NOT DISTINCT FROM OLD.options
     AND NEW.correct_index IS NOT DISTINCT FROM OLD.correct_index
     AND NEW.explanation   IS NOT DISTINCT FROM OLD.explanation THEN
    RETURN NEW;
  END IF;
  NEW.explanation_status := CASE
    WHEN public.explanation_is_proper(
           NEW.explanation, NEW.correct_index,
           CASE WHEN jsonb_typeof(NEW.options) = 'array' THEN jsonb_array_length(NEW.options) END)
    THEN 'proper' ELSE 'pending' END;
  NEW.explanation_claimed_at := NULL;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_question_bank_explanation_status
  BEFORE INSERT OR UPDATE OF question, options, correct_index, explanation ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public._question_bank_explanation_status();

-- Every row as it stands today (status-only, so the trigger above stays out of it).
UPDATE public.question_bank
   SET explanation_status = CASE
     WHEN public.explanation_is_proper(
            explanation, correct_index,
            CASE WHEN jsonb_typeof(options) = 'array' THEN jsonb_array_length(options) END)
     THEN 'proper' ELSE 'pending' END;

CREATE INDEX question_bank_explanation_queue_idx
  ON public.question_bank (explanation_status, id)
  WHERE explanation_status IN ('pending', 'rewriting') AND is_active AND exam_id IS NOT NULL;

-- ── 3. The rewrite queue: claim, so overlapping runs never take the same row ─
CREATE FUNCTION public.claim_explanation_rewrites(_limit integer)
RETURNS TABLE (id uuid, subject text, chapter text, topic text, question text, options jsonb, correct_index integer, explanation text)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- A run that died holding rows gives them back after 15 minutes.
  UPDATE public.question_bank q
     SET explanation_status = 'pending', explanation_claimed_at = NULL
   WHERE q.explanation_status = 'rewriting'
     AND q.explanation_claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH c AS (
    SELECT q.id AS qid
      FROM public.question_bank q
     WHERE q.explanation_status = 'pending'
       AND q.is_active
       AND q.exam_id IS NOT NULL
       AND q.correct_index IS NOT NULL
       AND jsonb_typeof(q.options) = 'array'
       AND jsonb_array_length(q.options) BETWEEN 2 AND 8
     ORDER BY q.id
     LIMIT greatest(1, least(_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.question_bank qb
       SET explanation_status = 'rewriting', explanation_claimed_at = now()
      FROM c
     WHERE qb.id = c.qid
    RETURNING qb.id AS rid, qb.subject AS rsubject, qb.chapter AS rchapter, qb.topic_id AS rtopic,
              qb.question AS rquestion, qb.options AS roptions, qb.correct_index AS rindex, qb.explanation AS rexpl
  )
  SELECT u.rid, u.rsubject, u.rchapter, t.name, u.rquestion, u.roptions, u.rindex, u.rexpl
    FROM u LEFT JOIN public.topics t ON t.id = u.rtopic;
END $fn$;

REVOKE ALL ON FUNCTION public.claim_explanation_rewrites(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_explanation_rewrites(integer) TO service_role;

-- ── 4. The cron hand-off, the way dispatch_question_embedding does it ───────
CREATE FUNCTION public.dispatch_explanation_rewrite()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _drain   text;
  _pending integer;
  _batch   constant integer := 12;
BEGIN
  SELECT count(*) INTO _pending
    FROM public.question_bank q
   WHERE q.explanation_status IN ('pending', 'rewriting')
     AND q.is_active AND q.exam_id IS NOT NULL
     AND q.correct_index IS NOT NULL AND jsonb_typeof(q.options) = 'array';
  IF _pending = 0 THEN RETURN 0; END IF;

  SELECT decrypted_secret INTO _drain
    FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain';
  IF _drain IS NULL THEN
    RAISE WARNING 'dispatch_explanation_rewrite: vault secret variant_generation_drain is missing; % question(s) wait', _pending;
    RETURN 0;
  END IF;

  PERFORM net.http_post(
    url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/question-explanations',
    body := jsonb_build_object('limit', _batch),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-variant-drain', _drain),
    timeout_milliseconds := 150000
  );
  RETURN least(_pending, _batch);
END $fn$;

REVOKE ALL ON FUNCTION public.dispatch_explanation_rewrite() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('rewrite-question-explanations', '* * * * *', 'SELECT public.dispatch_explanation_rewrite()');

-- ── 5. A topic AI Practice drafted is marked as one ─────────────────────────
ALTER TABLE public.topics
  ADD COLUMN origin text NOT NULL DEFAULT 'curriculum'
    CONSTRAINT topics_origin_check CHECK (origin IN ('curriculum', 'ai_drafted'));

COMMENT ON COLUMN public.topics.origin IS
  'ai_drafted: drafted by AI Practice for a syllabus chapter that had no topics (20261138000000) — for the owner to review.';

-- ── 6. Explain my mistake starts over ───────────────────────────────────────
-- ai-explain cached answers written to "a short coaching explanation" by "a
-- Mathematics and Science tutor for Class 6–12"; its prompt now asks for the
-- whole working and a line per wrong option, for the student's own subject.
-- The 5 cached rows (2026-10-02) would be served instead of the new answer.
DELETE FROM public.ai_explanations;

-- ── 7. Generated questions can be filed under the exam they were written for ─

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

REVOKE ALL ON FUNCTION public.store_generated_questions(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_generated_questions(jsonb) TO service_role;

-- ── 8. Limits (owner: every feature has one) ───────────────────────────────
INSERT INTO public.premium_features (code, description) VALUES
  ('ai_practice.request', 'An AI Practice request: questions found in the bank or written by AI for what the student asked.'),
  ('question_mark.voice_note', 'A voice note recorded on a marked question.');

INSERT INTO public.premium_limits (tier_code, feature_code, period, max_uses) VALUES
  ('free',     'ai_practice.request',      'day', 2),
  ('starter',  'ai_practice.request',      'day', NULL),
  ('standard', 'ai_practice.request',      'day', NULL),
  ('premium',  'ai_practice.request',      'day', NULL),
  ('free',     'question_mark.voice_note', 'day', 10),
  ('starter',  'question_mark.voice_note', 'day', NULL),
  ('standard', 'question_mark.voice_note', 'day', NULL),
  ('premium',  'question_mark.voice_note', 'day', NULL);

-- A voice note counts when a mark gains a new recording. SECURITY DEFINER
-- because the plan check is the owner's (_premium_require is revoked from
-- students); it counts the caller and nobody else, and a refusal raises
-- plan_limit:question_mark.voice_note, which the app turns into a sentence.
CREATE FUNCTION public._question_marks_voice_note_counted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.voice_path IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.voice_path IS DISTINCT FROM OLD.voice_path)
     AND auth.uid() IS NOT NULL THEN
    PERFORM public._premium_require(auth.uid(), 'question_mark.voice_note', 1, true);
  END IF;
  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public._question_marks_voice_note_counted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER question_marks_voice_note_counted
  BEFORE INSERT OR UPDATE OF voice_path ON public.question_marks
  FOR EACH ROW EXECUTE FUNCTION public._question_marks_voice_note_counted();

-- ── 9. What each student asked AI Practice for, and what they got ──────────
CREATE TABLE public.ai_practice_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt        text NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 3 AND 500),
  subject       text,
  chapter_id    uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  topic_id      uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  difficulty    text CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
  requested     integer NOT NULL CHECK (requested BETWEEN 1 AND 30),
  question_ids  uuid[] NOT NULL DEFAULT '{}',
  from_bank     integer NOT NULL DEFAULT 0 CHECK (from_bank >= 0),
  written       integer NOT NULL DEFAULT 0 CHECK (written >= 0),
  discarded     integer NOT NULL DEFAULT 0 CHECK (discarded >= 0),
  status        text NOT NULL CHECK (status IN ('ready', 'short', 'refused', 'failed')),
  message       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_practice_requests_user_idx ON public.ai_practice_requests (user_id, created_at DESC);

COMMENT ON TABLE public.ai_practice_requests IS
  'AI Practice (20261138000000): the request in the student''s words, what it was read as, and the questions served. Written by the ai-practice function only.';

ALTER TABLE public.ai_practice_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_practice_requests_owner_reads ON public.ai_practice_requests
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.ai_practice_requests FROM anon, authenticated;
GRANT SELECT ON public.ai_practice_requests TO authenticated;

-- ── 10. The bank first: what already answers a request ──────────────────────
-- Active, approved, keyed questions of the exam in that chapter (and topic),
-- not answered by this student in the last 30 days, nearest the request's
-- meaning first when there is a vector to rank by. Recovery variants are
-- recovery's, not practice's.
CREATE FUNCTION public.ai_practice_bank_candidates(
  _user uuid, _exam uuid, _chapter uuid, _topic uuid, _difficulty text, _query vector, _limit integer)
RETURNS TABLE (id uuid, similarity double precision, topic_id uuid, difficulty text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT qb.id,
         CASE WHEN _query IS NULL OR qb.embedding IS NULL THEN NULL
              ELSE 1 - (qb.embedding <=> _query) END,
         qb.topic_id,
         qb.difficulty
    FROM public.question_bank qb
   WHERE qb.exam_id = _exam
     AND qb.chapter_id = _chapter
     AND (_topic IS NULL OR qb.topic_id = _topic)
     AND (_difficulty IS NULL OR qb.difficulty = _difficulty)
     AND qb.is_active AND qb.is_approved
     AND qb.replaced_by_question_id IS NULL
     AND qb.variant_tier IS NULL
     AND qb.correct_index IS NOT NULL
     AND jsonb_typeof(qb.options) = 'array'
     AND NOT EXISTS (
       SELECT 1 FROM public.question_attempts qa
        WHERE qa.user_id = _user AND qa.bank_question_id = qb.id
          AND qa.created_at > now() - interval '30 days')
   ORDER BY CASE WHEN _query IS NULL OR qb.embedding IS NULL THEN 1 ELSE 0 END,
            qb.embedding <=> _query,
            md5(qb.id::text || current_date::text)
   LIMIT greatest(1, least(_limit, 200));
$fn$;

REVOKE ALL ON FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, vector, integer) TO service_role;

-- ── VERIFY: the shape (must be able to fail) ────────────────────────────────
DO $verify$
DECLARE
  _n integer; _p integer;
BEGIN
  SELECT count(*) FILTER (WHERE explanation_status = 'pending'), count(*) FILTER (WHERE explanation_status = 'proper')
    INTO _n, _p
    FROM public.question_bank WHERE is_active AND exam_id IS NOT NULL;
  IF _n < 1000 THEN
    RAISE EXCEPTION 'VERIFY FAILED: expected the CUET bank''s short explanations to be pending, found % pending (% proper)', _n, _p;
  END IF;
  IF EXISTS (SELECT 1 FROM public.question_bank
              WHERE explanation_status = 'proper'
                AND NOT public.explanation_is_proper(explanation, correct_index,
                      CASE WHEN jsonb_typeof(options) = 'array' THEN jsonb_array_length(options) END)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: a row is marked proper that the rule refuses';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rewrite-question-explanations' AND active) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the rewrite job is not scheduled';
  END IF;
  IF (SELECT count(*) FROM public.premium_limits WHERE feature_code IN ('ai_practice.request', 'question_mark.voice_note')) <> 8 THEN
    RAISE EXCEPTION 'VERIFY FAILED: every plan needs a limit row for both new features';
  END IF;
  IF has_function_privilege('authenticated', 'public.store_generated_questions(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_explanation_rewrites(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, vector, integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.ai_practice_requests', 'INSERT')
     OR has_table_privilege('anon', 'public.ai_practice_requests', 'SELECT') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a student can reach a server-only door';
  END IF;
END $verify$;

-- ── PROOF: behaviour, as real accounts where it matters; rolled back ────────
DO $proof$
DECLARE
  _fixture constant text := E'Answer: (B) ₹30,000\n\nWhen there is no partnership deed, the Indian Partnership Act, 1932 applies. Section 13(d) allows interest on a partner''s loan at 6% per annum, so the interest is ₹5,00,000 × 6/100 × 1 = ₹30,000.\n\nWhy the other options are wrong:\n(A) ₹20,000 is interest at 4%; the Act fixes the rate at 6% per annum, not 4%.\n(C) ₹40,000 is interest at 8%, a rate the Act does not provide for partners'' loans.\n(D) Interest on a partner''s loan is payable even without a deed; it is interest on capital that is not allowed.';
  _exam constant uuid := '5a78f1f8-cf43-4631-a9de-4abc7d6a8d9d';
  _fail text := '';
  _sentinel constant text := 'm20261138 proof rolled back';
  _a uuid; _b uuid; _q uuid; _qt text; _seen uuid; _seen_ch uuid;
  _qid uuid; _st text; _n integer; _r jsonb; _topic uuid; _other_topic uuid; _id uuid;
BEGIN
  -- 1. The rule, against its own fixture and against each way to break it.
  IF NOT public.explanation_is_proper(_fixture, 1, 4) THEN _fail := _fail || ' [1 fixture refused]'; END IF;
  IF public.explanation_is_proper(replace(_fixture, 'Answer: (B)', 'Answer: (C)'), 1, 4) THEN _fail := _fail || ' [1 wrong answer letter accepted]'; END IF;
  IF public.explanation_is_proper(regexp_replace(_fixture, E'\\n\\(C\\)[^\\n]*', ''), 1, 4) THEN _fail := _fail || ' [1 a missing wrong option accepted]'; END IF;
  IF public.explanation_is_proper(E'Answer: (B) ₹30,000\n\nInterest is 6%.\n\nWhy the other options are wrong:\n(A) ₹20,000 is interest at 4%, not the 6% the Act fixes.\n(C) ₹40,000 is interest at 8%, which the Act does not allow.\n(D) Interest on a partner''s loan is payable even without a deed.', 1, 4) THEN _fail := _fail || ' [1 one-line working accepted]'; END IF;
  IF public.explanation_is_proper(_fixture || E'\n(B) ₹30,000 is the answer, as shown in the working above.', 1, 4) THEN _fail := _fail || ' [1 the right option listed as wrong accepted]'; END IF;
  IF public.explanation_is_proper('Answer (a) — from chapter answer key.', 0, 4) THEN _fail := _fail || ' [1 the bank''s answer-key line accepted]'; END IF;
  IF public.explanation_is_proper(_fixture, 1, 3) THEN _fail := _fail || ' [1 a line for an option that does not exist accepted]'; END IF;

  -- Fixtures: an exam account with a bank mistake, a second account, a question
  -- the first answered lately, and a 4-option CUET question keyed (B).
  SELECT m.user_id, m.question_id, m.question_text INTO _a, _q, _qt
    FROM public.student_mistakes m
    JOIN public.memberships ms ON ms.account_id = m.user_id
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE m.source = 'practice' AND m.question_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.question_bank b WHERE b.id = m.question_id)
   ORDER BY m.last_wrong_at DESC, m.id LIMIT 1;
  SELECT ms.account_id INTO _b
    FROM public.memberships ms JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE ms.account_id <> _a ORDER BY ms.account_id LIMIT 1;
  SELECT qa.bank_question_id, qb.chapter_id INTO _seen, _seen_ch
    FROM public.question_attempts qa JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qa.user_id = _a AND qa.created_at > now() - interval '20 days'
     AND qb.exam_id = _exam AND qb.is_active AND qb.is_approved AND qb.variant_tier IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_attempts q2 WHERE q2.user_id = _b AND q2.bank_question_id = qb.id)
   ORDER BY qa.created_at DESC LIMIT 1;
  SELECT id INTO _qid FROM public.question_bank
   WHERE exam_id = _exam AND is_active AND correct_index = 1 AND topic_id IS NOT NULL
     AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4
   ORDER BY id LIMIT 1;
  SELECT topic_id INTO _topic FROM public.question_bank
   WHERE exam_id = _exam AND is_active AND topic_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT t.id INTO _other_topic FROM public.topics t
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_syllabus_chapters s WHERE s.exam_id = _exam AND s.chapter_id = t.chapter_id)
   ORDER BY t.id LIMIT 1;
  IF _a IS NULL OR _b IS NULL OR _seen IS NULL OR _qid IS NULL OR _topic IS NULL OR _other_topic IS NULL THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (a % b % seen % q % topic % other %)', _a, _b, _seen, _qid, _topic, _other_topic;
  END IF;

  BEGIN
    -- 2. The trigger keeps the status.
    UPDATE public.question_bank SET explanation = _fixture WHERE id = _qid RETURNING explanation_status INTO _st;
    IF _st <> 'proper' THEN _fail := _fail || ' [2 a proper explanation left ' || _st || ']'; END IF;
    UPDATE public.question_bank SET explanation = 'Short.' WHERE id = _qid RETURNING explanation_status INTO _st;
    IF _st <> 'pending' THEN _fail := _fail || ' [2 a short explanation left ' || _st || ']'; END IF;
    UPDATE public.question_bank SET explanation_status = 'disputed' WHERE id = _qid;
    UPDATE public.question_bank SET difficulty = difficulty, explanation = explanation WHERE id = _qid RETURNING explanation_status INTO _st;
    IF _st <> 'disputed' THEN _fail := _fail || ' [2 an edit that changed nothing undid a dispute: ' || _st || ']'; END IF;
    UPDATE public.question_bank SET explanation = _fixture WHERE id = _qid RETURNING explanation_status INTO _st;
    IF _st <> 'proper' THEN _fail := _fail || ' [2 a new explanation did not settle a dispute: ' || _st || ']'; END IF;

    -- 3. Claims never hand the same row out twice; an abandoned claim comes back.
    SELECT count(*) INTO _n FROM public.claim_explanation_rewrites(3);
    IF _n <> 3 THEN _fail := _fail || format(' [3 claimed %s of 3]', _n); END IF;
    PERFORM public.claim_explanation_rewrites(3);
    UPDATE public.question_bank SET explanation_claimed_at = now() - interval '1 hour' WHERE explanation_status = 'rewriting';
    SELECT count(*) INTO _n FROM public.question_bank WHERE explanation_status = 'rewriting';
    IF _n <> 6 THEN _fail := _fail || format(' [3 two claims of 3 hold %s rows, not 6]', _n); END IF;
    PERFORM public.claim_explanation_rewrites(1);
    SELECT count(*) INTO _n FROM public.question_bank WHERE explanation_status = 'rewriting';
    IF _n <> 1 THEN _fail := _fail || format(' [3 abandoned claims were not given back: %s held]', _n); END IF;

    -- 4. The one door files a question under the exam it was written for.
    _r := public.store_generated_questions(jsonb_build_array(
      jsonb_build_object('topic_id', _topic, 'exam_id', _exam, 'question', 'Probe 20261138: which rate of interest does the Act allow on a partner''s loan?',
        'options', jsonb_build_array('₹20,000', '₹30,000', '₹40,000', 'No interest is payable'), 'correct_index', 1,
        'explanation', _fixture, 'difficulty', 'medium', 'source', 'ai_practice'),
      jsonb_build_object('topic_id', _other_topic, 'exam_id', _exam, 'question', 'Probe 20261138: outside the syllabus',
        'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct_index', 0, 'difficulty', 'medium', 'source', 'ai_practice'),
      jsonb_build_object('source_question_id', _qid, 'exam_id', _exam, 'variant_tier', 1, 'question', 'Probe 20261138: a variant naming an exam',
        'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct_index', 0, 'difficulty', 'medium', 'source', 'ai_practice')));
    IF (_r->>'inserted_count')::int <> 1 OR (_r->>'skipped_count')::int <> 2 THEN
      _fail := _fail || ' [4 ' || _r::text || ']';
    ELSE
      _id := (_r->'inserted'->0->>'id')::uuid;
      IF (_r->'inserted'->0->>'explanation_status') <> 'proper' THEN _fail := _fail || ' [4 the stored explanation is not proper]'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.question_bank WHERE id = _id AND exam_id = _exam AND board = 'cuet'
                       AND class_level = 12 AND source_type = 'ai_generated' AND topic_id = _topic AND is_approved) THEN
        _fail := _fail || ' [4 the stored question is not a CUET bank question]';
      END IF;
      IF (_r->'skipped'->0->>'reason') NOT LIKE '%not in that exam''s syllabus%'
         OR (_r->'skipped'->1->>'reason') NOT LIKE '%variant takes its source%' THEN
        _fail := _fail || ' [4 skip reasons ' || (_r->'skipped')::text || ']';
      END IF;
      -- …and a student of that exam is served it.
      PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      SELECT count(*) INTO _n FROM public.question_bank_student WHERE id = _id;
      EXECUTE 'RESET ROLE';
      IF _n <> 1 THEN _fail := _fail || ' [4 the exam''s student cannot see the question written for it]'; END IF;
    END IF;

    -- 5. Limits: the free plan's third AI Practice request of the day is over.
    PERFORM public._premium_decide(_a, 'ai_practice.request', 1, true);
    PERFORM public._premium_decide(_a, 'ai_practice.request', 1, true);
    _r := public._premium_decide(_a, 'ai_practice.request', 1, true);
    IF (_r->>'tier') = 'free' THEN
      IF (_r->>'limit')::int <> 2 OR coalesce(_r->>'would_deny', _r->>'reason') IS DISTINCT FROM 'limit_reached' THEN
        _fail := _fail || ' [5 a free third request ' || _r::text || ']';
      END IF;
    ELSIF _r->>'limit' IS NOT NULL THEN
      _fail := _fail || ' [5 a paid plan is limited ' || _r::text || ']';
    END IF;
    -- A voice note on a mark is counted, as the student.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.question_marks (bank_question_id, question_text, tags, voice_path, voice_seconds)
    VALUES (_q, _qt, ARRAY['recall'], _a::text || '/probe.webm', 5);
    EXECUTE 'RESET ROLE';
    SELECT used INTO _n FROM public.premium_usage
     WHERE account_id = _a AND feature_code = 'question_mark.voice_note'
       AND period_key = public._premium_period_key('day', now());
    IF coalesce(_n, 0) < 1 THEN _fail := _fail || ' [5 a voice note was not counted]'; END IF;

    -- 6. The request log is the student's to read and nobody's to write.
    INSERT INTO public.ai_practice_requests (user_id, prompt, requested, status) VALUES (_a, 'probe request', 5, 'ready');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO _n FROM public.ai_practice_requests WHERE prompt = 'probe request';
    IF _n <> 1 THEN _fail := _fail || ' [6 the owner cannot read their request]'; END IF;
    BEGIN
      INSERT INTO public.ai_practice_requests (user_id, prompt, requested, status) VALUES (_a, 'forged', 5, 'ready');
      _fail := _fail || ' [6 a student wrote their own request row]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO _n FROM public.ai_practice_requests WHERE prompt = 'probe request';
    IF _n <> 0 THEN _fail := _fail || ' [6 another student reads the request]'; END IF;
    EXECUTE 'RESET ROLE';

    -- 7. The bank first, minus what this student answered lately.
    SELECT count(*) INTO _n FROM public.ai_practice_bank_candidates(_a, _exam, _seen_ch, NULL, NULL, NULL, 200) c WHERE c.id = _seen;
    IF _n <> 0 THEN _fail := _fail || ' [7 a question answered this month was served again]'; END IF;
    SELECT count(*) INTO _n FROM public.ai_practice_bank_candidates(_b, _exam, _seen_ch, NULL, NULL, NULL, 200) c WHERE c.id = _seen;
    IF _n <> 1 THEN _fail := _fail || ' [7 control: a student who has not seen it is not offered it]'; END IF;

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
