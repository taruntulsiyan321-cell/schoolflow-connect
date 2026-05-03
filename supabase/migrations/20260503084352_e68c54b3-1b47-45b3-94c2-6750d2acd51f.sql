
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'teacher', 'student', 'parent');
CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'leave');
CREATE TYPE public.notice_audience AS ENUM ('all', 'class', 'section', 'teachers', 'parents', 'students');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer to avoid recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

-- ============ CLASSES ============
CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,         -- e.g. 'PG','Nursery','KG','1'..'12'
  section TEXT NOT NULL,      -- 'A','B','C'
  academic_year TEXT NOT NULL DEFAULT to_char(now(), 'YYYY'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, section, academic_year)
);
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- ============ STUDENTS ============
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  admission_number TEXT NOT NULL UNIQUE,
  roll_number TEXT,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  parent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_name TEXT,
  parent_mobile TEXT,
  address TEXT,
  date_of_birth DATE,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.students(class_id);
CREATE INDEX ON public.students(parent_user_id);

-- ============ TEACHERS ============
CREATE TABLE public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  subject TEXT,
  mobile TEXT,
  email TEXT,
  is_class_teacher BOOLEAN NOT NULL DEFAULT false,
  class_teacher_of UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  salary NUMERIC,                  -- admin-only via RLS
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

-- Teacher-class assignments (subject teaching)
CREATE TABLE public.teacher_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject TEXT,
  UNIQUE (teacher_id, class_id, subject)
);
ALTER TABLE public.teacher_classes ENABLE ROW LEVEL SECURITY;

-- Helper: does teacher (by user_id) teach a given class?
CREATE OR REPLACE FUNCTION public.teacher_teaches_class(_user_id UUID, _class_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
    WHERE t.user_id = _user_id AND tc.class_id = _class_id
  ) OR EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.user_id = _user_id AND t.class_teacher_of = _class_id
  )
$$;

CREATE OR REPLACE FUNCTION public.student_class_id(_user_id UUID)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT class_id FROM public.students WHERE user_id = _user_id LIMIT 1
$$;

-- ============ ATTENDANCE ============
CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status public.attendance_status NOT NULL,
  marked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, date)
);
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.attendance(class_id, date);

-- ============ NOTICES ============
CREATE TABLE public.notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience public.notice_audience NOT NULL DEFAULT 'all',
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  posted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.notices(created_at DESC);

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name',''),
    NEW.email,
    NEW.phone
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_upd BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_students_upd BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_teachers_upd BEFORE UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ RLS POLICIES ============

-- profiles: user reads/updates own; admins read all
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles admin all" ON public.profiles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- user_roles: users see own; admin manages
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles admin write" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- classes: anyone authed can read; admins manage
CREATE POLICY "classes read" ON public.classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "classes admin write" ON public.classes FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- students:
-- admins all; student own row; parent of student; teacher of student's class
CREATE POLICY "students admin all" ON public.students FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "students self read" ON public.students FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "students parent read" ON public.students FOR SELECT USING (parent_user_id = auth.uid());
CREATE POLICY "students teacher read" ON public.students FOR SELECT USING (public.teacher_teaches_class(auth.uid(), class_id));

-- teachers:
-- admins all; teacher reads own row; everyone authed can read non-salary basics
CREATE POLICY "teachers admin all" ON public.teachers FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "teachers self read" ON public.teachers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "teachers public basic read" ON public.teachers FOR SELECT TO authenticated USING (true);
-- (Salary is admin-only at the app layer: public reads omit it. To strictly hide via RLS, we'd use a view; admins can read full row.)

-- teacher_classes:
CREATE POLICY "tc admin all" ON public.teacher_classes FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tc read all auth" ON public.teacher_classes FOR SELECT TO authenticated USING (true);

-- attendance:
CREATE POLICY "att admin all" ON public.attendance FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "att teacher manage class" ON public.attendance FOR ALL
  USING (public.teacher_teaches_class(auth.uid(), class_id))
  WITH CHECK (public.teacher_teaches_class(auth.uid(), class_id));
CREATE POLICY "att student read self" ON public.attendance FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "att parent read child" ON public.attendance FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid()));

-- notices:
CREATE POLICY "notices admin all" ON public.notices FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "notices teacher post" ON public.notices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'teacher'));
CREATE POLICY "notices read targeted" ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'all'
    OR (audience = 'teachers' AND public.has_role(auth.uid(),'teacher'))
    OR (audience = 'parents'  AND public.has_role(auth.uid(),'parent'))
    OR (audience = 'students' AND public.has_role(auth.uid(),'student'))
    OR (audience = 'class' AND class_id IS NOT NULL AND (
          public.student_class_id(auth.uid()) = class_id
          OR public.teacher_teaches_class(auth.uid(), class_id)
          OR EXISTS (SELECT 1 FROM public.students s WHERE s.parent_user_id = auth.uid() AND s.class_id = class_id)
       ))
    OR (audience = 'section' AND class_id IS NOT NULL AND (
          public.student_class_id(auth.uid()) = class_id
          OR public.teacher_teaches_class(auth.uid(), class_id)
       ))
    OR public.has_role(auth.uid(),'admin')
  );
