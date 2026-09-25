-- Rollback for 20261078000000_private_student_tables_are_not_anon_writable.sql
--
-- Restores Supabase's default grant on the five private student tables: ALL to
-- anon and authenticated. That is the state they were created in, and it is
-- the state this migration deliberately left.
--
-- Rolling this back does NOT open a leak by itself — RLS remains the fence and
-- refuses anon on every one of these tables. It removes the second layer, so
-- the fence becomes one policy deep again.

BEGIN;

GRANT ALL ON TABLE public.student_uploads TO anon, authenticated;
GRANT ALL ON TABLE public.student_upload_questions TO anon, authenticated;
GRANT ALL ON TABLE public.student_upload_notes TO anon, authenticated;
GRANT ALL ON TABLE public.student_capture_questions TO anon, authenticated;
GRANT ALL ON TABLE public.student_capture_allowed_apps TO anon, authenticated;

DO $verify$
BEGIN
  IF NOT has_table_privilege('anon', 'public.student_uploads', 'SELECT') THEN
    RAISE EXCEPTION 'ROLLED BACK: the rollback did not restore the default grant';
  END IF;
  RAISE NOTICE 'OK: default grants restored; RLS is once again the only layer';
END
$verify$;

COMMIT;
