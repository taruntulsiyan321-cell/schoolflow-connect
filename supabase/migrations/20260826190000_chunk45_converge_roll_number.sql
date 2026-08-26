-- =====================================================================
-- CHUNK 4.5 — CONVERGE roll_number
--
-- students.roll_number was a split-brain of the same shape as user_roles: the
-- authority is student_enrolments.roll_number (per student PER ACADEMIC YEAR,
-- because roll numbers change annually and are reused), while a second copy
-- sat on students that nothing maintained and no error ever flagged.
-- 26 files and 4 SQL functions read the stale copy.
--
-- HOW THE CONVERGENCE IS EXPRESSED — stated because it is a judgement:
-- the doc says "point every one at student_enrolments, scoped to the current
-- academic year". Eighteen distinct queries read the column. Hand-writing the
-- same current-year join eighteen times would put one rule in eighteen
-- places — the same "computed in more than one place" failure the metric
-- layer exists to prevent. So the join is written ONCE, as a view, and the
-- callers read the view.
--
--     public.students_current  =  students.*  +  the current year's roll_number
--
-- security_invoker = true (PG 17.6) so the view inherits students' RLS rather
-- than running as its owner. Without it the view would be a service-role-
-- shaped hole around every policy on students — precisely the mistake Chunk
-- 11's "RLS is not the whole fence" section warns about.
--
-- ORDER MATTERS: the column is dropped BEFORE the view is created. `SELECT
-- s.*, e.roll_number` would otherwise collide on a duplicate column name.
--
-- LOSSLESS — verified before writing this, not assumed:
--   students holding a roll number ................................ 13
--   of those, missing a current-year enrolment roll ................ 0
--   values that disagree between the two ........................... 0
--
-- G9: after this there is ONE roll number. The column is DROPPED, not
-- commented-deprecated, so a new call site cannot be written against it.
--
-- Reverse: supabase/migrations/rollback/20260826190000_chunk45_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — refuse to proceed if the drop would lose anything
-- ---------------------------------------------------------------------

DO $$
DECLARE _orphan int; _mismatch int;
BEGIN
  SELECT count(*) INTO _orphan
    FROM public.students s
   WHERE s.roll_number IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.student_enrolments en
         JOIN public.academic_years ay ON ay.id = en.academic_year_id
        WHERE en.student_id = s.id AND ay.is_current
          AND en.to_date IS NULL AND en.roll_number IS NOT NULL);
  IF _orphan > 0 THEN
    RAISE EXCEPTION
      'Chunk 4.5: % student(s) hold a roll number with no current-year enrolment to carry it; refusing to drop the column', _orphan;
  END IF;

  SELECT count(*) INTO _mismatch
    FROM public.students s
    JOIN public.student_enrolments en ON en.student_id = s.id
    JOIN public.academic_years ay ON ay.id = en.academic_year_id AND ay.is_current
   WHERE en.to_date IS NULL AND s.roll_number IS DISTINCT FROM en.roll_number;
  IF _mismatch > 0 THEN
    RAISE EXCEPTION
      'Chunk 4.5: % student(s) disagree between students.roll_number and their enrolment; resolve before dropping', _mismatch;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 2 — drop the stale copy
-- ---------------------------------------------------------------------

ALTER TABLE public.students DROP COLUMN IF EXISTS roll_number;


-- ---------------------------------------------------------------------
-- SECTION 3 — the single place the current-year scoping is written
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS public.students_current;
CREATE VIEW public.students_current
WITH (security_invoker = true) AS
SELECT
  s.*,
  e.roll_number
  -- Deliberately NOT exposing the enrolment's section_id here. It would be a
  -- second column on this view referencing classes, and PostgREST then cannot
  -- resolve a classes(...) embed against the view: "more than one relationship
  -- was found". The view exists to carry the roll number; section identity
  -- already lives on students.class_id.
FROM public.students s
LEFT JOIN LATERAL (
  SELECT en.roll_number, en.section_id, en.academic_year_id
    FROM public.student_enrolments en
    JOIN public.academic_years ay ON ay.id = en.academic_year_id
   WHERE en.student_id = s.id
     AND ay.is_current
     AND en.to_date IS NULL
   ORDER BY en.from_date DESC
   LIMIT 1
) e ON true;

COMMENT ON VIEW public.students_current IS
  'students plus the CURRENT academic year''s roll number, from student_enrolments (the authority). The current-year scoping lives here once instead of in every caller. security_invoker: students'' RLS applies to every read through it.';

GRANT SELECT ON public.students_current TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 4 — the four SQL functions read the authority
--
-- Each function is regenerated from its OWN live body with a single textual
-- swap: public.students -> public.students_current. Signature, language,
-- volatility and everything else are read back from the catalogue rather than
-- retyped, so no function can silently acquire a shape I assumed for it.
--
-- All four are SECURITY DEFINER and already perform their own authorization,
-- so reading a security_invoker view from inside them resolves exactly as
-- reading the table did — no change in posture.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  _p record;
  _src text;
  _n int := 0;
BEGIN
  FOR _p IN
    SELECT p.oid,
           p.proname,
           p.prosrc,
           pg_get_function_arguments(p.oid)          AS args,   -- keeps DEFAULTs
           pg_get_function_result(p.oid)             AS ret,
           l.lanname,
           CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE'
                              WHEN 's' THEN 'STABLE'
                              ELSE 'VOLATILE' END    AS vol,
           CASE WHEN p.prosecdef THEN 'SECURITY DEFINER'
                ELSE 'SECURITY INVOKER' END          AS secdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND p.proname IN ('rpc_classmates','rpc_leaderboard',
                         'rpc_teacher_class_insights','rpc_student_academic_snapshot')
  LOOP
    _src := replace(_p.prosrc, 'public.students ', 'public.students_current ');
    _src := replace(_src, 'public.students'  || chr(13), 'public.students_current' || chr(13));
    _src := replace(_src, 'public.students'  || chr(10), 'public.students_current' || chr(10));
    _src := replace(_src, 'FROM public.students WHERE', 'FROM public.students_current WHERE');

    IF _src = _p.prosrc THEN
      RAISE EXCEPTION
        'Chunk 4.5: % does not reference public.students in a recognised form; rewrite it by hand rather than letting this pass silently',
        _p.proname;
    END IF;

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE %s %s %s SET search_path TO ''public'' AS %L',
      _p.proname, _p.args, _p.ret, _p.lanname, _p.vol, _p.secdef, _src);

    _n := _n + 1;
  END LOOP;

  IF _n <> 4 THEN
    RAISE EXCEPTION 'Chunk 4.5: expected to rewrite 4 functions, rewrote %', _n;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 5 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'students'
                AND column_name = 'roll_number') THEN
    RAISE EXCEPTION 'Chunk 4.5: students.roll_number still exists';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views
                  WHERE schemaname = 'public' AND viewname = 'students_current') THEN
    RAISE EXCEPTION 'Chunk 4.5: students_current view missing';
  END IF;

  -- The view must inherit RLS, not bypass it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'students_current'
       AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'Chunk 4.5: students_current is not security_invoker — it would bypass students RLS';
  END IF;

  -- No function may still read the dropped column.
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ '\mpublic\.students\M[^;]*\mroll_number\M';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4.5: % function(s) still read roll_number off public.students', _n;
  END IF;

  -- Every roll number survived the move.
  SELECT count(*) INTO _n FROM public.students_current WHERE roll_number IS NOT NULL;
  IF _n <> 13 THEN
    RAISE EXCEPTION 'Chunk 4.5: expected 13 roll numbers through the view, found %', _n;
  END IF;
END $$;
