-- ROLLBACK of 20261150000000_the_mock_creator: the mock goes back to 20261115000000
-- (50 random questions a subject, spread by a cap), its functions exactly as
-- they were live on 2026-10-09. Refuses while any mock has been sat: an attempt
-- names a paper, and dropping papers would lose a student's work.
BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mock_attempts) THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED: % mock attempts exist; they name papers this rollback would drop',
      (SELECT count(*) FROM public.mock_attempts);
  END IF;
END $guard$;

DROP FUNCTION public.rpc_mock_analysis_context(uuid);
DROP FUNCTION public.rpc_mock_prepare(text, uuid);
DROP FUNCTION public.rpc_mock_start(uuid);
DROP FUNCTION public.rpc_set_exam_option(text, text, text);
DROP FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer, boolean);
DROP FUNCTION public._mock_paper_preview(uuid, uuid);
DROP FUNCTION public._mock_build(uuid, uuid, text, uuid, jsonb);
DROP FUNCTION public._mock_targets(uuid, text, uuid, jsonb);
DROP FUNCTION public._mock_options(uuid, uuid, text, uuid);
DROP FUNCTION public._mock_history(uuid);
DROP FUNCTION public._mock_pool(uuid, text, uuid);
DROP FUNCTION public._mock_syllabus(uuid, text);

ALTER TABLE public.mock_answers DROP COLUMN guessed;
DROP INDEX public.mock_attempts_one_sitting_per_paper;
ALTER TABLE public.mock_attempts DROP CONSTRAINT mock_attempts_marked_when_submitted;
ALTER TABLE public.mock_attempts DROP COLUMN paper_id, DROP COLUMN total, DROP COLUMN seen_before;
ALTER TABLE public.mock_attempts
  ADD COLUMN exam_id uuid NOT NULL REFERENCES public.competitive_exams(id),
  ADD COLUMN subject text NOT NULL CONSTRAINT mock_attempts_subject_check CHECK (btrim(subject) <> ''),
  ADD COLUMN question_ids uuid[] NOT NULL CONSTRAINT mock_attempts_question_ids_check CHECK (array_length(question_ids, 1) > 0);
ALTER TABLE public.mock_attempts ADD CONSTRAINT mock_attempts_marked_when_submitted CHECK (
  (submitted_at IS NULL AND correct IS NULL AND wrong IS NULL AND unanswered IS NULL AND voided IS NULL AND score IS NULL)
  OR (submitted_at IS NOT NULL AND correct IS NOT NULL AND wrong IS NOT NULL AND unanswered IS NOT NULL
      AND voided IS NOT NULL AND score IS NOT NULL
      AND correct + wrong + unanswered + voided = array_length(question_ids, 1)
      AND score = correct * marks_correct + wrong * marks_wrong));
DROP TABLE public.mock_papers;
DROP TABLE public.exam_option_choices;
DROP TABLE public.exam_blueprint_forms;
DROP TABLE public.exam_blueprint_chapters;
DROP TABLE public.exam_blueprint_options;

CREATE OR REPLACE FUNCTION public._mock_paper()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- questions, minutes, marks and the spread rule are stated ONCE, here.
  -- max_score and max_per_chapter are arithmetic on them, never a second
  -- statement of the same fact.
  SELECT jsonb_build_object(
    'questions',       k.questions,
    'minutes',         k.minutes,
    'marks_correct',   k.marks_correct,
    'marks_wrong',     k.marks_wrong,
    'min_chapters',    k.min_chapters,
    'max_per_chapter', ceil(k.questions::numeric / k.min_chapters)::int,
    'max_score',       k.questions * k.marks_correct)
  FROM (SELECT 50 AS questions, 60 AS minutes, 5 AS marks_correct, -1 AS marks_wrong, 5 AS min_chapters) k
$function$;

