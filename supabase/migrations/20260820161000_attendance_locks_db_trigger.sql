-- Defense in depth: the previous migration enforced attendance_locks in the
-- two application write paths (attendanceRepository.ts's single-row
-- upsertAttendance, and rpc_bulk_upsert_attendance for the bulk path). But
-- a direct PostgREST call to /rest/v1/attendance (bypassing the app's
-- service layer entirely) would still succeed, since teacher/admin already
-- hold real RLS UPDATE rights on the attendance table itself ("att teacher
-- manage class" / "att admin all") -- the exact same class of gap as the
-- original bug, just one layer lower. A BEFORE INSERT OR UPDATE trigger on
-- attendance itself closes this for every write path uniformly, including
-- ones this migration's author didn't anticipate.

CREATE OR REPLACE FUNCTION public.tg_reject_locked_attendance_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.attendance_locks al
    WHERE al.class_id = NEW.class_id
      AND al.date = NEW.date
      AND al.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'Attendance for this class and date is locked and cannot be edited';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_attendance_reject_if_locked
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_reject_locked_attendance_write();
