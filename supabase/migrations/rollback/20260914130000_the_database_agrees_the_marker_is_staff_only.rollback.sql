-- Rollback for 20260914130000_the_database_agrees_the_marker_is_staff_only.sql
--
-- Removes the ROLE fence and keeps the SCHOOL fence, returning the view to the
-- state 20260914120000 left it in: any authenticated caller of any role may
-- read the edited-day marker for schools they can access.
--
-- That is the two-homes state again -- AttendanceService.summarizeSchoolDate
-- still refuses everyone outside admin/principal/super_admin, so the service
-- and the database disagree about a rule the service states absolutely. Do
-- this only to unblock something else, and re-apply.

BEGIN;

CREATE OR REPLACE VIEW public.attendance_day_edits AS
  SELECT ((aa.metadata ->> 'submission_id'::text))::uuid AS submission_id,
         s.section_id,
         s.date,
         s.school_id,
         count(*) AS edit_count,
         count(DISTINCT ((aa.metadata ->> 'student_id'::text))::uuid) AS students_changed,
         max(aa.created_at) AS last_edited_at,
         (array_agg(aa.actor_user_id ORDER BY aa.created_at DESC))[1] AS last_edited_by
    FROM public.academic_audit aa
    JOIN public.attendance_submissions s
      ON s.id = ((aa.metadata ->> 'submission_id'::text))::uuid
   WHERE aa.entity_type = 'attendance'
     AND aa.metadata ? 'submission_id'
     AND s.school_id IN (SELECT public.my_accessible_school_ids())
   GROUP BY ((aa.metadata ->> 'submission_id'::text))::uuid, s.section_id, s.date, s.school_id;

DO $verify$
DECLARE _def text;
BEGIN
  SELECT pg_get_viewdef('public.attendance_day_edits'::regclass, true) INTO _def;

  IF _def ILIKE '%is_principal_or_admin%' THEN
    RAISE EXCEPTION 'ABORT: the role fence survived the rollback';
  END IF;

  -- Positive control: rolling back the ROLE fence must not take the SCHOOL
  -- fence or the anon revoke with it -- those belong to 20260914120000.
  IF _def NOT ILIKE '%my_accessible_school_ids%' THEN
    RAISE EXCEPTION 'ABORT: the rollback also removed the school fence';
  END IF;
  IF has_table_privilege('anon', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: the rollback handed the marker back to anon';
  END IF;

  RAISE NOTICE 'role fence removed; the school fence and the anon revoke stand.';
END $verify$;

COMMIT;
