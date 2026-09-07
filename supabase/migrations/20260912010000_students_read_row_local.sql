-- ═══════════════════════════════════════════════════════════════════════════
-- students_read cannot see the row the same statement is inserting
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- `students_read` is `id IN (SELECT my_visible_student_ids())`, and that
-- function's body is `SELECT s.id FROM public.students s WHERE ...`. It is the
-- same self-referential shape 20260909000000 removed from `exams_read`, and it
-- has both of that shape's consequences:
--
--   CORRECTNESS. A STABLE function sees the statement snapshot, so during
--   `INSERT ... RETURNING` — which is what PostgREST issues for
--   `.insert(...).select()` — the row being inserted is not in it, and the
--   insert is refused `42501 new row violates row-level security policy`.
--   Today `students` is rescued by a SECOND permissive policy,
--   `students admin and principal all`, whose predicate is row-local. Measured
--   as admin over real HTTP: `POST /students` with return=representation
--   returns 201. The rescue is ROLE-SHAPED: it covers admin and principal and
--   nobody else, so any insert by a teacher or a self-registration path would
--   fail with a message naming row-level security while every visibility term
--   is true. That was KNOWN_ISSUES 21.
--
--   COST — AND THIS CLAIM WAS WRONG, so it is corrected here rather than
--   quietly dropped. An earlier version of this header said the policy was
--   O(n²) because it "scans students once per student row". It does not:
--   `id IN (SELECT my_visible_student_ids())` is a hashed SubPlan, so the
--   function runs ONCE per statement and each row is a hash lookup. Measured
--   after the change, reading the roster as a teacher: 580 / 890 / 415 ms
--   against 463 / 190 / 619 ms before — indistinguishable at this row count.
--   There is no performance case for this change. The correctness one below
--   stands on its own.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- `can_read_student_row` takes the row's own columns and returns the identical
-- predicate, without ever selecting from `students`. Term for term the body of
-- `my_visible_student_ids`, with `s.` replaced by the argument.
--
-- SECURITY DEFINER is load-bearing, exactly as it was for exams:
-- `my_teacher_class_ids()` and `active_local_person_id()` are not executable by
-- `authenticated`, so inlining this predicate into the policy would turn every
-- teacher and parent read into `permission denied for function`.
--
-- `my_visible_student_ids()` is left in place: other policies reference it
-- against OTHER tables, where selecting from `students` is not self-reference.
-- Only the policy ON `students` is changed.
--
-- §10.19 Multi-tenancy — the tenancy term (`school_id IN
-- my_accessible_school_ids()`) is carried across unchanged; probe26 asserts it
-- still refuses another school.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.can_read_student_row(
  _id             uuid,
  _school_id      uuid,
  _user_id        uuid,
  _parent_user_id uuid,
  _class_id       uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       -- Operators: the whole institution.
       (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
       OR (SELECT public.has_role(auth.uid(), 'principal'::public.app_role))
       -- The student themselves, resolved through the active membership.
       OR (
            (SELECT public.active_membership_role()) = 'student'
            AND _user_id = auth.uid()
            AND _id = (SELECT public.active_local_person_id())
          )
       -- Guardians, both linkages, exactly as students_read had it.
       OR (
            (SELECT public.active_membership_role()) = 'parent'
            AND (
              _parent_user_id = auth.uid()
              OR _id IN (
                   SELECT ps.student_id FROM public.parent_students ps
                    WHERE ps.parent_id = (SELECT public.active_local_person_id())
                 )
            )
          )
       -- Teachers, for the classes they teach.
       OR _class_id IN (SELECT public.my_teacher_class_ids())
     )
$function$;

REVOKE ALL ON FUNCTION public.can_read_student_row(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_student_row(uuid, uuid, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.can_read_student_row(uuid, uuid, uuid, uuid, uuid) IS
  'Row-local form of my_visible_student_ids: the same predicate, asked about one '
  'student''s own columns instead of by scanning public.students. Used by '
  'students_read so the policy does not refuse a row the same statement is '
  'inserting (42501). SECURITY DEFINER is required: my_teacher_class_ids and '
  'active_local_person_id are not executable by authenticated.';

DROP POLICY IF EXISTS students_read ON public.students;
CREATE POLICY students_read ON public.students
FOR SELECT
USING (public.can_read_student_row(id, school_id, user_id, parent_user_id, class_id));

COMMENT ON FUNCTION public.my_visible_student_ids() IS
  'Set of student ids the caller may read. NOT usable in a policy ON '
  'public.students itself: it selects from that table, so during '
  'INSERT ... RETURNING it cannot see the row being inserted and the insert is '
  'refused 42501. students_read uses can_read_student_row instead. Safe in '
  'policies on OTHER tables that reference students.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only; runs as postgres and proves nothing about who is
-- admitted (rule 6). probe26 asserts the behaviour as the caller (rule 7):
-- every role that could read a student before still can, another school still
-- cannot, and an admin insert with RETURNING still succeeds.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _pol   text;
  _fn    text;
  _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  SELECT regexp_replace(pg_get_expr(p.polqual, p.polrelid), _strip, '', 'g')
    INTO _pol
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'students' AND p.polname = 'students_read';
  IF _pol IS NULL THEN
    RAISE EXCEPTION 'ABORT: students_read is missing';
  END IF;
  IF _pol ~ 'my_visible_student_ids' THEN
    RAISE EXCEPTION 'ABORT: students_read still resolves through my_visible_student_ids';
  END IF;
  IF _pol !~ 'can_read_student_row' THEN
    RAISE EXCEPTION 'ABORT: students_read does not use the row-local predicate';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'can_read_student_row';
  IF _fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: can_read_student_row was not created';
  END IF;
  IF _fn !~ 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'ABORT: can_read_student_row is not SECURITY DEFINER';
  END IF;
  IF _fn ~ 'FROM\s+public\.students' THEN
    RAISE EXCEPTION 'ABORT: can_read_student_row scans public.students -- the defect is back';
  END IF;
  -- Every branch of the original predicate must survive.
  IF _fn !~ 'my_accessible_school_ids' OR _fn !~ 'my_teacher_class_ids'
     OR _fn !~ 'parent_students' OR _fn !~ 'active_local_person_id'
     OR _fn !~ 'principal' OR _fn !~ 'admin' THEN
    RAISE EXCEPTION 'ABORT: a branch of the student visibility predicate was lost';
  END IF;
  IF NOT has_function_privilege('authenticated',
        'public.can_read_student_row(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated cannot execute can_read_student_row';
  END IF;

  RAISE NOTICE 'students_read is row-local; behaviour is asserted in probe26.';
END $verify$;
