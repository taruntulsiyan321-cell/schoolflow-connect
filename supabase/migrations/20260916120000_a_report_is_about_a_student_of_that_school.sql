-- ═══════════════════════════════════════════════════════════════════════════
-- A report is about a student of THAT school (G13, S-04, §10.25)
--
-- `npm run lint:tenant-scope` went red on the two functions that
-- `20260916030000` introduced, and it was right.
--
-- ── THE HOLE, MEASURED ────────────────────────────────────────────────────
--
-- `can_read_test_student_report(_test_id, _student_id)` opened with
--
--     SELECT public.can_read_test_report(_test_id) OR (...)
--
-- and `can_read_test_report` takes ONE argument. It never sees `_student_id`.
-- So for a teacher who genuinely teaches that section the gate was true for
-- EVERY student uuid, and the body it guards then ran
--
--     FROM public.students s
--     JOIN public.tests   t ON t.id = _test_id        -- no predicate between them
--    WHERE s.id = _student_id
--
-- which joins a student to a paper with nothing requiring the two to share a
-- school. Measured 2026-09-09 against live rows, running that body verbatim:
--
--     test_id 9ec4742f... is in school ...0002
--     student             is in school ...0001
--     same_school         = false
--     name it returned    = 'QA Automation'
--
-- A teacher of any section with a test could therefore turn a student uuid
-- from ANOTHER school into that child's name. Marks and wrong answers stayed
-- NULL -- the LEFT JOIN on test_attempts finds nothing, so `submitted` is
-- false -- so what leaked is the name alone, and only to someone who already
-- holds the uuid. Narrow, but it is a tenancy fence with a hole in it, and
-- this codebase does not keep those (S-04 in `embeddingWorker` is the same
-- shape).
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- The school predicate moves OUT of the branches and wraps all of them, so it
-- cannot be bypassed by whichever branch happens to admit the caller. The
-- student and the paper must share a school before any branch is consulted.
--
-- `rpc_test_student_report` gets the same predicate on its own join. That is
-- deliberate restatement of a fence, not G9 duplication of a rule: the gate
-- decides WHO may read, the join decides WHAT row exists, and a gate that is
-- one day widened must not silently widen the row set with it.
--
-- Nothing legitimate changes. A student sits tests in their own school, so
-- `t.school_id = s.school_id` holds for every real report; the parent branch
-- already went through `_test_was_sat_by`, which carried this predicate all
-- along. Only the teacher branch was unbounded, and only for a student who
-- never sat the paper.
--
-- Rollback: supabase/migrations/rollback/
--           20260916120000_a_report_is_about_a_student_of_that_school.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_read_test_student_report(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.students s
      JOIN public.tests t
        ON t.id = _test_id
       AND t.deleted_at IS NULL
       -- The predicate every branch below now inherits. Outside the OR on
       -- purpose: inside it, the teacher branch escaped it.
       AND t.school_id = s.school_id
     WHERE s.id = _student_id
       AND (
         -- the teachers of that section
         public.can_read_test_report(_test_id)
         -- or the child themselves / a parent of that child, once it is sat
         OR (
           public._test_was_sat_by(_test_id, _student_id)
           AND (
             s.user_id = (SELECT auth.uid())
             OR _student_id = ANY (public.my_children_student_ids())
           )
         )
       )
  )
$function$;

COMMENT ON FUNCTION public.can_read_test_student_report(uuid, uuid) IS
  'The teachers of the section, OR the student the report is about, OR a parent '
  'of that student -- and in every case only for a student of the SAME SCHOOL as '
  'the paper, and for the last two only on a test that student actually '
  'submitted. The school predicate wraps the branches rather than sitting inside '
  'them: can_read_test_report never receives _student_id, so a teacher branch '
  'nested under the OR was true for any student uuid (fixed 20260916120000).';

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
    'submitted', (a.id IS NOT NULL),
    'rank', CASE WHEN a.id IS NULL THEN NULL ELSE (
       SELECT count(*) + 1 FROM public.test_attempts a2
        WHERE a2.test_id = _test_id AND a2.status = 'submitted'
          AND a2.score > a.score) END,
    'class_size', CASE WHEN a.id IS NULL THEN NULL ELSE (
       SELECT count(*) FROM public.test_attempts a2
        WHERE a2.test_id = _test_id AND a2.status = 'submitted') END,
    'wrong_answers', CASE WHEN a.id IS NULL THEN '[]'::jsonb ELSE COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'question_id', q.id,
                'order_index', q.order_index,
                'question', q.question,
                'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
                'marks', q.marks,
                'question_format', q.question_format,
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
    JOIN public.tests t
      ON t.id = _test_id
     -- Second statement of the same fence. The gate says who may read; this
     -- says which row exists at all.
     AND t.school_id = s.school_id
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
-- Runs as `postgres`, so it cannot prove an RLS refusal. What it CAN do is
-- re-run the exact shape that leaked and show the row is now gone, and show
-- that a same-school pairing still resolves. It writes nothing.
DO $verify$
DECLARE
  t_id uuid; t_school uuid; foreign_s uuid; same_s uuid;
  cross_rows int; same_rows int;
BEGIN
  SELECT t.id, t.school_id INTO t_id, t_school
    FROM public.tests t
   WHERE t.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.section_subjects ss WHERE ss.id = t.section_subject_id)
   LIMIT 1;

  SELECT s.id INTO foreign_s FROM public.students s WHERE s.school_id <> t_school LIMIT 1;
  SELECT s.id INTO same_s    FROM public.students s WHERE s.school_id  = t_school LIMIT 1;

  IF t_id IS NULL OR foreign_s IS NULL OR same_s IS NULL THEN
    RAISE EXCEPTION 'verify: no two-school fixture (test=%, foreign=%, same=%)',
      t_id, foreign_s, same_s;
  END IF;

  SELECT count(*) INTO cross_rows
    FROM public.students s JOIN public.tests t
      ON t.id = t_id AND t.deleted_at IS NULL AND t.school_id = s.school_id
   WHERE s.id = foreign_s;

  SELECT count(*) INTO same_rows
    FROM public.students s JOIN public.tests t
      ON t.id = t_id AND t.deleted_at IS NULL AND t.school_id = s.school_id
   WHERE s.id = same_s;

  IF cross_rows <> 0 THEN
    RAISE EXCEPTION 'verify: the cross-school pairing STILL resolves (% rows)', cross_rows;
  END IF;

  -- The positive control. Without it the assertion above passes on a typo
  -- that matches nothing at all.
  IF same_rows <> 1 THEN
    RAISE EXCEPTION 'verify: the same-school pairing stopped resolving (% rows) -- '
                    'the predicate is too tight, not just tight enough', same_rows;
  END IF;

  RAISE NOTICE 'verify OK: cross-school pairing 0 rows, same-school pairing 1 row';
END
$verify$;
