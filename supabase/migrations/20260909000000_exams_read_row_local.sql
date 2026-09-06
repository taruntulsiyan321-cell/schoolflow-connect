-- ═══════════════════════════════════════════════════════════════════════════
-- A teacher could not create an exam, because the read policy could not see
-- the row the same statement was inserting
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- `exams_read` is the ONLY SELECT policy on public.exams, and it is written
-- entirely as a self-lookup:
--
--     USING ( school_id IN (SELECT my_accessible_school_ids())
--             AND ( id IN (SELECT my_visible_exam_ids())
--                   OR (is_super_admin() AND super_admin_has_any_access()) ) )
--
-- `my_visible_exam_ids()` is STABLE and its body is `SELECT e.id FROM
-- public.exams e WHERE ...`. A STABLE function sees the snapshot taken at the
-- start of the calling statement. The row an INSERT is currently writing is
-- not in that snapshot. So for `INSERT ... RETURNING`, the policy asks "is
-- this id already among the exams I can see?" about a row that does not exist
-- yet, gets false, and PostgreSQL raises
--
--     42501  new row violates row-level security policy for table "exams"
--
-- PostgREST sends `Prefer: return=representation` for `.insert(...).select()`,
-- which is exactly what `examRepository.createClassExam` does. So EVERY exam
-- creation through the app was refused, for every role, always.
--
-- ── MEASURED, BOTH DIRECTIONS, OVER REAL HTTP AS PRIYA SHARMA ────────────
--
-- Same JWT, same session, same payload, same row; only the Prefer header
-- differs:
--
--   | request                            | result                          |
--   |------------------------------------|---------------------------------|
--   | POST /exams  return=representation | 403 42501 (what the app sends)  |
--   | POST /exams  return=minimal        | 201                             |
--   | GET  /exams  (separate statement)  | 200 -- the row IS readable      |
--
-- The row satisfies both the INSERT WITH CHECK and the SELECT policy once it
-- is committed. It fails only while being inserted. Every term of
-- `exams_insert` was independently confirmed true for that caller:
-- same_school = true, active_membership_role = 'teacher',
-- teacher_teaches_class = true, my_accessible_school_ids = the right school.
--
-- The contrast that proves the mechanism: `students` carries the SAME
-- self-referential shape in `students_read`, and admin inserts there succeed --
-- because `students` ALSO has a permissive `students admin and principal all`
-- policy whose predicate is row-local, and permissive policies are OR-ed.
-- `exams` has no such second policy, so nothing rescues it.
--
-- This is why `examination.scheduled` and `marks.results_published` have zero
-- rows in `academic_events` while six exams carry `results_published_at`: no
-- exam has ever been created through the application. The seed wrote them.
--
-- ── THE FIX, AND THE TRAP IT AVOIDS ──────────────────────────────────────
--
-- Ask the question about the ROW rather than about the table. The obvious
-- shape -- inline the CASE into the policy -- is WRONG here, and measurably so:
--
--     my_teacher_class_ids()   authenticated EXECUTE: false
--     my_children_class_ids()  authenticated EXECUTE: false
--
-- Today those run inside `my_visible_exam_ids()`, which is SECURITY DEFINER,
-- so they execute as the owner. Inlined into a policy they would execute as
-- the CALLER, and every teacher and parent read of exams would fail with
-- `permission denied for function` instead of returning rows. That is the
-- same failure mode as the security_invoker trash view in Chunk 9.5.
--
-- So the indirection stays; only the self-reference goes. `can_read_exam_row`
-- takes the row's own school_id and class_id and returns the identical
-- predicate `my_visible_exam_ids` computes, without ever scanning exams.
--
-- NOT A WIDENING. The predicate is unchanged term for term, and the new
-- function is reachable by exactly the roles that can reach
-- `my_visible_exam_ids` today (its ACL is `=X/postgres`, i.e. PUBLIC -- anon
-- and authenticated both hold EXECUTE). It is granted here to `anon,
-- authenticated, service_role` explicitly rather than to PUBLIC, so the same
-- callers keep the same access without adding another function whose
-- reachability hangs on a PUBLIC grant.
--
-- §10.5 Teacher panel > Exams (docs/locked-decisions.md:207-213) -- "The class
-- teacher creates the exam for their own section only", and "Exam marks
-- uploaded by the subject teacher for their own subject". A policy that
-- refuses the class teacher's own INSERT is not enforcing that rule, it is
-- preventing the only path the rule describes.
--
-- NOT §10.13, which is "Report card" (line 475). An earlier draft of this
-- header cited it; the citation was wrong and is corrected here rather than
-- left to be inherited by the next reader.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The predicate, asked about a row instead of about the table ──────────
CREATE OR REPLACE FUNCTION public.can_read_exam_row(_school_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _school_id = (SELECT public.active_membership_school_id())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN _class_id IN (SELECT public.my_teacher_class_ids())
           WHEN 'student'   THEN _class_id = (SELECT public.student_class_id(auth.uid()))
           WHEN 'parent'    THEN _class_id IN (SELECT unnest(public.my_children_class_ids()))
           ELSE false
         END
$function$;

REVOKE ALL ON FUNCTION public.can_read_exam_row(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_exam_row(uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.can_read_exam_row(uuid, uuid) IS
  'Row-local form of my_visible_exam_ids: same predicate, asked about one '
  'exam''s school_id and class_id instead of by scanning public.exams. Used by '
  'exams_read so the policy can answer for a row the current statement is '
  'still inserting -- a self-lookup cannot, because a STABLE function sees the '
  'statement snapshot. SECURITY DEFINER is load-bearing: my_teacher_class_ids '
  'and my_children_class_ids are not executable by authenticated.';

-- ── The policy stops asking the table about the row ──────────────────────
DROP POLICY IF EXISTS exams_read ON public.exams;
CREATE POLICY exams_read ON public.exams
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    public.can_read_exam_row(school_id, class_id)
    OR ((SELECT public.is_super_admin()) AND (SELECT public.super_admin_has_any_access()))
  )
);

COMMENT ON FUNCTION public.my_visible_exam_ids() IS
  'Set of exam ids the caller may read. NOT usable in a policy ON public.exams '
  'itself: it selects from that table, so during INSERT ... RETURNING it '
  'cannot see the row being inserted and the insert is refused 42501. '
  'exams_read uses can_read_exam_row instead. Safe in policies on OTHER tables '
  'that reference exams.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres`, which bypasses RLS, so it proves NOTHING about who is
-- admitted or refused (rule 6). It checks only the shape of what was
-- installed. The behavioural claims -- that the class teacher can now create
-- an exam and read it back, that a teacher still cannot read another school's
-- exam, that a student still sees only their own class -- are asserted as the
-- caller in probe19.sql (rule 7).
--
-- Every match strips comments first. This migration's own header contains the
-- string `my_visible_exam_ids` many times; without stripping, the check that
-- the policy no longer calls it would pass or fail on prose.
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
   WHERE n.nspname = 'public' AND c.relname = 'exams' AND p.polname = 'exams_read';

  IF _pol IS NULL THEN
    RAISE EXCEPTION 'ABORT: exams_read is missing after this migration';
  END IF;

  -- The self-reference is the defect. It must be gone from the policy.
  IF _pol ~ 'my_visible_exam_ids' THEN
    RAISE EXCEPTION 'ABORT: exams_read still resolves through my_visible_exam_ids';
  END IF;
  IF _pol !~ 'can_read_exam_row' THEN
    RAISE EXCEPTION 'ABORT: exams_read does not use the row-local predicate';
  END IF;

  -- ...and the tenancy terms must survive, or this "fix" is a leak.
  IF _pol !~ 'my_accessible_school_ids' THEN
    RAISE EXCEPTION 'ABORT: exams_read lost its accessible-schools term';
  END IF;
  IF _pol !~ 'super_admin' THEN
    RAISE EXCEPTION 'ABORT: exams_read lost the super_admin branch';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'can_read_exam_row';

  IF _fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: can_read_exam_row was not created';
  END IF;
  -- SECURITY DEFINER is not a style choice here: without it the caller needs
  -- EXECUTE on my_teacher_class_ids and my_children_class_ids, which
  -- authenticated does not hold, and every teacher/parent read would error.
  IF _fn !~ 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'ABORT: can_read_exam_row is not SECURITY DEFINER';
  END IF;
  -- It must not reintroduce the self-scan it exists to remove.
  IF _fn ~ 'FROM\s+public\.exams' THEN
    RAISE EXCEPTION 'ABORT: can_read_exam_row scans public.exams -- the defect is back';
  END IF;
  IF NOT has_function_privilege('authenticated',
        'public.can_read_exam_row(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated cannot execute can_read_exam_row';
  END IF;

  RAISE NOTICE 'exams_read is row-local; behaviour is asserted as the caller in probe19.';
END $verify$;

COMMIT;
