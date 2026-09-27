-- ===========================================================================
-- A FULL CUET MOCK TEST — 50 questions, 60 minutes, +5 / −1 / 0.
--
-- RULED by the owner, 2026-09-27: one domain subject per paper, 50 questions in
-- 60 minutes, five marks for a right answer, one off for a wrong one, nothing
-- for one left blank. 250 is full marks. A subject is offered only when the
-- bank can actually fill a paper spread across its chapters; otherwise the
-- screen says so, with the counts.
--
-- It is the eighth and last feature of the plan (premium_features.mock_test.start,
-- 20261111000000): free and starter get one in a lifetime, pro four a month,
-- max as many as they like. This migration is what makes that row mean
-- something — until now nothing consumed it.
--
-- ── WHAT THIS DOES NOT BUILD AGAIN ────────────────────────────────────────
--
--   grading           public._practice_grade_from_bank is THE home for "is
--                     this option the right one for this bank question", and
--                     it is what practice marks with. A mock calls it per
--                     question. There is no second comparison of correct_index
--                     anywhere in this file.
--   the mistake book  public.rpc_record_concept_mistake, with the same
--                     'practice' assessment type practice uses — so a question
--                     missed in a mock reaches the Mistake Book, Recovery and
--                     Revision through the machinery that already exists, and
--                     the two INSERT triggers fill school_id and chapter_id
--                     exactly as they do for a practice mistake.
--   the plan          public._premium_require(uid, 'mock_test.start', 1),
--                     which counts the use in the same statement that checks
--                     it. This file holds no copy of any allowance.
--   what a student    public.question_bank_student — the view that decides
--   may be served     which board's or which exam's questions this caller can
--                     see. The question pool below reads it; it does not
--                     restate its rule.
--
-- ── ONE HOME FOR THE POOL, SHARED WITH THE PRACTICE CATALOG ───────────────
--
-- "Which bank questions may THIS caller be served" was written out inside
-- rpc_practice_bank_catalog (20261110000000): the view for board and exam, the
-- exam account's syllabus chapters for an exam account, class and stream for a
-- school student. A mock needs exactly that set — so copying the CASE here
-- would have made two homes for it, and the next ruling about who may practise
-- what would have had to find both.
--
-- It is extracted to public._student_bank_pool(_class_level, _stream), and the
-- catalog now reads it. The proof at the bottom captures every real caller's
-- catalog BEFORE the change and requires it to be identical after, with a
-- control that says the comparison was made against catalogs that had rows.
--
-- ── ONE HOME FOR THE PAPER'S SHAPE ────────────────────────────────────────
--
-- public._mock_paper() states it once: 50 questions, 60 minutes, +5, −1, and
-- the spread rule (at least 5 chapters, so at most ceil(50/5) = 10 questions
-- from any one chapter). Full marks and the per-chapter cap are DERIVED from
-- those numbers, never stated a second time. The client holds no copy: the
-- catalog hands it the shape, and the countdown runs to the deadline the
-- server set.
--
-- The cap is also what makes "ready" honest. A subject's supply is counted as
-- sum(least(questions in chapter, cap)) — the same expression the paper is
-- built with — so a subject can never be offered as ready and then fail to
-- build. Readiness and selection are one rule, not two that agree today.
--
-- ── A PAPER IS FROZEN AT START ────────────────────────────────────────────
--
-- mock_attempts.question_ids holds the 50 ids in paper order, and the marks
-- per answer are copied onto the attempt. Staff deactivating a question, or a
-- price of marks changing later, cannot alter a paper already being sat — the
-- same reason premium_orders copies its amount at the moment of sale.
--
-- A question that leaves the bank entirely mid-paper is the one case the
-- frozen list cannot answer: it renders as unavailable, it is VOIDED at
-- marking rather than counted wrong, and correct + wrong + unanswered + voided
-- is the whole paper (a table constraint, not a hope).
--
-- ROLLBACK: rollback/20261115000000_a_full_cuet_mock_test.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 0. Before: every real caller's practice catalog ─────────────────────────
-- Captured AS that caller (role authenticated + their JWT subject) over a grid
-- of the arguments the app sends, so the pool extraction can be proven to have
-- changed nothing for anybody.
CREATE TEMP TABLE _catalog_before (
  sub uuid, class_level int, stream text, rows jsonb,
  PRIMARY KEY (sub, class_level, stream)
) ON COMMIT DROP;

DO $capture$
DECLARE
  _who  record;
  _arg  record;
  _rows jsonb;
