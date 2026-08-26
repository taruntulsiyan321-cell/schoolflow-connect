-- ROLLBACK — Chunk 4.5, converge roll_number (20260826190000).
--
-- Restores students.roll_number and refills it from the current year's
-- enrolment, then drops the view and repoints the four functions back.
-- Reinstating the column reinstates the split-brain: nothing will keep it in
-- step with student_enrolments, and no error will be raised when it drifts.

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS roll_number text;

UPDATE public.students s
   SET roll_number = en.roll_number
  FROM public.student_enrolments en
  JOIN public.academic_years ay ON ay.id = en.academic_year_id AND ay.is_current
 WHERE en.student_id = s.id AND en.to_date IS NULL;

-- The functions must go back to reading the column before the view is dropped.
DO $$
DECLARE _src text; _p record;
BEGIN
  FOR _p IN
    SELECT p.proname, p.prosrc, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS ret, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('rpc_leaderboard','rpc_teacher_class_insights','rpc_student_academic_snapshot')
  LOOP
    _src := replace(_p.prosrc, 'public.students_current', 'public.students');
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS %L',
      _p.proname, _p.args, _p.ret, _src);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_classmates()
RETURNS TABLE(student_id uuid, user_id uuid, full_name text, roll_number text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id, s.user_id, s.full_name, s.roll_number, s.photo_url
    FROM public.students s
   WHERE s.class_id = (SELECT class_id FROM public.students WHERE user_id = auth.uid() LIMIT 1)
     AND public.same_school(s.school_id)
   ORDER BY s.roll_number NULLS LAST, s.full_name;
$$;

DROP VIEW IF EXISTS public.students_current;
