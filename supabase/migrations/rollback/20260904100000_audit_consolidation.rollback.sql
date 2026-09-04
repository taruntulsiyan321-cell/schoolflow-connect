-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — split academic_audit back into three tables
--
-- This is a genuine inverse, and it is only genuine because the forward
-- migration stamped every moved row with `metadata->>'migrated_from'`. Without
-- that marker the 50 migrated rows would be indistinguishable from the 8,828
-- native ones and this file would be a guess. It is not: each row goes back to
-- the table it came from, identified by its own provenance.
--
-- WHAT CANNOT BE RESTORED EXACTLY
--
-- Original `id` values are NOT preserved. The forward migration let
-- academic_audit assign fresh uuids, so rows return with new primary keys.
-- Nothing referenced those ids — neither table had an inbound foreign key —
-- so no relationship breaks. But an external system that recorded an
-- attendance_audit.id before the consolidation will not find it again.
--
-- `academic_audit.entity_id` goes back to NOT NULL. That is only possible
-- because the nine rows that hold a NULL there are exactly the nine migrated
-- ones, which this file removes first. The guard below refuses to run if a
-- NATIVE row has since been written with a NULL entity_id — dropping it to
-- satisfy a constraint would be destroying an audit record.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  _native_null int;
BEGIN
  IF to_regclass('public.attendance_audit') IS NOT NULL
     OR to_regclass('public.audit_logs') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: attendance_audit or audit_logs already exists; nothing to roll back';
  END IF;

  SELECT count(*) INTO _native_null
    FROM public.academic_audit
   WHERE entity_id IS NULL AND NOT (metadata ? 'migrated_from');
  IF _native_null <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % native audit row(s) have a NULL entity_id and would be destroyed by restoring NOT NULL',
      _native_null;
  END IF;
END
$guard$;

CREATE TABLE public.audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action        text NOT NULL,
  entity        text,
  entity_id     uuid,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  school_id     uuid REFERENCES public.schools(id)
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.attendance_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  student_id    uuid REFERENCES public.students(id) ON DELETE SET NULL,
  class_id      uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  date          date,
  prev_status   text,
  new_status    text,
  edited_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at     timestamptz NOT NULL DEFAULT now(),
  school_id     uuid NOT NULL REFERENCES public.schools(id),
  submission_id uuid REFERENCES public.attendance_submissions(id) ON DELETE CASCADE
);
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;

INSERT INTO public.audit_logs (actor_user_id, action, entity, entity_id, metadata, created_at, school_id)
SELECT actor_user_id, action, entity_type, entity_id,
       metadata - 'migrated_from', created_at, school_id
  FROM public.academic_audit
 WHERE metadata->>'migrated_from' = 'audit_logs';

INSERT INTO public.attendance_audit
  (attendance_id, student_id, class_id, date, prev_status, new_status,
   edited_by, edited_at, school_id, submission_id)
SELECT entity_id,
       (metadata->>'student_id')::uuid,
       (metadata->>'class_id')::uuid,
       (metadata->>'date')::date,
       previous_value #>> '{}',
       new_value #>> '{}',
       actor_user_id, created_at, school_id,
       (metadata->>'submission_id')::uuid
  FROM public.academic_audit
 WHERE metadata->>'migrated_from' = 'attendance_audit';

DELETE FROM public.academic_audit WHERE metadata ? 'migrated_from';

ALTER TABLE public.academic_audit ALTER COLUMN entity_id SET NOT NULL;

-- The writer and reader go back to the dedicated table.
CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _school uuid; _section uuid; _date date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT s.section_id, s.date INTO _section, _date
      FROM public.attendance_submissions s WHERE s.id = NEW.submission_id;
    SELECT school_id INTO _school FROM public.classes WHERE id = _section;
    INSERT INTO public.attendance_audit (
      attendance_id, student_id, class_id, date,
      prev_status, new_status, edited_by, school_id, submission_id
    ) VALUES (
      NEW.id, NEW.student_id, _section, _date,
      OLD.status::text, NEW.status::text, auth.uid(),
      coalesce(_school, NEW.school_id, public.default_school_id()),
      NEW.submission_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP VIEW IF EXISTS public.attendance_day_edits;
CREATE VIEW public.attendance_day_edits AS
SELECT aa.submission_id, s.section_id, s.date, s.school_id,
       count(*) AS edit_count,
       count(DISTINCT aa.student_id) AS students_changed,
       max(aa.edited_at) AS last_edited_at,
       (array_agg(aa.edited_by ORDER BY aa.edited_at DESC))[1] AS last_edited_by
  FROM public.attendance_audit aa
  JOIN public.attendance_submissions s ON s.id = aa.submission_id
 GROUP BY aa.submission_id, s.section_id, s.date, s.school_id;

-- The policies as they were, including the one that let the principal read.
CREATE POLICY "audit auth insert" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "audit principal admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));
CREATE POLICY audit_logs_tenant_fence ON public.audit_logs
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING ((school_id IS NULL) OR public.same_school(school_id))
  WITH CHECK ((school_id IS NULL) OR public.same_school(school_id));

CREATE POLICY "audit no client insert" ON public.attendance_audit
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "audit school staff read" ON public.attendance_audit
  FOR SELECT TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));
CREATE POLICY attendance_audit_tenant_fence ON public.attendance_audit
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING ((school_id IS NULL) OR public.same_school(school_id))
  WITH CHECK ((school_id IS NULL) OR public.same_school(school_id));

DROP POLICY IF EXISTS academic_audit_admin_select ON public.academic_audit;
CREATE POLICY academic_audit_admin_select ON public.academic_audit
  FOR SELECT TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

COMMENT ON TABLE public.academic_audit IS NULL;

DO $verify$
DECLARE _aa int; _att int; _log int;
BEGIN
  SELECT count(*) INTO _aa  FROM public.academic_audit;
  SELECT count(*) INTO _att FROM public.attendance_audit;
  SELECT count(*) INTO _log FROM public.audit_logs;
  IF _att <> 48 OR _log <> 2 THEN
    RAISE EXCEPTION 'expected 48 attendance + 2 log rows restored, found % and %', _att, _log;
  END IF;
  IF _aa <> 8828 THEN
    RAISE EXCEPTION 'expected academic_audit back to 8828, found %', _aa;
  END IF;
  IF EXISTS (SELECT 1 FROM public.academic_audit WHERE metadata ? 'migrated_from') THEN
    RAISE EXCEPTION 'migrated rows remain in academic_audit';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations WHERE version = '20260904100000_audit_consolidation';

COMMIT;