BEGIN
  FOR _who IN
    -- Every exam account, and up to five students of a real organisation
    -- school: the two arms of the pool.
    SELECT ea.account_id AS sub FROM public.exam_accounts ea
    UNION
    SELECT s.user_id FROM public.students s
      JOIN public.schools sc ON sc.id = s.school_id
     WHERE s.user_id IS NOT NULL AND sc.kind = 'school' AND s.deleted_at IS NULL
     LIMIT 5
  LOOP
    FOR _arg IN
      SELECT * FROM (VALUES (NULL::int, NULL::text), (10, NULL), (11, 'commerce'), (12, 'commerce'), (12, NULL)) v(lvl, strm)
    LOOP
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _who.sub, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _rows
        FROM public.rpc_practice_bank_catalog(_class_level => _arg.lvl, _stream => _arg.strm) c;
      RESET ROLE;
      INSERT INTO _catalog_before (sub, class_level, stream, rows)
      VALUES (_who.sub, COALESCE(_arg.lvl, -1), COALESCE(_arg.strm, ''), _rows)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT EXISTS (SELECT 1 FROM _catalog_before) THEN
    RAISE EXCEPTION 'no caller could be captured — the catalog comparison below would prove nothing';
  END IF;
END
$capture$;

-- ── 1. The paper's shape ────────────────────────────────────────────────────
CREATE FUNCTION public._mock_paper()
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

COMMENT ON FUNCTION public._mock_paper() IS
  'THE shape of a CUET mock paper: 50 questions, 60 minutes, +5/-1, spread over at least 5 chapters. Full marks and the per-chapter cap are derived from these.';

-- ── 2. The caller''s own question pool ──────────────────────────────────────
-- Extracted from rpc_practice_bank_catalog (20261110000000). The rule is
-- unchanged; it now has one home instead of being restated by every reader.
CREATE FUNCTION public._student_bank_pool(_class_level integer DEFAULT NULL, _stream text DEFAULT NULL)
RETURNS TABLE(id uuid, subject text, chapter text, chapter_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH mine AS (
    -- The caller's own exam account, when they are one (one per account).
    SELECT ea.exam_id, ea.stream
      FROM public.exam_accounts ea
     WHERE ea.school_id = (SELECT public.get_my_school_id())
  )
  SELECT qb.id, qb.subject, qb.chapter, qb.chapter_id
    FROM public.question_bank_student qb
   WHERE qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND CASE
       WHEN EXISTS (SELECT 1 FROM mine) THEN
         -- An exam account: its exam (the view) and its stream's syllabus.
         qb.exam_id IS NOT NULL
         AND qb.chapter_id IN (
           SELECT s.chapter_id
             FROM mine
             JOIN public.exam_syllabus_chapters s ON s.exam_id = mine.exam_id AND s.stream = mine.stream)
       ELSE
         -- A school student: their school's board (the view), their class.
         qb.exam_id IS NULL
         AND qb.class_level = _class_level
         AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL)
     END
$function$;

COMMENT ON FUNCTION public._student_bank_pool(integer, text) IS
  'THE questions this caller may be served: approved and active, their board or their exam syllabus. Read by the practice catalog and by the mock paper builder.';

-- The catalog is now a count over the pool, and nothing else.
CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer DEFAULT NULL::integer,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.subject, p.chapter, count(*)::int
    FROM public._student_bank_pool(_class_level, _stream) p
   WHERE (_subject IS NULL OR lower(p.subject) = lower(_subject))
   GROUP BY p.subject, p.chapter
   ORDER BY p.subject, p.chapter
$function$;

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text) IS
  'Subjects and chapters a student can practise, with counts. Counts _student_bank_pool — board and exam come from the caller, never from the request.';

-- ── 3. The papers, and the answers on them ──────────────────────────────────
CREATE TABLE public.mock_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id        uuid NOT NULL REFERENCES public.competitive_exams(id),
  subject        text NOT NULL CHECK (btrim(subject) <> ''),
  -- The paper, frozen in the order it is sat in.
  question_ids   uuid[] NOT NULL CHECK (array_length(question_ids, 1) > 0),
  -- Copied from _mock_paper() at start: what this paper marks at.
  marks_correct  integer NOT NULL CHECK (marks_correct > 0),
  marks_wrong    integer NOT NULL CHECK (marks_wrong <= 0),
  started_at     timestamptz NOT NULL DEFAULT now(),
  deadline       timestamptz NOT NULL,
  submitted_at   timestamptz,
  auto_submitted boolean NOT NULL DEFAULT false,
  correct        integer CHECK (correct    IS NULL OR correct    >= 0),
  wrong          integer CHECK (wrong      IS NULL OR wrong      >= 0),
  unanswered     integer CHECK (unanswered IS NULL OR unanswered >= 0),
  -- A question that left the bank between planning and marking: not wrong,
  -- not unanswered, not silently dropped either.
  voided         integer CHECK (voided     IS NULL OR voided     >= 0),
  score          integer,
  -- The plan period the start was counted in, so a use can be given back.
  usage_period_key text,
  CONSTRAINT mock_attempts_deadline_after_start CHECK (deadline > started_at),
  -- A paper is either in progress or marked. There is no half-marked paper.
  CONSTRAINT mock_attempts_marked_when_submitted CHECK (
    (submitted_at IS NULL
      AND correct IS NULL AND wrong IS NULL AND unanswered IS NULL AND voided IS NULL AND score IS NULL)
    OR
    (submitted_at IS NOT NULL
      AND correct IS NOT NULL AND wrong IS NOT NULL AND unanswered IS NOT NULL AND voided IS NOT NULL
      AND score IS NOT NULL
      AND correct + wrong + unanswered + voided = array_length(question_ids, 1)
      AND score = correct * marks_correct + wrong * marks_wrong)
  )
);

