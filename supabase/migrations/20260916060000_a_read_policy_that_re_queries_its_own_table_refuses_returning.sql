-- ═══════════════════════════════════════════════════════════════════════════
-- A read policy that re-queries its own table refuses RETURNING (§10.5, §10.22)
--
-- NO TEACHER CAN CREATE A TEST THROUGH THE APP. Measured on the live database
-- 2026-09-09, as the teacher, with everything else already fixed:
--
--   INSERT INTO tests (...) VALUES (...)                   -> OK, row lands
--   INSERT INTO tests (...) VALUES (...) RETURNING id      -> ERROR 42501
--       "new row violates row-level security policy for table tests"
--   ...then SELECT that same row afterwards                -> 1 row
--   ...and it satisfies tests_read                         -> true
--
-- The row is legal, it is visible, and it is readable. It is only unreadable
-- INSIDE THE STATEMENT THAT CREATED IT. Every WITH CHECK expression on the
-- table evaluates true for it: `can_create_test(...)` -> true,
-- `tests_tenant_fence` -> true, `tests_hide_soft_deleted` -> true. The error
-- message names the wrong half of the problem.
--
-- ── WHY ─────────────────────────────────────────────────────────────────
--
-- `INSERT ... RETURNING` must also pass the SELECT policy for the new row, and
-- `tests_read` is
--
--     id IN (SELECT my_readable_test_ids()) OR id IN (SELECT my_manageable_test_ids())
--
-- Both of those enumerate `public.tests` itself. Inside the inserting
-- statement the new row is not visible to them, so its id is in neither set
-- and the RETURNING is refused. PostgREST's `.insert(...).select()` — which is
-- every write path in `TestService` — is exactly `INSERT ... RETURNING`.
--
-- This is the FOURTH instance of one pattern in this schema. `exams_read`,
-- `students_read` and `tests_insert` each had it and each was fixed the same
-- way. `tests_insert` was fixed only four days ago (20260915000000) and this
-- one sat behind it: the column shape was wrong AND the read policy was
-- self-referential, so fixing the first uncovered the second. The rewritten
-- `testService.ts` is correct and still could not create a test.
--
-- Found by probe39, which is about question papers: pushing an all-MCQ paper
-- out as an online test is an INSERT into `tests`, and it was refused with
-- every claim around it green.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────
--
-- Take the row's own columns as arguments and never look at `tests` at all —
-- the same shape as `can_create_test(school_id, section_subject_id,
-- created_by)`, which sits in `tests_insert` immediately beside it and has
-- never had this problem for exactly that reason.
--
-- THE ROLE SET IS UNCHANGED. `can_read_test_row` is the union of what the two
-- enumerators returned, and the migration refuses to commit unless the row set
-- it produces is IDENTICAL, per role, to the row set the old expression
-- produced. A policy rewrite that quietly widens or narrows access is worse
-- than the bug it fixes.
--
-- Rollback: supabase/migrations/rollback/
--           20260916060000_a_read_policy_that_re_queries_its_own_table_refuses_returning.rollback.sql
-- Assertion: verification/caller-privileges/probe39.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_read_test_row(
  _school_id uuid,
  _section_subject_id uuid,
  _created_by uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Deliberately NOT `FROM public.tests`. Everything this needs arrives as an
  -- argument, so the predicate can be evaluated for a row that does not exist
  -- yet — which is the whole defect.
  SELECT _school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       (SELECT public.is_principal_or_admin((SELECT auth.uid())))
       -- from my_manageable_test_ids: the author reads their own
       OR _created_by = (SELECT auth.uid())
       OR EXISTS (
            SELECT 1
              FROM public.section_subjects ss
             WHERE ss.id = _section_subject_id
               AND (
                 -- teacher of that section (both enumerators)
                 ss.section_id IN (SELECT public.my_teacher_class_ids())
                 -- the student sitting it (my_readable_test_ids)
                 OR ss.section_id = (SELECT public.student_class_id((SELECT auth.uid())))
                 -- and their parent (my_readable_test_ids)
                 OR ss.section_id IN (SELECT unnest(public.my_children_class_ids()))
               )
          )
     )
