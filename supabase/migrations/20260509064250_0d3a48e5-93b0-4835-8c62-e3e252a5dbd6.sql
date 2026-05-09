
-- Attendance locks
CREATE TABLE IF NOT EXISTS public.attendance_locks (
  class_id uuid NOT NULL,
  date date NOT NULL,
  locked_by uuid,
  locked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, date)
);
ALTER TABLE public.attendance_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locks read auth" ON public.attendance_locks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "locks teacher insert"  ON public.attendance_locks
  FOR INSERT TO authenticated
  WITH CHECK (public.teacher_teaches_class(auth.uid(), class_id) OR public.is_principal_or_admin(auth.uid()));

CREATE POLICY "locks admin delete" ON public.attendance_locks
  FOR DELETE TO authenticated
  USING (public.is_principal_or_admin(auth.uid()));

-- Audit history for attendance changes
CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid,
  student_id uuid,
  class_id uuid,
  date date,
  prev_status text,
  new_status text,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit principal admin read" ON public.attendance_audit
  FOR SELECT USING (public.is_principal_or_admin(auth.uid()));

CREATE POLICY "audit any authenticated insert" ON public.attendance_audit
  FOR INSERT TO authenticated WITH CHECK (true);

-- Trigger function to log changes
CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.attendance_audit (attendance_id, student_id, class_id, date, prev_status, new_status, edited_by)
    VALUES (NEW.id, NEW.student_id, NEW.class_id, NEW.date, OLD.status::text, NEW.status::text, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendance_audit_trg ON public.attendance;
CREATE TRIGGER attendance_audit_trg
AFTER UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.tg_log_attendance_change();
