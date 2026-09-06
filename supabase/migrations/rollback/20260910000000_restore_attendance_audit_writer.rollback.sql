-- Rollback for 20260910000000_restore_attendance_audit_writer.sql
--
-- Puts back the pre-consolidation writer and the table it wrote to.
--
-- WHAT ROLLING BACK COSTS YOU. The restored body reads `NEW.class_id` and
-- `NEW.date`, which `public.attendance` does not have — they moved to
-- `attendance_submissions`. The trigger fires only when a status actually
-- changes, so every attendance CORRECTION raises
--
--     42703  record "new" has no field "class_id"
--
-- again. §10.5 reserves that correction to admins, so rolling back makes a
-- right the spec grants unexercisable by anyone, and `attendance_audit`
-- receives no rows because the statement that would write them is the one
-- that fails. Marking attendance for the first time keeps working, which is
-- what makes the regression quiet.
--
-- The recreated table starts EMPTY, and that is not a data loss introduced
-- here: it held 0 rows when it was dropped. Its original 48 rows were moved
-- into `academic_audit` by 20260904100000 and carry
-- `metadata.migrated_from = 'attendance_audit'`; they are not touched either
-- way.

BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid,
  student_id    uuid,
  class_id      uuid,
  date          date,
  prev_status   text,
  new_status    text,
  edited_by     uuid,
  edited_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.attendance_audit (attendance_id, student_id, class_id, date, prev_status, new_status, edited_by)
    VALUES (NEW.id, NEW.student_id, NEW.class_id, NEW.date, OLD.status::text, NEW.status::text, auth.uid());
  END IF;
  RETURN NEW;
END $function$;

COMMIT;

DO $verify$
DECLARE _fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_log_attendance_change';
  IF _fn IS NULL OR _fn !~ 'attendance_audit' THEN
    RAISE EXCEPTION 'ABORT: rollback did not restore the legacy writer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='attendance_audit') THEN
    RAISE EXCEPTION 'ABORT: attendance_audit was not recreated';
  END IF;
  RAISE NOTICE 'legacy attendance_audit writer restored (42703 on corrections is back, as intended).';
END $verify$;
