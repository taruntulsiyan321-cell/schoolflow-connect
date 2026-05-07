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
