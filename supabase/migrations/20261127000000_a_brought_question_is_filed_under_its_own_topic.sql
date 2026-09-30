-- ═══════════════════════════════════════════════════════════════════════════
-- A BROUGHT QUESTION IS FILED UNDER ITS OWN TOPIC
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found while merging the twin topics (20261126000000). A student's practice
-- analytics listed "Money and Banking" beside "Money and banking": eight
-- Custom Practice attempts had been filed under the CHAPTER's name, while
-- their upload questions carry the topic "Money and banking".
--
-- The writer. rpc_record_question_attempt files a BANK attempt under the
-- bank's topic — "the bank's topic, and nothing the client said". An attempt
-- on a question the student brought (an upload or a capture) takes the other
-- path, where the topic is whatever the client sent, else the chapter:
--
--     _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _chapter);
--
-- The app sends no topic for a brought question — only its upload_question_id
-- or capture_question_id, in the attempt's JSON — so every such attempt was
-- filed under its chapter's name. 20261126000000 respelled the ones already
-- written; without this, the next upload attempt in that chapter splits the
-- panel again.
--
-- Now a brought question's attempt is filed under THAT question's topic, read
-- from its own row — the caller's own upload or capture only — exactly as a
-- bank attempt is filed under the bank's. What the client sent, then the
-- chapter, remain the fallback for a question with no topic.
--
-- One line of the function changes; the rest of its body is taken from live
-- and replaced only at that line, which must occur exactly once.
--
-- ROLLBACK: rollback/20261127000000_a_brought_question_is_filed_under_its_own_topic.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261127000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261127000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261127000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261127000000 IS
  'Rollback source for 20261127000000: rpc_record_question_attempt as it was. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261127000000 (object, definition)
SELECT 'public.rpc_record_question_attempt', pg_get_functiondef('public.rpc_record_question_attempt'::regproc);

DO $edit$
DECLARE
  _def text;
  _n   int;
  _old constant text := E'      _topic := COALESCE(_topic, NULLIF(_generated_question->>''topic'', ''''), _chapter);\n';
  _new constant text :=
    E'      -- A brought question (an upload or a capture) is filed under ITS OWN\n' ||
    E'      -- topic, read from the caller''s own row — as a bank attempt is filed\n' ||
    E'      -- under the bank''s (20261127000000). The client''s label, then the\n' ||
    E'      -- chapter, only for one with no topic.\n' ||
    E'      _topic := COALESCE(\n' ||
    E'        (SELECT t.name FROM public.student_upload_questions u JOIN public.topics t ON t.id = u.topic_id\n' ||
    E'          WHERE u.id = NULLIF(_generated_question->>''upload_question_id'', '''')::uuid AND u.owner_id = _uid),\n' ||
    E'        (SELECT t.name FROM public.student_capture_questions c JOIN public.topics t ON t.id = c.topic_id\n' ||
    E'          WHERE c.id = NULLIF(_generated_question->>''capture_question_id'', '''')::uuid AND c.owner_id = _uid),\n' ||
    E'        _topic, NULLIF(_generated_question->>''topic'', ''''), _chapter);\n';
BEGIN
  _def := replace(pg_get_functiondef('public.rpc_record_question_attempt'::regproc), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> 1 THEN
    RAISE EXCEPTION 'rpc_record_question_attempt: expected the brought-question topic line once, found %', _n;
  END IF;
  EXECUTE replace(_def, _old, _new);
END
$edit$;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--   1. The new line is in the body, once; the grants did not move.
--   2. As a real student with an upload question that has a topic different
--      from its chapter's name: an attempt on it is filed under that topic.
--   3. CONTROL: the same attempt without the upload's id — a free-text
--      question — is still filed under the chapter, as before.
--   Everything it writes is rolled back with its sub-block.
DO $proof$
DECLARE
  _uid uuid; _uq uuid; _topic text; _chapter text; _subject text;
  _sess uuid; _v jsonb; _got text; _ctl text; _err text;
BEGIN
  IF (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.rpc_record_question_attempt'::regproc),
        'student_upload_questions u JOIN public\.topics', 'g')) <> 1 THEN
    RAISE EXCEPTION 'the brought-question topic lookup is not in the body exactly once';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rpc_record_question_attempt'::regproc, 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_record_question_attempt'::regproc, 'EXECUTE') THEN
    RAISE EXCEPTION 'the grants on rpc_record_question_attempt moved';
  END IF;

  SELECT u.owner_id, u.id, t.name, ch.name, cs.name INTO _uid, _uq, _topic, _chapter, _subject
    FROM public.student_upload_questions u
    JOIN public.topics t ON t.id = u.topic_id
    JOIN public.chapters ch ON ch.id = u.chapter_id
    JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
   WHERE lower(btrim(t.name)) <> lower(btrim(ch.name))
   ORDER BY u.created_at LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NO FIXTURE: no upload question has a topic distinct from its chapter, so nothing could tell the two apart';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _sess := public.rpc_start_practice_session(_subject, _chapter, 2, 'custom', NULL, NULL);

    _v := public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', 0),
      _generated_question => jsonb_build_object('question', '20261127000000 proof', 'options', jsonb_build_array('a', 'b'),
                               'subject', _subject, 'chapter', _chapter, 'upload_question_id', _uq),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', 0),
      _session_id         => _sess,
      _source             => 'upload',
      _meta               => jsonb_build_object('attempt_number', 1));
    _v := public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', 0),
      _generated_question => jsonb_build_object('question', '20261127000000 control', 'options', jsonb_build_array('a', 'b'),
                               'subject', _subject, 'chapter', _chapter),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', 0),
      _session_id         => _sess,
      _source             => 'upload',
      _meta               => jsonb_build_object('attempt_number', 2));
    RESET ROLE;

    SELECT qa.topic INTO _got FROM public.question_attempts qa
     WHERE qa.session_id = _sess AND qa.generated_question->>'question' = '20261127000000 proof';
    SELECT qa.topic INTO _ctl FROM public.question_attempts qa
     WHERE qa.session_id = _sess AND qa.generated_question->>'question' = '20261127000000 control';
    RAISE EXCEPTION 'PROOF_DONE|%|%', coalesce(_got, '(none)'), coalesce(_ctl, '(none)');
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    _err := SQLERRM;
    IF _err NOT LIKE 'PROOF_DONE|%' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);

  _got := split_part(_err, '|', 2);
  _ctl := split_part(_err, '|', 3);
  IF _got IS DISTINCT FROM _topic THEN
    RAISE EXCEPTION 'an upload attempt was filed under "%", not its question''s topic "%"', _got, _topic;
  END IF;
  IF _ctl IS DISTINCT FROM _chapter THEN
    RAISE EXCEPTION 'CONTROL: a free-text attempt was filed under "%", not its chapter "%"', _ctl, _chapter;
  END IF;

  RAISE NOTICE 'an upload attempt is filed under "%"; a free-text one still under "%"', _got, _ctl;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261127000000_a_brought_question_is_filed_under_its_own_topic')
ON CONFLICT (version) DO NOTHING;

COMMIT;
