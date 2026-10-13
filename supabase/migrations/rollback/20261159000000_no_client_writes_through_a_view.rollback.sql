-- ROLLBACK 20261159000000 — puts the views' grants back exactly as they were.
--
-- WARNING: this reopens the hole the migration closed. A signed-in account can
-- then rewrite or delete any question through question_bank_student.
-- homework_completion and homework_student_status held SELECT only before and
-- are untouched by both directions.

BEGIN;

GRANT ALL ON public.attendance_current    TO anon, authenticated;
GRANT ALL ON public.attendance_day_edits  TO authenticated;
GRANT ALL ON public.question_bank_student TO authenticated;
GRANT ALL ON public.students_current      TO anon, authenticated;
GRANT ALL ON public.trash                 TO anon, authenticated;

COMMIT;
