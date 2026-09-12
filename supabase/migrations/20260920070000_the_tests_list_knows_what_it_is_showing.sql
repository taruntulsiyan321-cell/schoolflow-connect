-- ═══════════════════════════════════════════════════════════════════════════
-- The tests list knows what it is showing (§10.22, G4, G14)
--
-- ── WHAT THE TWO LISTS COULD NOT SAY, AND WHAT THEY SAID INSTEAD ─────────
--
-- The student's Tests screen (`src/gurukul/pages/Tests.tsx`) lists a class's
-- tests from `TestService.listForClass`, which selects
-- `*, section_subjects!inner(section_id)`. Measured against that shape:
--
--   subject        `t.subject ?? ""` — `tests` HAS NO SUBJECT COLUMN (§10.22:
--                  it anchors on section_subject). So the subject line under
--                  every test title was always empty, on every card, for
--                  every student.
--   attempted?     nothing in the payload says whether this student has
--                  already sat it, so a submitted test still showed
--                  "Attempt" and sent them back into a paper they had
--                  handed in — where the answer saves are refused with
--                  "already submitted".
--   attemptable?   nothing says whether the test HAS questions. A test built
--                  in "upload paper" mode has none by design (the teacher
--                  attaches a PDF and enters marks later). Its card offered
--                  "Attempt", and `rpc_test_start` then refused it with
--                  "test has no questions".
--   marked?        the mark this student got is in `test_marks`, which the
--                  screen never read — so a finished test showed no result
--                  beside it.
--
-- The teacher's list (`LiveTestsTab`) has the same gap from the other side: it
-- counts questions with a second staff-only query and shows nothing at all
-- about how many students have handed in, which is the fact a teacher looks at
-- a published test for.
--
-- ── WHY AN RPC AND NOT FOUR MORE CLIENT READS ────────────────────────────
--
-- `test_questions` is not SELECT-able by students: the answer-key fence is the
-- GRANT (G14), so the client cannot count questions for a student's list at
-- all. `test_attempts` is `user_id = auth.uid()` for a student and
-- "tests I created" for staff, so a teacher cannot count other people's
-- attempts from the client either. Both counts are therefore only reachable
-- from a definer — and storing them on `tests` would be the same fact in two
-- places (G9), which is exactly why `question_count` was removed from that
-- table in the first place.
--
-- One function, one round trip, and the payload is shaped by WHO IS ASKING:
-- a student gets published tests with their own attempt state; staff get every
-- live test with the submitted count. Neither gets the other's fields, so this
-- cannot become a back door to a classmate's mark.
--
-- Rollback: supabase/migrations/rollback/
--           20260920070000_the_tests_list_knows_what_it_is_showing.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_test_list_for_class(_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _student uuid;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  -- Staff: the teachers of this section, and the office. `teacher_teaches_class`
  -- and `is_principal_or_admin` are the same enumerators every other test
  -- surface uses, so this cannot admit someone they refuse.
  _is_staff := public.teacher_teaches_class(_uid, _class_id)
            OR (SELECT public.is_principal_or_admin(_uid));

  -- The student asking, if they are one OF THIS SECTION. A student of another
  -- section resolves to NULL here and is refused below.
  SELECT s.id INTO _student
    FROM public.students s
   WHERE s.user_id = _uid
     AND s.class_id = _class_id
     AND s.deleted_at IS NULL
   LIMIT 1;

  IF NOT _is_staff AND _student IS NULL THEN
    -- A parent is not refused here so much as not served: their child's tests
    -- come through the parent panel's own path (`listLatestAttemptsForStudent`),
    -- which is fenced on the child. Saying so beats an empty list that reads
    -- like "this class has no tests".
    RAISE EXCEPTION 'Not your class''s tests' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO _out
    FROM (
      SELECT t.id,
             t.title,
             t.status,
             t.test_kind,
             t.max_mark,
             t.total_marks,
             t.duration_sec,
             t.instructions,
             t.created_at,
             t.published_at,
             t.scheduled_publish_at,
             t.chapter,
             t.topic,
             -- The subject, from the anchor rather than from a column that does
             -- not exist (§10.22).
             cs.name AS subject,
             -- 0 means "nothing to attempt": an uploaded paper, or a draft
             -- whose questions are not written yet. The screens read it to
             -- decide whether an Attempt control belongs on the card at all.
             (SELECT count(*)::int FROM public.test_questions q WHERE q.test_id = t.id) AS question_count,
             -- Staff only. A student learns nothing here about who else sat it;
             -- that is the leaderboard's job, and it requires them to have
             -- submitted (20260920030000).
             CASE WHEN _is_staff THEN
               (SELECT count(*)::int FROM public.test_attempts a
                 WHERE a.test_id = t.id AND a.status = 'submitted')
             END AS submitted_count,
             CASE WHEN _is_staff THEN
               (SELECT count(*)::int FROM public.students s2
                 WHERE s2.class_id = ss.section_id
                   AND s2.school_id = t.school_id
                   AND s2.deleted_at IS NULL)
             END AS roll_count,
             -- The asking student's own state, and nobody else's.
             CASE WHEN _student IS NOT NULL THEN
               COALESCE((SELECT a.status FROM public.test_attempts a
                          WHERE a.test_id = t.id AND a.user_id = _uid
                          ORDER BY a.started_at DESC LIMIT 1), 'not_started')
             END AS my_status,
             CASE WHEN _student IS NOT NULL THEN
               (SELECT a.score FROM public.test_attempts a
                 WHERE a.test_id = t.id AND a.user_id = _uid AND a.status = 'submitted'
                 LIMIT 1)
             END AS my_mark,
             CASE WHEN _student IS NOT NULL THEN
               (SELECT a.submitted_at FROM public.test_attempts a
                 WHERE a.test_id = t.id AND a.user_id = _uid AND a.status = 'submitted'
                 LIMIT 1)
             END AS my_submitted_at
        FROM public.tests t
        JOIN public.section_subjects ss ON ss.id = t.section_subject_id
        LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
       WHERE ss.section_id = _class_id
         AND t.deleted_at IS NULL
         -- A student sees a test once it is published, and never before:
         -- `status` is the only source for that (isPublishedFlag).
         AND (_is_staff OR t.status = 'published')
    ) x;

  RETURN _out;
END;
$function$;

COMMENT ON FUNCTION public.rpc_test_list_for_class(uuid) IS
  'The tests of one section, shaped for who is asking: a student gets the '
  'published ones with their own attempt state and mark; staff get every live '
  'test with how many have handed in. Carries question_count, which no client '
  'can compute because test_questions is closed to students (G14).';

REVOKE ALL ON FUNCTION public.rpc_test_list_for_class(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_list_for_class(uuid) TO authenticated;

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _section uuid; _other_section uuid; _teacher uuid;
  _stu uuid; _stu_user uuid;
  _draft uuid; _published uuid; _paper uuid; _q uuid; _att uuid;
  _list jsonb; _row jsonb;
  _refused boolean;
BEGIN
  SELECT ss.school_id, ss.id, ss.section_id, t.user_id
    INTO _school, _ss, _section, _teacher
    FROM public.section_subjects ss
    JOIN public.teacher_classes tc ON tc.class_id = ss.section_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = ss.school_id
    JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE EXISTS (SELECT 1 FROM public.students s
                  WHERE s.class_id = ss.section_id AND s.user_id IS NOT NULL AND s.deleted_at IS NULL)
   LIMIT 1;
  IF _ss IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section with a subject, a teacher and a signed-up student';
  END IF;

  SELECT s.id, s.user_id INTO _stu, _stu_user FROM public.students s
   WHERE s.class_id = _section AND s.user_id IS NOT NULL AND s.deleted_at IS NULL LIMIT 1;

  -- Three tests: a draft, a published one with a question, and a published
  -- "uploaded paper" with none.
  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, status, test_kind, duration_sec)
  VALUES (_school, _ss, _teacher, '[verify 20260920070000] draft', 1, 'draft', 'class_test', 600)
  RETURNING id INTO _draft;
  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920070000] published', 1, 'published', 'unit_test', 600, now())
  RETURNING id INTO _published;
  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920070000] paper', 10, 'published', 'class_test', NULL, now())
  RETURNING id INTO _paper;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
  VALUES (_published, _school, 0, 'mcq', 'verify: 4 + 4 ?', '["8","9"]', '{"indexes":[0]}', 1)
  RETURNING id INTO _q;

  -- ── As the student ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu_user, 'role','authenticated')::text, true);
  _list := public.rpc_test_list_for_class(_section);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_list) e WHERE (e ->> 'id')::uuid = _draft) THEN
    RAISE EXCEPTION 'ROLLED BACK: a draft test reached a student''s list';
  END IF;

  SELECT e INTO _row FROM jsonb_array_elements(_list) e WHERE (e ->> 'id')::uuid = _published;
  IF _row IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the published test is missing from the student''s list';
  END IF;
  IF (_row ->> 'subject') IS NULL OR btrim(_row ->> 'subject') = '' THEN
    RAISE EXCEPTION 'ROLLED BACK: the subject is still empty on a student''s card — the whole reason for the anchor join';
  END IF;
  IF (_row ->> 'question_count')::int <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: question_count is %, expected 1', _row ->> 'question_count';
  END IF;
  IF (_row ->> 'my_status') <> 'not_started' THEN
    RAISE EXCEPTION 'ROLLED BACK: an unopened test reports my_status %', _row ->> 'my_status';
  END IF;
  IF (_row -> 'submitted_count') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: a student was told how many classmates have submitted: %', _row -> 'submitted_count';
  END IF;

  SELECT e INTO _row FROM jsonb_array_elements(_list) e WHERE (e ->> 'id')::uuid = _paper;
  IF (_row ->> 'question_count')::int <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the uploaded paper reports % questions', _row ->> 'question_count';
  END IF;

  -- Sit the published one, then ask again: the same card must now carry the
  -- state and the mark.
  _att := public.rpc_test_start(_published);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _q, 'response', '{"indexes":[0]}'::jsonb)));

  SELECT e INTO _row FROM jsonb_array_elements(public.rpc_test_list_for_class(_section)) e
   WHERE (e ->> 'id')::uuid = _published;
  IF (_row ->> 'my_status') <> 'submitted' THEN
    RAISE EXCEPTION 'ROLLED BACK: after submitting, my_status is %', _row ->> 'my_status';
  END IF;
  IF (_row ->> 'my_mark')::numeric <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: after submitting, my_mark is %', _row ->> 'my_mark';
  END IF;
  IF (_row ->> 'my_submitted_at') IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: after submitting, my_submitted_at is null';
  END IF;

  -- ── As the teacher ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  _list := public.rpc_test_list_for_class(_section);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_list) e WHERE (e ->> 'id')::uuid = _draft) THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher''s own draft is missing from their list';
  END IF;
  SELECT e INTO _row FROM jsonb_array_elements(_list) e WHERE (e ->> 'id')::uuid = _published;
  IF (_row ->> 'submitted_count')::int <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher reads submitted_count %, expected 1', _row ->> 'submitted_count';
  END IF;
  IF (_row ->> 'roll_count')::int < 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: roll_count is %', _row ->> 'roll_count';
  END IF;
  IF (_row -> 'my_status') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: a teacher was given a student attempt state: %', _row -> 'my_status';
  END IF;

  -- ── A student of another section is refused ────────────────────────────
  SELECT c.id INTO _other_section FROM public.classes c
   WHERE c.school_id = _school AND c.id <> _section LIMIT 1;
  IF _other_section IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu_user, 'role','authenticated')::text, true);
    BEGIN
      PERFORM public.rpc_test_list_for_class(_other_section);
      _refused := false;
    EXCEPTION WHEN insufficient_privilege THEN
      _refused := true;
    END;
    IF NOT _refused THEN
      RAISE EXCEPTION 'ROLLED BACK: a student listed another section''s tests';
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.student_mistakes WHERE source_id IN (_draft, _published, _paper);
  DELETE FROM public.test_marks WHERE test_id IN (_draft, _published, _paper);
  DELETE FROM public.test_answers WHERE attempt_id IN
    (SELECT id FROM public.test_attempts WHERE test_id IN (_draft, _published, _paper));
  DELETE FROM public.test_attempts WHERE test_id IN (_draft, _published, _paper);
  DELETE FROM public.test_questions WHERE test_id IN (_draft, _published, _paper);
  DELETE FROM public.tests WHERE id IN (_draft, _published, _paper);

  RAISE NOTICE 'verify OK: draft hidden from the student, subject and question_count present, attempt state and mark after submitting, teacher gets submitted_count and no attempt state, other section refused';
END
$verify$;