-- One paper at a time. A partial unique index, not a check in a function: two
-- taps racing each other cannot both open a paper.
CREATE UNIQUE INDEX mock_attempts_one_open_per_student
  ON public.mock_attempts (user_id) WHERE submitted_at IS NULL;
CREATE INDEX mock_attempts_mine_idx ON public.mock_attempts (user_id, started_at DESC);

COMMENT ON TABLE public.mock_attempts IS
  'A full CUET mock paper an individual account sat: its questions frozen at start, its marks copied at start, its result written once at marking.';

CREATE TABLE public.mock_answers (
  attempt_id  uuid NOT NULL REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
  -- No foreign key to question_bank on purpose: the paper is frozen, and a
  -- question leaving the bank must not delete the answer someone gave it.
  question_id uuid NOT NULL,
  choice      integer CHECK (choice IS NULL OR choice >= 0),
  marked      boolean NOT NULL DEFAULT false,
  time_ms     integer CHECK (time_ms IS NULL OR time_ms >= 0),
  -- NULL until the paper is marked, and NULL forever for a voided question.
  is_correct  boolean,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

COMMENT ON TABLE public.mock_answers IS
  'One row per question a student touched on a mock paper: their choice, whether they flagged it, and after marking whether it was right.';

-- Every door into these two tables is a function below. No role holds a grant
-- on the tables themselves, and RLS is on with no policy: a client that tried
-- would be refused twice.
ALTER TABLE public.mock_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_answers  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mock_attempts, public.mock_answers FROM PUBLIC, anon, authenticated;

-- ── 4. What each subject can supply ─────────────────────────────────────────
CREATE FUNCTION public._mock_subject_supply()
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

COMMENT ON FUNCTION public._mock_subject_supply() IS
  'Per subject: how many questions a mock could draw under the per-chapter cap, from how many chapters, and whether that fills a paper.';

-- ── 5. The paper builder ────────────────────────────────────────────────────
CREATE FUNCTION public._mock_pick_questions(_subject text)
RETURNS uuid[]
LANGUAGE sql
VOLATILE SECURITY DEFINER
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

COMMENT ON FUNCTION public._mock_pick_questions(text) IS
  'A paper for the caller in one subject: round-robin across chapters under the cap, then shuffled into the order it is sat in.';

-- ── 6. The paper, as the student sees it ────────────────────────────────────
-- Their own attempt, their own answers, and NO correct answer of any kind.
-- This is the only read of the question bank in the sitting path: the paper is
-- frozen, so the questions come from the bank by id and not through
-- question_bank_student, which would drop a question deactivated mid-hour.
CREATE FUNCTION public._mock_paper_view(_attempt uuid)
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

COMMENT ON FUNCTION public._mock_paper_view(uuid) IS
  'The caller''s own mock paper with their own answers and no correct answer anywhere. Reads question_bank by frozen id so a mid-paper deactivation cannot change the paper.';

-- ── 7. Marking ──────────────────────────────────────────────────────────────
-- THE one home for marking a mock: rpc_mock_submit calls it, and so does the
-- sweep that closes a paper whose hour ran out. Grading itself is
-- _practice_grade_from_bank; this counts what it says and records the misses
-- the way practice does.
CREATE FUNCTION public._mock_grade(_attempt uuid, _auto boolean)
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

COMMENT ON FUNCTION public._mock_grade(uuid, boolean) IS
  'Marks a mock paper once: grading through _practice_grade_from_bank, misses through rpc_record_concept_mistake, and a question that left the bank voided rather than counted wrong.';

-- Any paper of this caller''s whose hour has run out, marked before anything
-- else happens. A student who closed the tab does not get an unmarked paper,
-- and does not get blocked from starting the next one either.
CREATE FUNCTION public._mock_close_expired(_uid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _r record;
  _n int := 0;
BEGIN
  FOR _r IN
    SELECT a.id FROM public.mock_attempts a
     WHERE a.user_id = _uid AND a.submitted_at IS NULL AND a.deadline <= now()
  LOOP
    PERFORM public._mock_grade(_r.id, true);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END
$function$;

-- ── 8. The result, and only after the paper is in ───────────────────────────
CREATE FUNCTION public._mock_result_json(_attempt uuid)
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

-- ── 9. The doors the app calls ──────────────────────────────────────────────

-- What can be sat, whether the plan allows another one, and the paper already
-- in progress if there is one.
CREATE FUNCTION public.rpc_mock_catalog()
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

CREATE FUNCTION public.rpc_mock_start(_subject text)
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

-- The paper again — for a reload, or for resuming from the catalog.
CREATE FUNCTION public.rpc_mock_paper(_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  -- An hour that ran out while the tab was shut is marked on the way in, so
  -- the paper the student reopens is never a dead one.
  PERFORM public._mock_close_expired(_uid);
  RETURN public._mock_paper_view(_attempt);
END
$function$;

CREATE FUNCTION public.rpc_mock_save_answer(
  _attempt uuid, _question uuid, _choice integer DEFAULT NULL,
  _marked boolean DEFAULT NULL, _time_ms integer DEFAULT NULL)
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

CREATE FUNCTION public.rpc_mock_submit(_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _a   public.mock_attempts%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  -- Locked, so two taps (or a tap and the timer) cannot mark the same paper
  -- twice: the second one finds it already submitted and reads the result.
  SELECT * INTO _a FROM public.mock_attempts a
   WHERE a.id = _attempt AND a.user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;

  IF _a.submitted_at IS NULL THEN
    -- Past the deadline it is the hour that ended the paper, not the student.
    PERFORM public._mock_grade(_a.id, now() > _a.deadline);
  END IF;

  RETURN public._mock_result_json(_a.id);
END
$function$;

CREATE FUNCTION public.rpc_mock_result(_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public._mock_result_json(_attempt);
END
$function$;

CREATE FUNCTION public.rpc_my_mock_history()
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

-- ── 10. Who may open which door ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._mock_paper()                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._student_bank_pool(integer, text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_subject_supply()                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_pick_questions(text)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_paper_view(uuid)                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_grade(uuid, boolean)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_close_expired(uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_result_json(uuid)                               FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rpc_mock_catalog()                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_start(text)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_paper(uuid)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_submit(uuid)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_result(uuid)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_my_mock_history()                                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_mock_catalog()                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_start(text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_paper(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_submit(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_result(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_my_mock_history()                              TO authenticated;

-- ── 11. Proof, and every check can fail ─────────────────────────────────────
DO $proof$
DECLARE
  _b        record;
  _now      jsonb;
  _nonempty int := 0;
  _exam_cb  int := 0;
  _school_cb int := 0;
  _s        record;
  _ids      uuid[];
  _chapters int;
  _over_cap int;
  _paper    jsonb := public._mock_paper();
  _acct     uuid;
  _other    uuid;
  _ready    text;
  _subjects int := 0;
  _att      uuid;
  _view     jsonb;
  _res      jsonb;
  _hist     jsonb;
  _right    int := 0;
  _wrongly  int := 0;
  _q        jsonb;
  _key      int;
  _pkey     text;
  _a_submitted timestamptz;
  _used_before int;
  _used_after  int;
  _leaked   int;
BEGIN
  -- 1. THE PAPER'S SHAPE is arithmetic, not two statements of one fact.
  IF (_paper->>'max_score')::int <> (_paper->>'questions')::int * (_paper->>'marks_correct')::int
     OR (_paper->>'max_per_chapter')::int
        <> ceil((_paper->>'questions')::numeric / (_paper->>'min_chapters')::int)::int THEN
    RAISE EXCEPTION 'the paper shape disagrees with itself: %', _paper;
  END IF;
  IF (_paper->>'questions')::int <> 50 OR (_paper->>'minutes')::int <> 60
     OR (_paper->>'marks_correct')::int <> 5 OR (_paper->>'marks_wrong')::int <> -1 THEN
    RAISE EXCEPTION 'the paper is not the ruled 50 questions in 60 minutes at +5/-1: %', _paper;
  END IF;

  -- 2. THE CATALOG IS UNCHANGED for every caller captured before the pool was
  --    extracted out of it.
  FOR _b IN SELECT * FROM _catalog_before LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _b.sub, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.subject, c.chapter) INTO _now
      FROM public.rpc_practice_bank_catalog(
             _class_level => NULLIF(_b.class_level, -1), _stream => NULLIF(_b.stream, '')) c;
    RESET ROLE;
    IF _now IS DISTINCT FROM _b.rows THEN
      RAISE EXCEPTION 'the catalog changed for % (class %, stream "%"): % rows before, % after',
        _b.sub, _b.class_level, _b.stream,
        COALESCE(jsonb_array_length(_b.rows), 0), COALESCE(jsonb_array_length(_now), 0);
    END IF;
    IF COALESCE(jsonb_array_length(_b.rows), 0) > 0 THEN
      _nonempty := _nonempty + 1;
      IF EXISTS (SELECT 1 FROM public.exam_accounts ea WHERE ea.account_id = _b.sub)
        THEN _exam_cb := _exam_cb + 1; ELSE _school_cb := _school_cb + 1; END IF;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
  -- CONTROL: two empty catalogs are equal too. Both arms of the pool must have
  -- been compared on a caller who actually had rows.
  IF _exam_cb = 0 OR _school_cb = 0 THEN
    RAISE EXCEPTION 'CONTROL: % exam and % school comparisons had rows — an arm of the pool is unproven',
      _exam_cb, _school_cb;
  END IF;

  -- 3. GRANTS. authenticated opens the seven doors and nothing else; anon
  --    opens none; the helpers are open to neither.
  FOREACH _ready IN ARRAY ARRAY[
    'rpc_mock_catalog()', 'rpc_mock_start(text)', 'rpc_mock_paper(uuid)',
    'rpc_mock_save_answer(uuid,uuid,integer,boolean,integer)', 'rpc_mock_submit(uuid)',
    'rpc_mock_result(uuid)', 'rpc_my_mock_history()'] LOOP
    IF NOT has_function_privilege('authenticated', 'public.' || _ready, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot call %', _ready;
    END IF;
    IF has_function_privilege('anon', 'public.' || _ready, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can call %', _ready;
    END IF;
  END LOOP;
  FOREACH _ready IN ARRAY ARRAY[
    '_mock_paper()', '_student_bank_pool(integer,text)', '_mock_subject_supply()',
    '_mock_pick_questions(text)', '_mock_paper_view(uuid)', '_mock_grade(uuid,boolean)',
    '_mock_close_expired(uuid)', '_mock_result_json(uuid)'] LOOP
    IF has_function_privilege('authenticated', 'public.' || _ready, 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || _ready, 'EXECUTE') THEN
      RAISE EXCEPTION 'a helper is a door: % is executable by a client role', _ready;
    END IF;
  END LOOP;

  -- 4. THE PLAN IS ASKED. A text pin, because the alternative — starting 50
  --    papers to watch an allowance run out — is not something a migration
  --    should do to a student's history.
  IF position('_premium_require' IN pg_get_functiondef('public.rpc_mock_start(text)'::regprocedure)) = 0
     OR position('mock_test.start' IN pg_get_functiondef('public.rpc_mock_start(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'rpc_mock_start does not ask the plan';
  END IF;

  -- 5. AS A REAL EXAM ACCOUNT: the catalog, the offer, and the whole paper.
  SELECT ea.account_id INTO _acct FROM public.exam_accounts ea
   WHERE NOT EXISTS (SELECT 1 FROM public.mock_attempts m WHERE m.user_id = ea.account_id)
   ORDER BY ea.created_at LIMIT 1;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'there is no exam account to prove a mock test with';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _view := public.rpc_mock_catalog();
  RESET ROLE;
  IF NOT (_view->>'individual')::boolean THEN
    RAISE EXCEPTION 'an exam account was told mock tests are not for it';
  END IF;
  _subjects := jsonb_array_length(_view->'subjects');
  IF _subjects = 0 THEN
    RAISE EXCEPTION 'the catalog offered this exam account no subject at all — its syllabus has no active questions';
  END IF;

  -- Every subject: ready ⇒ a whole paper can be built, spread under the cap;
  -- not ready ⇒ start refuses and says so. Both arms are checked for whatever
  -- subjects exist, so this cannot pass by finding nothing.
  FOR _s IN SELECT * FROM jsonb_array_elements(_view->'subjects') e,
                         LATERAL (SELECT e->>'subject' AS subject, (e->>'ready')::boolean AS ready,
                                         (e->>'questions')::int AS questions) x
  LOOP
    -- The claim is what the pool reads (through get_my_school_id), not the
    -- role — so the builder is probed for THIS account without granting a
    -- client role a helper it must never hold.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
    IF _s.ready THEN
      SELECT public._mock_pick_questions(_s.subject) INTO _ids;
      IF COALESCE(array_length(_ids, 1), 0) <> (_paper->>'questions')::int THEN
        RAISE EXCEPTION '% is offered as ready but builds only % of % questions',
          _s.subject, COALESCE(array_length(_ids, 1), 0), _paper->>'questions';
      END IF;
      IF (SELECT count(DISTINCT qb.id) FROM public.question_bank qb WHERE qb.id = ANY(_ids))
         <> (_paper->>'questions')::int THEN
        RAISE EXCEPTION '% built a paper with a repeated or unknown question', _s.subject;
      END IF;
      SELECT count(DISTINCT qb.chapter_id), COALESCE(max(cnt), 0)
        INTO _chapters, _over_cap
        FROM public.question_bank qb
        JOIN (SELECT qb2.chapter_id AS ch, count(*) AS cnt FROM public.question_bank qb2
               WHERE qb2.id = ANY(_ids) GROUP BY qb2.chapter_id) g ON g.ch = qb.chapter_id
       WHERE qb.id = ANY(_ids);
      IF _chapters < (_paper->>'min_chapters')::int THEN
        RAISE EXCEPTION '%s paper came from only % chapters', _s.subject, _chapters;
      END IF;
      IF _over_cap > (_paper->>'max_per_chapter')::int THEN
        RAISE EXCEPTION '%s paper took % questions from one chapter, over the cap of %',
          _s.subject, _over_cap, _paper->>'max_per_chapter';
      END IF;
    ELSE
      SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM public.rpc_mock_start(_s.subject);
        RESET ROLE;
        RAISE EXCEPTION '% is not ready and started anyway', _s.subject;
      EXCEPTION WHEN others THEN
        RESET ROLE;
        IF SQLERRM <> 'mock_not_enough_questions' THEN RAISE; END IF;
      END;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- 6. THE WHOLE JOURNEY, and then rolled back: nothing a student did not do
  --    is left in their history. The sentinel at the end is what rolls it
  --    back; anything else that raises in here is a failure and propagates.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_view->'subjects') e WHERE (e->>'ready')::boolean) THEN
    BEGIN
      SELECT e->>'subject' INTO _ready FROM jsonb_array_elements(_view->'subjects') e
       WHERE (e->>'ready')::boolean LIMIT 1;

      -- The period this account's mock allowance is counted in, whatever plan
      -- it holds: lifetime on free and starter, a month on pro and max.
      _pkey := public._premium_decide(_acct, 'mock_test.start', 1, false)->>'period_key';
      SELECT COALESCE(u.used, 0) INTO _used_before FROM public.premium_usage u
       WHERE u.account_id = _acct AND u.feature_code = 'mock_test.start'
         AND u.period_key = _pkey;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      _view := public.rpc_mock_start(_ready);
      RESET ROLE;
      _att := (_view->>'id')::uuid;

      IF jsonb_array_length(_view->'questions') <> (_paper->>'questions')::int THEN
        RAISE EXCEPTION 'the paper handed over holds % questions, not %',
          jsonb_array_length(_view->'questions'), _paper->>'questions';
      END IF;
      IF (_view->>'deadline')::timestamptz <= now() THEN
        RAISE EXCEPTION 'the paper started already out of time';
      END IF;

      -- NOTHING about the answers travels with the paper. The probe is proved
      -- able to find them at step 6f, where the same keys ARE present.
      _leaked := 0;
      FOR _q IN SELECT e FROM jsonb_array_elements(_view->'questions') e LOOP
        IF _q ?| ARRAY['correct', 'correct_index', 'answer', 'explanation', 'is_correct'] THEN
          _leaked := _leaked + 1;
        END IF;
      END LOOP;
      IF _leaked > 0 THEN
        RAISE EXCEPTION '% of the questions handed to the student carry the answer', _leaked;
      END IF;

      -- 6b. The plan counted the start.
      SELECT COALESCE(u.used, 0) INTO _used_after FROM public.premium_usage u
       WHERE u.account_id = _acct AND u.feature_code = 'mock_test.start'
         AND u.period_key = _pkey;
      IF (SELECT a.usage_period_key FROM public.mock_attempts a WHERE a.id = _att) IS DISTINCT FROM _pkey THEN
        RAISE EXCEPTION 'the paper recorded the wrong plan period: % not %',
          (SELECT a.usage_period_key FROM public.mock_attempts a WHERE a.id = _att), _pkey;
      END IF;
      IF _used_after <> _used_before + 1 THEN
        RAISE EXCEPTION 'starting a mock did not count against the plan: % then %', _used_before, _used_after;
      END IF;

      -- 6c. A second paper is refused while this one is open.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM public.rpc_mock_start(_ready);
        RESET ROLE;
        RAISE EXCEPTION 'a second paper opened while one was already open';
      EXCEPTION WHEN others THEN
        IF SQLERRM <> 'mock_attempt_already_open' THEN RAISE; END IF;
      END;
      SET LOCAL ROLE authenticated;

      -- 6d. Answer: the first ten right, the next five wrong, the rest blank.
      --     The right option comes from the bank as the owner reads it — the
      --     student's own view never carried it.
      FOR _q IN SELECT e FROM jsonb_array_elements(_view->'questions') e
                 ORDER BY (e->>'order')::int LIMIT 15
      LOOP
        RESET ROLE;
        SELECT qb.correct_index INTO _key FROM public.question_bank qb WHERE qb.id = (_q->>'id')::uuid;
        SET LOCAL ROLE authenticated;
        IF _key IS NULL THEN CONTINUE; END IF;
        IF _right < 10 THEN
          PERFORM public.rpc_mock_save_answer(_att, (_q->>'id')::uuid, _key, false, 4000);
          _right := _right + 1;
        ELSE
          -- Any option that is not the right one.
          PERFORM public.rpc_mock_save_answer(
            _att, (_q->>'id')::uuid,
            CASE WHEN _key = 0 THEN 1 ELSE 0 END, true, 9000);
          _wrongly := _wrongly + 1;
        END IF;
      END LOOP;

      -- 6e. A question that is not on this paper cannot be answered, and an
      --     option that does not exist cannot be chosen.
      BEGIN
        PERFORM public.rpc_mock_save_answer(_att, gen_random_uuid(), 0);
        RESET ROLE;
        RAISE EXCEPTION 'an answer was accepted for a question not on the paper';
      EXCEPTION WHEN others THEN
        IF SQLERRM <> 'mock_question_not_in_paper' THEN RAISE; END IF;
      END;
      SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM public.rpc_mock_save_answer(_att, (_view->'questions'->0->>'id')::uuid, 99);
        RESET ROLE;
        RAISE EXCEPTION 'an option that does not exist was accepted';
      EXCEPTION WHEN others THEN
        IF SQLERRM <> 'mock_choice_out_of_range' THEN RAISE; END IF;
      END;
      SET LOCAL ROLE authenticated;

      -- 6f. The result is refused before the paper is in, and carries the
      --     answers after it.
      BEGIN
        PERFORM public.rpc_mock_result(_att);
        RESET ROLE;
        RAISE EXCEPTION 'the result was given before the paper was submitted';
      EXCEPTION WHEN others THEN
        IF SQLERRM <> 'mock_not_submitted' THEN RAISE; END IF;
      END;
      SET LOCAL ROLE authenticated;
      _res := public.rpc_mock_submit(_att);
      RESET ROLE;
      _a_submitted := (_res->>'submitted_at')::timestamptz;

      IF (_res->>'correct')::int <> _right OR (_res->>'wrong')::int <> _wrongly THEN
        RAISE EXCEPTION 'marked % right and % wrong; % and % were answered',
          _res->>'correct', _res->>'wrong', _right, _wrongly;
      END IF;
      IF (_res->>'score')::int
         <> _right * (_paper->>'marks_correct')::int + _wrongly * (_paper->>'marks_wrong')::int THEN
        RAISE EXCEPTION 'the score is % for % right and % wrong at +%/%',
          _res->>'score', _right, _wrongly, _paper->>'marks_correct', _paper->>'marks_wrong';
      END IF;
      IF (_res->>'correct')::int + (_res->>'wrong')::int
         + (_res->>'unanswered')::int + (_res->>'voided')::int <> (_res->>'total')::int THEN
        RAISE EXCEPTION 'the counts do not add up to the paper: %', _res;
      END IF;
      -- POSITIVE CONTROL for 6a: the same probe, on the result, DOES find the
      -- keys it found none of before submitting.
      _leaked := 0;
      FOR _q IN SELECT e FROM jsonb_array_elements(_res->'questions') e LOOP
        IF _q ?| ARRAY['correct', 'explanation', 'is_correct'] THEN _leaked := _leaked + 1; END IF;
      END LOOP;
      IF _leaked <> (_res->>'total')::int THEN
        RAISE EXCEPTION 'CONTROL: the answer probe found the keys on only % of % reviewed questions — it cannot fail',
          _leaked, _res->>'total';
      END IF;

      -- 6g. Every wrong answer is in the Mistake Book, the way practice puts
      --     it there, with the two triggers' columns filled.
      --
      --     Matched on the QUESTION, not on source_id: the book holds one row
      --     per (student, source, question) — so a question this student has
      --     missed in practice before is the same row bumped, still carrying
      --     the OLD source_id. (Counting by source_id passed on an empty
      --     database and failed the moment a paper was sat twice; measured on
      --     a replica 2026-09-27.)
      IF _wrongly > 0 THEN
        IF (SELECT count(*)
              FROM public.mock_answers ma
              JOIN public.student_mistakes sm
                ON sm.user_id = _acct AND sm.source = 'practice' AND sm.question_id = ma.question_id
             WHERE ma.attempt_id = _att AND ma.is_correct IS FALSE
               AND sm.status = 'open'
               AND sm.last_wrong_at >= _a_submitted) <> _wrongly THEN
          RAISE EXCEPTION 'the mistake book holds % of % misses from this paper',
            (SELECT count(*)
               FROM public.mock_answers ma
               JOIN public.student_mistakes sm
                 ON sm.user_id = _acct AND sm.source = 'practice' AND sm.question_id = ma.question_id
              WHERE ma.attempt_id = _att AND ma.is_correct IS FALSE
                AND sm.status = 'open' AND sm.last_wrong_at >= _a_submitted), _wrongly;
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.mock_answers ma
            JOIN public.student_mistakes sm
              ON sm.user_id = _acct AND sm.source = 'practice' AND sm.question_id = ma.question_id
           WHERE ma.attempt_id = _att AND ma.is_correct IS FALSE
             AND (sm.school_id IS NULL OR sm.chapter_id IS NULL)) THEN
          RAISE EXCEPTION 'a mock mistake reached the book without its school or its chapter';
        END IF;
        -- §5.1: a miss whose chapter is known joins the revision queue. It is
        -- the 14th argument that decides this, so passing it is what this
        -- proves.
        IF NOT EXISTS (
          SELECT 1
            FROM public.mock_answers ma
            JOIN public.student_mistakes sm
              ON sm.user_id = _acct AND sm.source = 'practice' AND sm.question_id = ma.question_id
            JOIN public.revision_queue rq
              ON rq.user_id = _acct AND NOT rq.completed
             AND rq.subject = sm.subject
             AND COALESCE(rq.chapter, '') = COALESCE(sm.chapter, '')
           WHERE ma.attempt_id = _att AND ma.is_correct IS FALSE) THEN
          RAISE EXCEPTION 'a mock miss with a known chapter did not reach the revision queue';
        END IF;
      END IF;

      -- 6h. Submitting again changes nothing and marks nothing twice.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      IF public.rpc_mock_submit(_att) IS DISTINCT FROM _res THEN
        RESET ROLE;
        RAISE EXCEPTION 'submitting twice gave two different results';
      END IF;
      _hist := public.rpc_my_mock_history();
      RESET ROLE;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_hist) h WHERE (h->>'id')::uuid = _att) THEN
        RAISE EXCEPTION 'the paper is not in the history that follows it';
      END IF;

      -- 6i. Another account cannot see or submit this paper, and no client
      --     role can read the tables at all.
      SELECT ea.account_id INTO _other FROM public.exam_accounts ea WHERE ea.account_id <> _acct LIMIT 1;
      IF _other IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', _other, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        BEGIN
          PERFORM public.rpc_mock_result(_att);
          RESET ROLE;
          RAISE EXCEPTION 'another account read this paper''s result';
        EXCEPTION WHEN others THEN
          IF SQLERRM <> 'mock_attempt_not_found' THEN RAISE; END IF;
        END;
        SET LOCAL ROLE authenticated;
        BEGIN
          PERFORM public.rpc_mock_submit(_att);
          RESET ROLE;
          RAISE EXCEPTION 'another account submitted this paper';
        EXCEPTION WHEN others THEN
          IF SQLERRM <> 'mock_attempt_not_found' THEN RAISE; END IF;
        END;
        RESET ROLE;
      END IF;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      BEGIN
        PERFORM 1 FROM public.mock_attempts;
        RESET ROLE;
        RAISE EXCEPTION 'a client role can read mock_attempts directly';
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);

      RAISE EXCEPTION 'MOCK_JOURNEY_PROVEN';
    EXCEPTION WHEN others THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
      IF SQLERRM = 'MOCK_JOURNEY_PROVEN' THEN
        RAISE NOTICE 'the journey was proven and rolled back: % right, % wrong', _right, _wrongly;
      ELSIF SQLERRM LIKE 'plan_limit:%' THEN
        -- Not a defect: the plan refusing another mock is the plan working.
        -- Said out loud rather than swallowed, because the sitting is then
        -- unproven on this database.
        RAISE WARNING 'NOT PROVEN END TO END: this account''s plan refuses another mock (%). The offer, the refusal, the grants and the fences are proven; the sitting is not.',
          SQLERRM;
      ELSE
        RAISE;
      END IF;
    END;
  ELSE
    -- Nothing was hidden: say plainly that no subject could fill a paper, so
    -- the journey above could not be run on this database.
    RAISE WARNING 'NOT PROVEN END TO END: no subject in this account''s syllabus can fill a % question paper yet. The offer, the refusal and the grants are proven; the sitting is not.',
      _paper->>'questions';
  END IF;

  -- 7. The one-open-paper rule is the index, not a hope.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'mock_attempts_one_open_per_student'
       AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%submitted_at IS NULL%') THEN
    RAISE EXCEPTION 'nothing stops two papers being open at once';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261115000000_a_full_cuet_mock_test')
ON CONFLICT (version) DO NOTHING;

COMMIT;
