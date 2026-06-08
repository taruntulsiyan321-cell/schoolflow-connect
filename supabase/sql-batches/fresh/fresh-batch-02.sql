-- FRESH DATABASE batch 2/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260505005813_c4cf9114-f438-44b5-8d40-382e382e6335.sql


-- 1. Add principal to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'principal';



-- ── 20260505005850_b59b0a67-f48f-469f-bfc3-24db482b00be.sql


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



-- ── 20260507070000_homework_tables.sql

-- ============================================================
-- HOMEWORK & SUBMISSIONS TABLES
-- ============================================================

-- Table: homework (teacher creates assignments)
CREATE TABLE IF NOT EXISTS public.homework (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: homework_submissions (student submits work)
CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id UUID NOT NULL REFERENCES public.homework(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'graded')),
  grade TEXT,
  teacher_remarks TEXT,
  submitted_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_homework_class ON public.homework(class_id);
CREATE INDEX IF NOT EXISTS idx_homework_due ON public.homework(due_date);
CREATE INDEX IF NOT EXISTS idx_hw_sub_homework ON public.homework_submissions(homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_sub_student ON public.homework_submissions(student_id);

-- Enable RLS
ALTER TABLE public.homework ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for homework
CREATE POLICY "Admins can manage all homework"
  ON public.homework FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));

CREATE POLICY "Teachers can manage homework for their classes"
  ON public.homework FOR ALL
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
      WHERE t.user_id = auth.uid() AND tc.class_id = homework.class_id
    )
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.user_id = auth.uid() AND t.class_teacher_of = homework.class_id
    )
  );

CREATE POLICY "Students can view homework for their class"
  ON public.homework FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = auth.uid() AND s.class_id = homework.class_id
    )
  );

-- RLS Policies for homework_submissions
CREATE POLICY "Admins can manage all submissions"
  ON public.homework_submissions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));

CREATE POLICY "Teachers can view and grade submissions for their homework"
  ON public.homework_submissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.homework hw
      WHERE hw.id = homework_submissions.homework_id
      AND (
        hw.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.teacher_classes tc
          JOIN public.teachers t ON t.id = tc.teacher_id
          WHERE t.user_id = auth.uid() AND tc.class_id = hw.class_id
        )
      )
    )
  );

CREATE POLICY "Students can manage their own submissions"
  ON public.homework_submissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = auth.uid() AND s.id = homework_submissions.student_id
    )
  );



-- ── 20260507070100_library_tables.sql

-- ============================================================
-- LIBRARY TABLES
-- ============================================================

-- Table: library_books (book catalog)
CREATE TABLE IF NOT EXISTS public.library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  isbn TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  shelf_location TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: library_checkouts (borrow/return tracking)
CREATE TABLE IF NOT EXISTS public.library_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  checked_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE NOT NULL DEFAULT (current_date + interval '14 days'),
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'borrowed' CHECK (status IN ('borrowed', 'returned', 'overdue')),
  issued_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_library_books_title ON public.library_books(title);
CREATE INDEX IF NOT EXISTS idx_library_checkouts_student ON public.library_checkouts(student_id);
CREATE INDEX IF NOT EXISTS idx_library_checkouts_book ON public.library_checkouts(book_id);
CREATE INDEX IF NOT EXISTS idx_library_checkouts_status ON public.library_checkouts(status);

-- Enable RLS
ALTER TABLE public.library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_checkouts ENABLE ROW LEVEL SECURITY;

-- Everyone can view books
CREATE POLICY "Anyone can view books" ON public.library_books FOR SELECT USING (true);

-- Admins can manage books
CREATE POLICY "Admins manage books" ON public.library_books FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));

-- Students can view their own checkouts
CREATE POLICY "Students view own checkouts" ON public.library_checkouts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = auth.uid() AND s.id = library_checkouts.student_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal', 'teacher'))
  );

-- Admins can manage checkouts
CREATE POLICY "Admins manage checkouts" ON public.library_checkouts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));