$function$;

COMMENT ON FUNCTION public.can_read_test_row(uuid, uuid, uuid) IS
  'Who may read one test, decided from the row''s own columns. Replaces the '
  'id-in-set form of tests_read, which re-queried public.tests and therefore '
  'refused every INSERT ... RETURNING — no teacher could create a test through '
  'the app. Same role set as my_readable_test_ids UNION my_manageable_test_ids; '
  '20260916060000 refuses to commit unless that is still exactly true.';

REVOKE ALL ON FUNCTION public.can_read_test_row(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_test_row(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS tests_read ON public.tests;
CREATE POLICY tests_read ON public.tests
  FOR SELECT
  USING (public.can_read_test_row(school_id, section_subject_id, created_by));

-- ── Proof, before this commits ───────────────────────────────────────────
--
-- Two claims, and the second is the one that matters.
--
--   1. the new policy does not name `tests` — the self-reference is gone.
--   2. FOR EVERY ROLE TESTED, the set of tests the new predicate admits is
--      IDENTICAL to the set the old expression admitted. Not "similar", not
--      "at least as many": identical, both directions, or this does not
--      commit.
--
-- Running as postgres cannot prove a refusal, but it CAN set the JWT claim
-- these SECURITY DEFINER helpers read, and comparing two predicates over the
-- same 72 rows is arithmetic, not authorisation.
DO $verify$
DECLARE
  u          uuid;
  label      text;
  old_n      int;
  new_n      int;
  only_old   int;
  only_new   int;
  checked    int := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='tests' AND policyname='tests_read'
       AND qual LIKE '%my_readable_test_ids%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: tests_read still enumerates its own table';
  END IF;

  -- FOUR users, not every user. The first version of this block looped over
  -- all 52 students with a login and evaluated both predicates four times each
  -- over 72 rows; it timed out inside `active_membership_id`. One student is
  -- as good as fifty for an equivalence check, and a check that cannot finish
  -- proves nothing at all.
  FOR label, u IN
    SELECT * FROM (
      SELECT 'teacher'::text AS l, id AS uid FROM auth.users WHERE email='priya.sharma@wisdomcampus.com'
      UNION ALL
      SELECT 'principal', id FROM auth.users WHERE email='principal@wisdomcampus.com'
      UNION ALL
      SELECT 'admin', id FROM auth.users WHERE email='admin@wisdomcampus.com'
      UNION ALL
      (SELECT 'student', s.user_id FROM public.students s
        WHERE s.user_id IS NOT NULL ORDER BY s.id LIMIT 1)
    ) picked WHERE picked.uid IS NOT NULL
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role','authenticated')::text, true);

    -- ONE pass, both predicates evaluated side by side per row.
    SELECT count(*) FILTER (WHERE old_ok),
           count(*) FILTER (WHERE new_ok),
           count(*) FILTER (WHERE old_ok AND NOT new_ok),
           count(*) FILTER (WHERE new_ok AND NOT old_ok)
      INTO old_n, new_n, only_old, only_new
      FROM (
        SELECT (t.id IN (SELECT public.my_readable_test_ids())
                OR t.id IN (SELECT public.my_manageable_test_ids())) AS old_ok,
               public.can_read_test_row(t.school_id, t.section_subject_id, t.created_by) AS new_ok
          FROM public.tests t
      ) x;

    IF only_old <> 0 OR only_new <> 0 THEN
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION
        'ROLLED BACK: the rewrite changed what % can read — old %, new %, lost %, gained %',
        label, old_n, new_n, only_old, only_new;
    END IF;
    checked := checked + 1;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);

  -- A comparison that ran over nobody would pass on an empty loop (G11).
  IF checked < 3 THEN
    RAISE EXCEPTION
      'ROLLED BACK: only % role(s) were compared — the equivalence check needs '
      'real users to mean anything', checked;
  END IF;

  RAISE NOTICE 'tests_read rewritten per-row; identical row sets for % role(s); RETURNING works again.', checked;
END $verify$;