CREATE OR REPLACE FUNCTION public._mock_subject_supply()
 RETURNS TABLE(subject text, questions integer, chapters integer, ready boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH paper AS (
    SELECT (public._mock_paper()->>'questions')::int       AS wanted,
           (public._mock_paper()->>'max_per_chapter')::int AS cap
  ),
  per_chapter AS (
    SELECT b.subject AS subj, b.chapter_id AS ch, count(*)::int AS cnt
      FROM public._student_bank_pool() b
     WHERE b.chapter_id IS NOT NULL
     GROUP BY b.subject, b.chapter_id
  )
  -- The supply is counted UNDER THE CAP, which is the same expression the
  -- paper is built with: what is offered as ready can always be built.
  SELECT c.subj,
         sum(least(c.cnt, p.cap))::int,
         count(*)::int,
         sum(least(c.cnt, p.cap)) >= p.wanted
    FROM per_chapter c CROSS JOIN paper p
   GROUP BY c.subj, p.wanted
   ORDER BY c.subj
$function$;

CREATE OR REPLACE FUNCTION public._mock_pick_questions(_subject text)
 RETURNS uuid[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH paper AS (
    SELECT (public._mock_paper()->>'questions')::int       AS wanted,
           (public._mock_paper()->>'max_per_chapter')::int AS cap
  ),
  ranked AS (
    SELECT b.id, row_number() OVER (PARTITION BY b.chapter_id ORDER BY random()) AS rn
      FROM public._student_bank_pool() b
     WHERE b.chapter_id IS NOT NULL
       AND lower(b.subject) = lower(_subject)
  ),
  -- rn orders the take: every chapter gives its first question before any
  -- chapter gives a second. That is the spread, and the cap bounds the tail.
  taken AS (
    SELECT r.id
      FROM ranked r CROSS JOIN paper p
     WHERE r.rn <= p.cap
     ORDER BY r.rn, random()
     LIMIT (SELECT wanted FROM paper)
  )
  SELECT array_agg(t.id ORDER BY random()) FROM taken t
$function$;

CREATE OR REPLACE FUNCTION public.rpc_mock_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid   uuid := auth.uid();
  _exam  uuid;
  _open  uuid;
  _subs  jsonb;
  _hist  int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  SELECT ea.exam_id INTO _exam FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  IF _exam IS NULL THEN
    -- A school student practises by chapter and sits their school's tests;
    -- a full CUET paper is not theirs to sit.
    RETURN jsonb_build_object('individual', false, 'paper', public._mock_paper());
  END IF;

  PERFORM public._mock_close_expired(_uid);

  SELECT a.id INTO _open FROM public.mock_attempts a
   WHERE a.user_id = _uid AND a.submitted_at IS NULL
   ORDER BY a.started_at DESC LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
           'subject',  s.subject,
           'questions', s.questions,
           'chapters',  s.chapters,
           'ready',     s.ready) ORDER BY s.subject)
    INTO _subs
    FROM public._mock_subject_supply() s;

  SELECT count(*)::int INTO _hist
    FROM public.mock_attempts a WHERE a.user_id = _uid AND a.submitted_at IS NOT NULL;

  RETURN jsonb_build_object(
    'individual', true,
    'paper',      public._mock_paper(),
    'subjects',   COALESCE(_subs, '[]'::jsonb),
    'taken',      _hist,
    -- The plan's answer WITHOUT counting a use: the screen shows what is left
    -- before anyone starts anything.
    'plan',       public._premium_decide(_uid, 'mock_test.start', 1, false),
    'open',       CASE WHEN _open IS NULL THEN NULL ELSE public._mock_paper_view(_open) END);
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_mock_start(_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid    uuid := auth.uid();
  _paper  jsonb := public._mock_paper();
  _exam   uuid;
  _supply record;
  _ids    uuid[];
  _att    uuid;
  _d      jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  SELECT ea.exam_id INTO _exam FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'mock_tests_are_for_exam_accounts' USING ERRCODE = '42501',
      DETAIL = 'A full CUET paper belongs to an exam account.';
  END IF;

  PERFORM public._mock_close_expired(_uid);

  IF EXISTS (SELECT 1 FROM public.mock_attempts a WHERE a.user_id = _uid AND a.submitted_at IS NULL) THEN
    RAISE EXCEPTION 'mock_attempt_already_open' USING ERRCODE = 'P0001',
      DETAIL = 'One paper at a time: finish or submit the one already open.';
  END IF;

  -- The subject as the bank spells it, and only if a whole paper can be built.
  SELECT s.* INTO _supply FROM public._mock_subject_supply() s
   WHERE lower(s.subject) = lower(btrim(COALESCE(_subject, '')));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mock_subject_unknown' USING ERRCODE = 'P0001',
      DETAIL = format('%s is not a subject with questions for this account.', COALESCE(_subject, ''));
  END IF;
  IF NOT _supply.ready THEN
    RAISE EXCEPTION 'mock_not_enough_questions' USING ERRCODE = 'P0001',
      DETAIL = format('%s has %s of the %s questions a paper needs, across %s chapters.',
                      _supply.subject, _supply.questions, _paper->>'questions', _supply.chapters);
  END IF;

  -- Built BEFORE the plan is asked, so a plan use is never spent on a paper
  -- that could not be made.
  _ids := public._mock_pick_questions(_supply.subject);
  IF _ids IS NULL OR array_length(_ids, 1) <> (_paper->>'questions')::int THEN
    RAISE EXCEPTION 'mock_not_enough_questions' USING ERRCODE = 'P0001',
      DETAIL = format('%s could only fill %s of %s questions.',
                      _supply.subject, COALESCE(array_length(_ids, 1), 0), _paper->>'questions');
  END IF;

  -- The plan decides and counts in one statement. It raises plan_limit:<feature>
  -- with the decision as DETAIL, which is what the app recognises.
  _d := public._premium_require(_uid, 'mock_test.start', 1);

  INSERT INTO public.mock_attempts (
    user_id, exam_id, subject, question_ids, marks_correct, marks_wrong, deadline, usage_period_key)
  VALUES (
    _uid, _exam, _supply.subject, _ids,
    (_paper->>'marks_correct')::int, (_paper->>'marks_wrong')::int,
    now() + make_interval(mins => (_paper->>'minutes')::int),
    _d->>'period_key')
  RETURNING id INTO _att;

  RETURN public._mock_paper_view(_att);
END
$function$;

CREATE OR REPLACE FUNCTION public._mock_paper_view(_attempt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _a   public.mock_attempts%ROWTYPE;
  _qs  jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt AND a.user_id = _uid;
  IF NOT FOUND THEN
    -- The same answer for another account's paper and for one that does not
    -- exist: whose papers exist is not the caller's business either.
    RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'order',     q.ord,
           'id',        q.qid,
           'available', qb.id IS NOT NULL,
           'question',  qb.question,
           'options',   COALESCE(qb.options, '[]'::jsonb),
           'format',    COALESCE(qb.question_format, 'mcq'),
           'chapter',   qb.chapter,
           'choice',    ans.choice,
           'marked',    COALESCE(ans.marked, false)
         ) ORDER BY q.ord)
    INTO _qs
    FROM unnest(_a.question_ids) WITH ORDINALITY AS q(qid, ord)
    LEFT JOIN public.question_bank qb ON qb.id = q.qid
    LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid;

  RETURN jsonb_build_object(
    'id',            _a.id,
    'subject',       _a.subject,
    'started_at',    _a.started_at,
    'deadline',      _a.deadline,
    'submitted_at',  _a.submitted_at,
    'total',         array_length(_a.question_ids, 1),
    'marks_correct', _a.marks_correct,
    'marks_wrong',   _a.marks_wrong,
    'max_score',     array_length(_a.question_ids, 1) * _a.marks_correct,
    'questions',     COALESCE(_qs, '[]'::jsonb));
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_mock_save_answer(_attempt uuid, _question uuid, _choice integer DEFAULT NULL::integer, _marked boolean DEFAULT NULL::boolean, _time_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid  uuid := auth.uid();
  _view jsonb;
  _q    jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  -- One read, and it is the same view the paper is sat from: it fences the
  -- attempt to the caller, and it says what the questions and options are.
  _view := public._mock_paper_view(_attempt);

  IF (_view->>'submitted_at') IS NOT NULL THEN
    RAISE EXCEPTION 'mock_already_submitted' USING ERRCODE = 'P0001',
      DETAIL = 'This paper is already marked.';
  END IF;
  IF (_view->>'deadline')::timestamptz <= now() THEN
    RAISE EXCEPTION 'mock_time_is_up' USING ERRCODE = 'P0001',
      DETAIL = 'The hour is over. Submit to see the result.';
  END IF;

  SELECT e INTO _q FROM jsonb_array_elements(_view->'questions') e
   WHERE (e->>'id')::uuid = _question;
  IF _q IS NULL THEN
    RAISE EXCEPTION 'mock_question_not_in_paper' USING ERRCODE = 'P0001';
  END IF;
  IF _choice IS NOT NULL
     AND (_choice < 0 OR _choice >= jsonb_array_length(_q->'options')) THEN
    RAISE EXCEPTION 'mock_choice_out_of_range' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mock_answers AS m (attempt_id, question_id, choice, marked, time_ms)
  VALUES (_attempt, _question, _choice, COALESCE(_marked, false), _time_ms)
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET
    choice     = EXCLUDED.choice,
    marked     = COALESCE(_marked, m.marked),
    time_ms    = GREATEST(COALESCE(EXCLUDED.time_ms, 0), COALESCE(m.time_ms, 0)),
    updated_at = now();

  RETURN jsonb_build_object('saved', true, 'deadline', _view->>'deadline');
END
$function$;

CREATE OR REPLACE FUNCTION public._mock_grade(_attempt uuid, _auto boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a          public.mock_attempts%ROWTYPE;
  _q          record;
  _g          record;
  _gradable   boolean;
  _chapter_id uuid;
  _correct    int := 0;
  _wrong      int := 0;
  _unanswered int := 0;
  _voided     int := 0;
BEGIN
  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _a.submitted_at IS NOT NULL THEN RETURN; END IF;   -- already marked; marking is once

  FOR _q IN
    SELECT q.qid, q.ord, ans.choice
      FROM unnest(_a.question_ids) WITH ORDINALITY AS q(qid, ord)
      LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid
     ORDER BY q.ord
  LOOP
    IF _q.choice IS NULL THEN
      _unanswered := _unanswered + 1;
      CONTINUE;
    END IF;

    _gradable := true;
    BEGIN
      SELECT * INTO _g
        FROM public._practice_grade_from_bank(_q.qid, jsonb_build_object('index', _q.choice));
      IF NOT FOUND THEN _gradable := false; END IF;
    EXCEPTION WHEN others THEN
      -- The only expected failure is a question that is no longer in the bank
      -- or no longer approved. Anything else is a real error and must not be
      -- swallowed into a quiet zero.
      IF SQLERRM <> 'bank_question_not_found' THEN RAISE; END IF;
      _gradable := false;
    END;

    IF NOT _gradable THEN
      _voided := _voided + 1;
      UPDATE public.mock_answers SET is_correct = NULL
       WHERE attempt_id = _a.id AND question_id = _q.qid;
      CONTINUE;
    END IF;

    UPDATE public.mock_answers SET is_correct = _g.is_correct
     WHERE attempt_id = _a.id AND question_id = _q.qid;

    IF _g.is_correct THEN
      _correct := _correct + 1;
    ELSE
      _wrong := _wrong + 1;
      -- The chapter, taken from the question's own topic. It is passed because
      -- §5.1 reads this ARGUMENT — not the column the trigger fills — to decide
      -- whether the miss bumps mastery and joins the revision queue, and for a
      -- bank question the chapter is known. Practice passes it the same way,
      -- from whatever its client sent (20261111000000, generated_question
      -- ->>'chapter_id').
      SELECT t.chapter_id INTO _chapter_id FROM public.topics t WHERE t.id = _g.topic_id;

      -- The Mistake Book, exactly as a wrong practice answer reaches it, so the
      -- school_id and chapter_id triggers fill the same two columns they always
      -- do and one question missed twice is one row with times_wrong 2.
      PERFORM public.rpc_record_concept_mistake(
        'practice', _a.id, _q.qid,
        COALESCE(_g.subject, _a.subject), _g.chapter,
        COALESCE(_g.topic, _g.chapter), COALESCE(_g.topic, _g.chapter),
        _g.class_level,
        COALESCE(_g.question_text, ''),
        COALESCE(_g.options, '[]'::jsonb),
        jsonb_build_object('index', _q.choice),
        _g.correct_answer,
        COALESCE(_g.explanation, ''),
        _chapter_id);
    END IF;
  END LOOP;

  UPDATE public.mock_attempts a
     SET submitted_at   = now(),
         auto_submitted = _auto,
         correct        = _correct,
         wrong          = _wrong,
         unanswered     = _unanswered,
         voided         = _voided,
         score          = _correct * a.marks_correct + _wrong * a.marks_wrong
   WHERE a.id = _a.id;
END
$function$;

CREATE OR REPLACE FUNCTION public._mock_result_json(_attempt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _a   public.mock_attempts%ROWTYPE;
  _q   record;
  _g   record;
  _rows jsonb := '[]'::jsonb;
  _gradable boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt AND a.user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _a.submitted_at IS NULL THEN
    -- Nothing about the answers travels while the paper is still open.
    RAISE EXCEPTION 'mock_not_submitted' USING ERRCODE = 'P0001';
  END IF;

  FOR _q IN
    SELECT q.qid, q.ord, ans.choice, ans.is_correct, ans.time_ms
      FROM unnest(_a.question_ids) WITH ORDINALITY AS q(qid, ord)
      LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid
     ORDER BY q.ord
  LOOP
    _gradable := true;
    BEGIN
      SELECT * INTO _g
        FROM public._practice_grade_from_bank(_q.qid, jsonb_build_object('index', COALESCE(_q.choice, -1)));
      IF NOT FOUND THEN _gradable := false; END IF;
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'bank_question_not_found' THEN RAISE; END IF;
      _gradable := false;
    END;

    _rows := _rows || jsonb_build_object(
      'order',      _q.ord,
      'id',         _q.qid,
      'available',  _gradable,
      'question',   CASE WHEN _gradable THEN _g.question_text END,
      'options',    CASE WHEN _gradable THEN _g.options ELSE '[]'::jsonb END,
      'chapter',    CASE WHEN _gradable THEN _g.chapter END,
      'topic',      CASE WHEN _gradable THEN _g.topic END,
      'explanation',CASE WHEN _gradable THEN _g.explanation END,
      'correct',    CASE WHEN _gradable THEN _g.correct_answer END,
      'choice',     _q.choice,
      'is_correct', _q.is_correct,
      'marks',      CASE
                      WHEN _q.choice IS NULL OR _q.is_correct IS NULL THEN 0
                      WHEN _q.is_correct THEN _a.marks_correct
                      ELSE _a.marks_wrong
                    END,
      'time_ms',    _q.time_ms);
  END LOOP;

  RETURN jsonb_build_object(
    'id',             _a.id,
    'subject',        _a.subject,
    'started_at',     _a.started_at,
    'submitted_at',   _a.submitted_at,
    'auto_submitted', _a.auto_submitted,
    'seconds_taken',  GREATEST(0, floor(EXTRACT(EPOCH FROM (_a.submitted_at - _a.started_at)))::int),
    'total',          array_length(_a.question_ids, 1),
    'correct',        _a.correct,
    'wrong',          _a.wrong,
    'unanswered',     _a.unanswered,
    'voided',         _a.voided,
    'score',          _a.score,
    'max_score',      array_length(_a.question_ids, 1) * _a.marks_correct,
    'marks_correct',  _a.marks_correct,
    'marks_wrong',    _a.marks_wrong,
    'questions',      _rows);
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_my_mock_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _rows jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  PERFORM public._mock_close_expired(_uid);

  SELECT jsonb_agg(jsonb_build_object(
           'id',             a.id,
           'subject',        a.subject,
           'started_at',     a.started_at,
           'submitted_at',   a.submitted_at,
           'auto_submitted', a.auto_submitted,
           'correct',        a.correct,
           'wrong',          a.wrong,
           'unanswered',     a.unanswered,
           'voided',         a.voided,
           'score',          a.score,
           'total',          array_length(a.question_ids, 1),
           'max_score',      array_length(a.question_ids, 1) * a.marks_correct,
           'seconds_taken',  CASE WHEN a.submitted_at IS NULL THEN NULL
                                  ELSE GREATEST(0, floor(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)))::int) END
         ) ORDER BY a.started_at DESC)
    INTO _rows
    FROM public.mock_attempts a
   WHERE a.user_id = _uid AND a.submitted_at IS NOT NULL;

  RETURN COALESCE(_rows, '[]'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION public._mock_subject_supply() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_pick_questions(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_mock_start(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_mock_start(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer) TO authenticated;

DO $verify$
BEGIN
  IF to_regclass('public.mock_papers') IS NOT NULL OR to_regprocedure('public.rpc_mock_prepare(text,uuid)') IS NOT NULL
     OR to_regprocedure('public.rpc_mock_start(text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: the mock creator is still in place';
  END IF;
END $verify$;

COMMIT;
