
-- Helper: is principal or admin
CREATE OR REPLACE FUNCTION public.is_principal_or_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'principal')
$$;

-- Helper: is class teacher of given student
CREATE OR REPLACE FUNCTION public.is_class_teacher_of_student(_uid uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.teachers t ON t.class_teacher_of = s.class_id
    WHERE s.id = _student_id AND t.user_id = _uid
  )
$$;

-- Leave requests
CREATE TYPE public.leave_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.leave_applicant AS ENUM ('student','teacher');

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id uuid NOT NULL,
  applicant_kind public.leave_applicant NOT NULL,
  student_id uuid,
  class_id uuid,
  leave_type text NOT NULL DEFAULT 'general',
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text,
  status public.leave_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_leave_updated BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "leaves principal admin all" ON public.leave_requests FOR ALL
  USING (public.is_principal_or_admin(auth.uid())) WITH CHECK (public.is_principal_or_admin(auth.uid()));

CREATE POLICY "leaves applicant read" ON public.leave_requests FOR SELECT
  USING (applicant_user_id = auth.uid());

CREATE POLICY "leaves applicant insert" ON public.leave_requests FOR INSERT
  WITH CHECK (applicant_user_id = auth.uid());

CREATE POLICY "leaves parent read child" ON public.leave_requests FOR SELECT
  USING (student_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid()
  ));

CREATE POLICY "leaves class teacher read" ON public.leave_requests FOR SELECT
  USING (student_id IS NOT NULL AND public.is_class_teacher_of_student(auth.uid(), student_id));

CREATE POLICY "leaves class teacher review" ON public.leave_requests FOR UPDATE
  USING (student_id IS NOT NULL AND public.is_class_teacher_of_student(auth.uid(), student_id))
  WITH CHECK (student_id IS NOT NULL AND public.is_class_teacher_of_student(auth.uid(), student_id));

-- Audit logs
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit principal admin read" ON public.audit_logs FOR SELECT
  USING (public.is_principal_or_admin(auth.uid()));
CREATE POLICY "audit auth insert" ON public.audit_logs FOR INSERT
  TO authenticated WITH CHECK (actor_user_id = auth.uid());

-- Staff attendance
CREATE TABLE public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  status public.attendance_status NOT NULL,
  marked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, date)
);
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_att principal admin all" ON public.staff_attendance FOR ALL
  USING (public.is_principal_or_admin(auth.uid())) WITH CHECK (public.is_principal_or_admin(auth.uid()));
CREATE POLICY "staff_att self read" ON public.staff_attendance FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_id AND t.user_id = auth.uid()));

-- Principal-wide read on key tables
CREATE POLICY "students principal read" ON public.students FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "teachers principal read" ON public.teachers FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "attendance principal read" ON public.attendance FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "fees principal read" ON public.fees FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "marks principal read" ON public.marks FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "exams principal read" ON public.exams FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "tc principal read" ON public.teacher_classes FOR SELECT USING (public.has_role(auth.uid(),'principal'));
CREATE POLICY "notices principal post" ON public.notices FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'principal'));
