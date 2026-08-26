-- ROLLBACK — Chunk 4.6, converge the attendance columns (20260826200000).
--
-- Restores attendance.class_id/date and attendance_locks (class_id, date),
-- refilling each from its submission, then puts the policies, triggers and
-- constraints back the way Chunk 4 left them.
--
-- Reinstating the columns reinstates three sources of truth. Nothing will keep
-- them in step with attendance_submissions, and no error will be raised when
-- they drift — which is the whole reason they were removed.

DROP VIEW IF EXISTS public.attendance_locks_current;
DROP VIEW IF EXISTS public.attendance_current;

-- --- attendance: columns back, refilled from the submission ----------
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS class_id uuid;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS date date;

UPDATE public.attendance a
   SET class_id = s.section_id, date = s.date
  FROM public.attendance_submissions s
 WHERE s.id = a.submission_id;

ALTER TABLE public.attendance ALTER COLUMN class_id SET NOT NULL;
ALTER TABLE public.attendance ALTER COLUMN date SET NOT NULL;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_student_submission_key;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_student_id_date_key UNIQUE (student_id, date);

DROP TRIGGER  IF EXISTS trg_attendance_one_per_day ON public.attendance;
DROP FUNCTION IF EXISTS public.tg_attendance_one_row_per_student_per_day();

-- --- attendance_locks: columns back ----------------------------------
ALTER TABLE public.attendance_locks ADD COLUMN IF NOT EXISTS class_id uuid;
ALTER TABLE public.attendance_locks ADD COLUMN IF NOT EXISTS date date;

UPDATE public.attendance_locks al
   SET class_id = s.section_id, date = s.date
  FROM public.attendance_submissions s
 WHERE s.id = al.submission_id;

ALTER TABLE public.attendance_locks DROP CONSTRAINT IF EXISTS attendance_locks_pkey CASCADE;
ALTER TABLE public.attendance_locks
  ADD CONSTRAINT attendance_locks_pkey PRIMARY KEY (class_id, date);
ALTER TABLE public.attendance_locks DROP CONSTRAINT IF EXISTS attendance_locks_submission_fk;
ALTER TABLE public.attendance_locks DROP COLUMN IF EXISTS submission_id;

ALTER TABLE public.attendance_locks
  ADD CONSTRAINT attendance_locks_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

-- --- policies back to reading the columns ----------------------------
DROP POLICY IF EXISTS "att teacher read class" ON public.attendance;
CREATE POLICY "att teacher read class" ON public.attendance
  FOR SELECT TO authenticated
  USING (public.teacher_teaches_class(auth.uid(), class_id));

DROP POLICY IF EXISTS "att teacher write class" ON public.attendance;
CREATE POLICY "att teacher write class" ON public.attendance
  FOR ALL TO authenticated
  USING (public.is_class_teacher_of_class(auth.uid(), class_id));

DROP POLICY IF EXISTS "locks teacher insert" ON public.attendance_locks;
CREATE POLICY "locks teacher insert" ON public.attendance_locks
  FOR INSERT
  WITH CHECK (
    (public.teacher_teaches_class(auth.uid(), class_id)
     OR public.is_principal_or_admin(auth.uid()))
    AND public.same_school(school_id)
  );

-- --- triggers back to reading the columns ----------------------------
-- tg_reject_locked_attendance_write, tg_student_section_must_match,
-- tg_emit_attendance_event and tg_log_attendance_change are restored by
-- re-running 20260826170000_chunk4_attendance.sql and the migrations that
-- originally defined them; their pre-4.6 bodies are not duplicated here.
