-- =====================================================================
-- REVERSE OF: 20260826210000_chunk47_remove_attendance_lock.sql
--
-- Restores the lock apparatus and the teacher's ability to edit.
--
-- IRREVERSIBLE PART, stated plainly: the contents of attendance_locks are
-- gone. This recreates an EMPTY table. Any day that was locked before Chunk
-- 4.7 comes back unlocked, because the rows recording which days those were
-- no longer exist. Nothing else in the schema referenced them, so nothing
-- else is affected.
-- =====================================================================

-- 1. The lock table and its view.
CREATE TABLE IF NOT EXISTS public.attendance_locks (
  submission_id uuid PRIMARY KEY
    REFERENCES public.attendance_submissions(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES public.schools(id),
  locked_at  timestamptz NOT NULL DEFAULT now(),
  locked_by  uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS attendance_locks_school_id_idx
  ON public.attendance_locks (school_id);

ALTER TABLE public.attendance_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_locks_tenant_fence ON public.attendance_locks;
CREATE POLICY attendance_locks_tenant_fence ON public.attendance_locks
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS "locks school read" ON public.attendance_locks;
CREATE POLICY "locks school read" ON public.attendance_locks
  FOR SELECT USING (public.same_school(school_id));

DROP POLICY IF EXISTS "locks teacher insert" ON public.attendance_locks;
CREATE POLICY "locks teacher insert" ON public.attendance_locks
  FOR INSERT WITH CHECK (
    public.same_school(school_id)
    AND EXISTS (
      SELECT 1 FROM public.attendance_submissions s
       WHERE s.id = attendance_locks.submission_id
         AND public.is_class_teacher_of_class(auth.uid(), s.section_id)
    )
  );

DROP POLICY IF EXISTS "locks admin delete" ON public.attendance_locks;
CREATE POLICY "locks admin delete" ON public.attendance_locks
  FOR DELETE USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE OR REPLACE VIEW public.attendance_locks_current
WITH (security_invoker = true) AS
SELECT al.submission_id, al.school_id, al.locked_at, al.locked_by,
       s.section_id AS class_id, s.date
  FROM public.attendance_locks al
  JOIN public.attendance_submissions s ON s.id = al.submission_id;

-- 2. The reject-if-locked trigger.
CREATE OR REPLACE FUNCTION public.tg_reject_locked_attendance_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.attendance_locks al
     WHERE al.submission_id = NEW.submission_id
  ) THEN
    RAISE EXCEPTION 'Attendance for this class and date is locked and cannot be edited';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_reject_if_locked ON public.attendance;
CREATE TRIGGER trg_attendance_reject_if_locked
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_reject_locked_attendance_write();

-- 3. The teacher may write again, not only insert.
DROP POLICY IF EXISTS "att teacher write class" ON public.attendance;
CREATE POLICY "att teacher write class" ON public.attendance
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.attendance_submissions s
             WHERE s.id = attendance.submission_id
               AND public.is_class_teacher_of_class(auth.uid(), s.section_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.attendance_submissions s
             WHERE s.id = attendance.submission_id
               AND public.is_class_teacher_of_class(auth.uid(), s.section_id))
  );

-- 4. The edited-day marker.
DROP VIEW IF EXISTS public.attendance_day_edits;

-- 5. Ledger.
DELETE FROM public.schema_migrations
 WHERE version = '20260826210000_chunk47_remove_attendance_lock';
