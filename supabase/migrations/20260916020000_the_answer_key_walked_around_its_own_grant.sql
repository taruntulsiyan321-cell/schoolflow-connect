-- ═══════════════════════════════════════════════════════════════════════════
-- The answer key walked around its own grant (§10.25, G14, §10.19)
--
-- `20260916000000` gave the student half of the test report this fence:
--
--     can_read_test_student_report(_test_id, _student_id) =
--       can_read_test_report(_test_id)
--       OR EXISTS (SELECT 1 FROM students s
--                   WHERE s.id = _student_id AND s.user_id = auth.uid())
--
-- The second branch asks one question — "is this MY student row" — and never
-- asks what `_test_id` has to do with that student. The test id is a free
-- parameter. And `rpc_test_student_report` builds `wrong_answers` from
--
--     test_questions q LEFT JOIN test_answers ans ON ans.attempt_id = a.id
--     WHERE COALESCE(ans.is_correct, false) = false
--
-- so when there is no submitted attempt the join yields NULL, the predicate is
-- TRUE for EVERY question, and the function returns the whole paper — question
-- text, `correct_answer`, and the explanation — to whoever passed the fence.
--
-- ── MEASURED BEFORE THIS MIGRATION, AS THE CALLER, 2026-09-09 ────────────
--
-- Both holes are open on the live database right now:
--
--   a student, on a PUBLISHED test in their own class that they never sat
--     SELECT count(*) FROM test_questions WHERE test_id = <t>   ->  0 rows
--     rpc_test_student_report -> 'wrong_answers'                ->  2 of 2
--     ... -> 0 ->> 'correct_answer'                             ->  {"indexes": [1]}
--     ... ->> 'submitted_at'                                    ->  null
--
--   a school-A student, on a school-B test (all 72 seeded tests are school B)
--     SELECT count(*) FROM tests          WHERE id = <t>        ->  0 rows
--     SELECT count(*) FROM test_questions WHERE test_id = <t>   ->  0 rows
--     rpc_test_student_report -> 'wrong_answers'                ->  8 of 8
--     ... -> 0 ->> 'question'                                   ->  'Scale Q1'
--     ... -> 0 ->> 'correct_answer'                             ->  {"indexes": [0]}
--
-- The two direct reads returning 0 rows are the point. The GRANT that closes
-- `test_questions` to students (G14) and the tenancy fence on `tests` both
-- hold; a SECURITY DEFINER function walked around both of them. This is the
-- `rpc_restore_from_trash` shape again — a definer function consulting tables
-- as the OWNER — and it is why `verify:caller-privileges` exists.
--
-- ── THE FIX, IN TWO PLACES ON PURPOSE ───────────────────────────────────
--
-- 1. THE FENCE. A report is something you sat, not something you ask for. The
--    student branch now requires a SUBMITTED ATTEMPT OF THEIR OWN on that
--    test, in their own school. That single condition closes both holes: no
--    attempt means no key before the test, and a foreign test is one they have
--    no attempt on.
--
-- 2. THE BODY. `wrong_answers` is `[]` when there is no submitted attempt, and
--    a new `submitted` boolean says which case it is. Staff legitimately reach
--    a non-sitter's report through `can_read_test_report`, and "here are the
--    questions they got wrong" listing every question of a test nobody sat is
--    a false statement even when it discloses nothing (G4).
--
-- Belt and braces, deliberately: a gate is the last place to depend on exactly
-- one thing being right. The fence alone would be enough for the student; the
-- body alone would be enough for the disclosure. Neither alone is enough for
-- both.
--
-- ── ALSO IN THIS MIGRATION: `options`, so a wrong answer can be READ ─────
--
-- `their_answer` and `correct_answer` are positions — `{"indexes":[1]}` — not
-- text (see `20260914110000`). Without the option list beside them there is
-- nothing a screen can render but the raw jsonb, which is the
-- "[object Object]" defect one layer out from the DOM. `options` and
-- `question_format` now travel with each wrong answer so the caller can
-- resolve the position into the words the student actually chose. They are
-- only ever returned for a test this caller already passed the fence for.
--
-- Rollback: supabase/migrations/rollback/
--           20260916020000_the_answer_key_walked_around_its_own_grant.rollback.sql
-- Assertion: verification/caller-privileges/probe38.sql (claims 11-14)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The fence ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_test_student_report(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_read_test_report(_test_id)
      OR EXISTS (
           -- The student themselves — but only for a test they SAT. Without
           -- the attempt join, `_test_id` is a free parameter and any test in
           -- any school answers (measured; see the header).
           SELECT 1
             FROM public.students s
             JOIN public.tests t
               ON t.id = _test_id
              AND t.deleted_at IS NULL
              AND t.school_id = s.school_id
             JOIN public.test_attempts a
               ON a.test_id = t.id
              AND a.status = 'submitted'
              AND (a.student_id = s.id OR a.user_id = s.user_id)
            WHERE s.id = _student_id
              AND s.user_id = (SELECT auth.uid())
         )
$function$;

COMMENT ON FUNCTION public.can_read_test_student_report(uuid, uuid) IS
  'Staff who may read the class report, OR the student that report is about — '
  'and for the student, only on a test they have a submitted attempt for in '
  'their own school. Before 20260916020000 the student branch checked only '
  'that the student row was theirs, which made the test id a free parameter '
  'and returned any school''s answer key.';

-- ── 2. The body ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_test_student_report(_test_id uuid, _student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_student_report(_test_id, _student_id) THEN
    RAISE EXCEPTION 'Not your test report' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', _test_id,
    'student_id', _student_id,
    'full_name', s.full_name,
    'mark', a.score,
    'max_mark', t.max_mark,
    'correct_count', a.correct_count,
    'total_count', a.total_count,
    'submitted_at', a.submitted_at,
    -- "Did not sit it" and "got nothing wrong" are different facts and must
    -- not render the same (G4). The caller needs this to tell them apart,
    -- because both now produce an empty `wrong_answers`.
    'submitted', (a.id IS NOT NULL),
    -- ONLY the wrong ones, and ONLY when there is an attempt to be wrong in.
    -- With no attempt, `ans` is NULL for every row and the predicate below is
    -- true for the whole paper — which is how the answer key escaped.
    'wrong_answers', CASE WHEN a.id IS NULL THEN '[]'::jsonb ELSE COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'question_id', q.id,
                'order_index', q.order_index,
                'question', q.question,
                'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
                'marks', q.marks,
                'question_format', q.question_format,
                -- The choice list, so a position can be read as a word.
                'options', q.options,
                'their_answer', ans.response,
                'correct_answer', q.correct,
                'explanation', q.explanation,
                'answered', (ans.id IS NOT NULL)
              ) ORDER BY q.order_index)
         FROM public.test_questions q
         LEFT JOIN public.test_answers ans
                ON ans.question_id = q.id AND ans.attempt_id = a.id
        WHERE q.test_id = _test_id
          AND COALESCE(ans.is_correct, false) = false), '[]'::jsonb) END
  )
    INTO _out
    FROM public.students s
    JOIN public.tests t ON t.id = _test_id
    LEFT JOIN public.test_attempts a
           ON a.test_id = _test_id
          AND (a.student_id = s.id OR a.user_id = s.user_id)
          AND a.status = 'submitted'
   WHERE s.id = _student_id;

  RETURN _out;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_read_test_student_report(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_test_student_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_test_student_report(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_test_student_report(uuid, uuid) TO authenticated;

-- ── Proof, before this commits ────────────────────────────────────────────
--
-- This block runs as `postgres` and therefore cannot prove an RLS refusal —
-- that is probe38's job. What it CAN do is set the JWT claim these two
-- SECURITY DEFINER functions read through `auth.uid()`, and re-run the exact
-- pair that was measured leaking. It writes nothing: the fixture is the live
-- school-A student and school-B test that produced the 8-question disclosure.
DO $verify$
DECLARE
  sch_a     uuid := '00000000-0000-4000-8000-000000000001';
  stu_a     uuid;
  stu_a_uid uuid;
  t_b       uuid;
  ok_stu    uuid;
  ok_uid    uuid;
  ok_test   uuid;
  n_wrong   int;
BEGIN
  -- The pair that leaked: a student in one school, a test in another.
  SELECT s.id, s.user_id INTO stu_a, stu_a_uid
    FROM public.students s
   WHERE s.school_id = sch_a AND s.user_id IS NOT NULL
   ORDER BY s.id LIMIT 1;

  SELECT t.id INTO t_b
    FROM public.tests t
   WHERE t.school_id <> sch_a
     AND t.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.test_questions q WHERE q.test_id = t.id)
   ORDER BY t.id LIMIT 1;

  -- The positive control: a student who DID sit a test, in their own school.
  SELECT s.id, s.user_id, t.id INTO ok_stu, ok_uid, ok_test
    FROM public.test_attempts a
    JOIN public.students s ON (s.id = a.student_id OR s.user_id = a.user_id)
    JOIN public.tests t ON t.id = a.test_id AND t.deleted_at IS NULL
   WHERE a.status = 'submitted'
     AND s.user_id IS NOT NULL
     AND t.school_id = s.school_id
   ORDER BY a.id LIMIT 1;

  IF stu_a IS NULL OR t_b IS NULL OR ok_stu IS NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK: fixtures missing (student=%, foreign test=%, sitter=%) '
      '— a check that cannot run is not a check that passed',
      stu_a, t_b, ok_stu;
  END IF;

  -- THE REFUSAL. Before this migration this returned the whole paper.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', stu_a_uid, 'role','authenticated')::text, true);
  IF public.can_read_test_student_report(t_b, stu_a) THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'ROLLED BACK: a student still reaches another school''s test report';
  END IF;

  -- THE POSITIVE CONTROL. Without it the refusal above would also pass on a
  -- fence that refuses everybody, which is not a fix (G11).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', ok_uid, 'role','authenticated')::text, true);
  IF NOT public.can_read_test_student_report(ok_test, ok_stu) THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'ROLLED BACK: a student who SAT the test can no longer read their own report';
  END IF;

  -- ...and the report they reach is not an empty shell.
  SELECT jsonb_array_length(public.rpc_test_student_report(ok_test, ok_stu) -> 'wrong_answers')
    INTO n_wrong;
  IF n_wrong IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'ROLLED BACK: the sitter''s report has no wrong_answers array at all';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  -- The `submitted` discriminator must actually be in the payload, or the
  -- caller cannot tell "did not sit it" from "got nothing wrong".
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_test_student_report'
       AND pg_get_functiondef(p.oid) LIKE '%''submitted'', (a.id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: rpc_test_student_report does not report whether the test was sat';
  END IF;

  RAISE NOTICE 'a report is now something you sat: cross-school refused, the sitter still reads their own (% wrong answers).', n_wrong;
END $verify$;
