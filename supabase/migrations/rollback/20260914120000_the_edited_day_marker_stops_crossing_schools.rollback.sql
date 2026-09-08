-- Rollback for 20260914120000_the_edited_day_marker_stops_crossing_schools.sql
--
-- Restores the view WITHOUT its school fence and gives anon SELECT back, which
-- is the state measured before the forward migration: asked as anon, as a
-- student and as the owner, all three saw the same 20 rows across every school
-- the view could reach.
--
-- Rolling this back re-opens a §10.19 hole. Do it only to unblock something
-- else, and re-apply.

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
   GROUP BY ((aa.metadata ->> 'submission_id'::text))::uuid, s.section_id, s.date, s.school_id;

GRANT SELECT ON public.attendance_day_edits TO anon;

COMMENT ON VIEW public.attendance_day_edits IS
  'Whether a submitted attendance day was changed afterwards. NOT '
  'security_invoker and NOT school-fenced: it returns every school it can '
  'reach, to any caller including anon. See 20260914120000.';

DO $verify$
DECLARE _def text;
BEGIN
  SELECT pg_get_viewdef('public.attendance_day_edits'::regclass, true) INTO _def;

  IF _def ILIKE '%my_accessible_school_ids%' THEN
    RAISE EXCEPTION 'ABORT: the fence survived the rollback';
  END IF;

  IF NOT has_table_privilege('anon', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: the anon grant was not restored';
  END IF;

  -- Positive control: the rollback must not have cost the legitimate readers
  -- their access on the way to restoring anon's.
  IF NOT has_table_privilege('authenticated', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: authenticated lost the marker during the rollback';
  END IF;

  RAISE NOTICE 'the marker is unfenced and anon-readable again, as it was before 20260914120000.';
END $verify$;

COMMIT;
