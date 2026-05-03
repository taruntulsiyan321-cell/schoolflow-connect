
CREATE TYPE public.fee_status AS ENUM ('paid','unpaid','partial');
CREATE TYPE public.exam_type AS ENUM ('class_test','unit_test','half_yearly','final','other');

-- ============ FEES ============
CREATE TABLE public.fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- 'YYYY-MM'
  amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  due_date DATE,
  status public.fee_status NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, month)
);
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.fees(student_id);

CREATE TRIGGER trg_fees_upd BEFORE UPDATE ON public.fees FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "fees admin all" ON public.fees FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "fees student read" ON public.fees FOR SELECT USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "fees parent read" ON public.fees FOR SELECT USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid()));
CREATE POLICY "fees teacher read" ON public.fees FOR SELECT USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.teacher_teaches_class(auth.uid(), s.class_id)));

-- ============ EXAMS ============
CREATE TABLE public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  exam_type public.exam_type NOT NULL DEFAULT 'class_test',
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  max_marks NUMERIC NOT NULL DEFAULT 100,
  exam_date DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.exams(class_id);

CREATE POLICY "exams admin all" ON public.exams FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "exams teacher manage" ON public.exams FOR ALL USING (public.teacher_teaches_class(auth.uid(), class_id)) WITH CHECK (public.teacher_teaches_class(auth.uid(), class_id));
CREATE POLICY "exams read auth" ON public.exams FOR SELECT TO authenticated USING (true);

-- ============ MARKS ============
CREATE TABLE public.marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  marks_obtained NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.marks(exam_id);
CREATE INDEX ON public.marks(student_id);

CREATE POLICY "marks admin all" ON public.marks FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "marks teacher manage" ON public.marks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND public.teacher_teaches_class(auth.uid(), e.class_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND public.teacher_teaches_class(auth.uid(), e.class_id)));
CREATE POLICY "marks student read" ON public.marks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "marks parent read" ON public.marks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid()));
-- Class leaderboard: allow students/parents to read marks of classmates for the same class's exams
CREATE POLICY "marks classmate read" ON public.marks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.students me ON (me.user_id = auth.uid() OR me.parent_user_id = auth.uid())
    WHERE e.id = exam_id AND e.class_id = me.class_id
  ));

-- ============ Admin: link user account to student/parent by email ============
CREATE OR REPLACE FUNCTION public.admin_link_user_to_student(_student_id UUID, _email TEXT, _as TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only admins can link users';
  END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user with email %. Ask them to sign up first.', _email;
  END IF;
  IF _as = 'student' THEN
    UPDATE public.students SET user_id = _uid WHERE id = _student_id;
  ELSIF _as = 'parent' THEN
    UPDATE public.students SET parent_user_id = _uid WHERE id = _student_id;
  ELSE
    RAISE EXCEPTION 'Invalid link type %', _as;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_link_user_to_teacher(_teacher_id UUID, _email TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only admins can link users';
  END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user with email %. Ask them to sign up first.', _email;
  END IF;
  UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
END; $$;
