-- ============================================================================
-- Gurukul complete multi-tenant database foundation
-- Covers Admin, Principal, Teacher, Student, Parent panels
-- ============================================================================
-- Prerequisites: 20260730000000_auth_multitenant_foundation.sql (schools + profiles.school_id)
-- Default school: 00000000-0000-4000-8000-000000000001

-- ── 0. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.default_school_id()
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;

CREATE OR REPLACE FUNCTION public.same_school(_school_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _school_id IS NOT NULL
    AND _school_id = public.get_my_school_id()
$$;

GRANT EXECUTE ON FUNCTION public.same_school(uuid) TO authenticated;

-- ── 1. Add school_id to every tenant table ───────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'classes','students','teachers','teacher_classes',
    'attendance','attendance_locks','attendance_audit','staff_attendance',
    'notices','messages','notifications','leave_requests','audit_logs',
    'exams','marks','fees','homework','homework_submissions',
    'library_books','library_checkouts','class_timetables',
    'school_inquiries','school_complaints','parent_academic_alerts',
    'question_bank','question_templates','practice_sessions','question_attempts',
    'student_question_history','student_mistakes','revision_queue',
    'academic_daily_activity','concept_mastery',
    'recovery_assignments','recovery_assignment_questions','student_improvement_plans',
    'dpps','dpp_questions','dpp_attempts','dpp_answers','ai_explanations',
    'battles','battle_questions','battle_participants','battle_answers',
    'battle_invites','battle_events','battle_reports',
    'student_xp','student_badges',
    'community_doubts','community_doubt_answers','community_doubt_votes',
    'community_doubt_views','community_reputation',
    'device_tokens'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id)',
        t
      );
      EXECUTE format(
        'UPDATE public.%I SET school_id = public.default_school_id() WHERE school_id IS NULL',
        t
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (school_id)',
        t || '_school_id_idx', t
      );
    END IF;
  END LOOP;
END $$;

-- Optional academic intelligence tables (may exist only in some envs)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='student_academic_brain') THEN
    ALTER TABLE public.student_academic_brain ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
    UPDATE public.student_academic_brain SET school_id = public.default_school_id() WHERE school_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='academic_agent_cache') THEN
    ALTER TABLE public.academic_agent_cache ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
    UPDATE public.academic_agent_cache SET school_id = public.default_school_id() WHERE school_id IS NULL;
  END IF;
END $$;

-- ── 2. Scope unique constraints by school ────────────────────────────────────
-- Students admission numbers unique per school
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_admission_number_key;
DROP INDEX IF EXISTS students_admission_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS students_school_admission_uidx
  ON public.students (school_id, admission_number);

-- Classes unique per school
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_name_section_academic_year_key;
DROP INDEX IF EXISTS classes_name_section_academic_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS classes_school_name_section_year_uidx
  ON public.classes (school_id, name, section, academic_year);

-- ── 3. Enrich existing columns for panel UIs ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.person_status AS ENUM ('active', 'inactive', 'suspended', 'alumni');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.gender_type AS ENUM ('male', 'female', 'other', 'unspecified');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.notice_priority AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.calendar_event_type AS ENUM (
    'holiday', 'exam', 'meeting', 'sports', 'cultural', 'deadline', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.resource_type AS ENUM (
    'pdf', 'video', 'link', 'notes', 'worksheet', 'presentation', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Students
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS status public.person_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS gender public.gender_type NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS house text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact text,
  ADD COLUMN IF NOT EXISTS medical_notes text;

-- Teachers
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS status public.person_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS gender public.gender_type NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS qualification text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS subjects text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS joined_date date,
  ADD COLUMN IF NOT EXISTS photo_url text;

CREATE UNIQUE INDEX IF NOT EXISTS teachers_school_employee_uidx
  ON public.teachers (school_id, employee_id)
  WHERE employee_id IS NOT NULL;

-- Classes
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS class_teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS room_number text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Notices / announcements
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority public.notice_priority NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

-- Messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS has_attachment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Leave requests
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Exams
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS max_marks numeric,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled';

-- Fees
ALTER TABLE public.fees
  ADD COLUMN IF NOT EXISTS fee_type text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- Homework
ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- App settings: one row per school
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

UPDATE public.app_settings
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_settings_school_uidx
  ON public.app_settings (school_id);

-- Schools branding extras
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS principal_name text,
  ADD COLUMN IF NOT EXISTS academic_year text DEFAULT to_char(now(), 'YYYY');

-- ── 4. New tables — Parents (Admin + Parent panels) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  occupation text,
  address text,
  gender public.gender_type NOT NULL DEFAULT 'unspecified',
  status public.person_status NOT NULL DEFAULT 'active',
  portal_email text,
  portal_phone text,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parents_school_idx ON public.parents(school_id);
CREATE INDEX IF NOT EXISTS parents_user_idx ON public.parents(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS parents_school_portal_email_uidx
  ON public.parents (school_id, lower(portal_email))
  WHERE portal_email IS NOT NULL AND user_id IS NULL;

ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.parent_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  parent_id uuid NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'Guardian',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS parent_students_student_idx ON public.parent_students(student_id);
CREATE INDEX IF NOT EXISTS parent_students_school_idx ON public.parent_students(school_id);
ALTER TABLE public.parent_students ENABLE ROW LEVEL SECURITY;

-- Backfill parents from linked parent_user_id (idempotent)
INSERT INTO public.parents (school_id, user_id, full_name, phone, status)
SELECT
  coalesce(s.school_id, public.default_school_id()),
  s.parent_user_id,
  coalesce(nullif(trim(s.parent_name), ''), coalesce(pr.full_name, 'Parent')),
  coalesce(s.parent_mobile, pr.phone),
  'active'::public.person_status
FROM public.students s
LEFT JOIN public.profiles pr ON pr.id = s.parent_user_id
WHERE s.parent_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.parents p WHERE p.user_id = s.parent_user_id
  );

INSERT INTO public.parent_students (school_id, parent_id, student_id, relationship, is_primary)
SELECT
  coalesce(s.school_id, public.default_school_id()),
  p.id,
  s.id,
  'Guardian',
  true
FROM public.students s
JOIN public.parents p ON p.user_id = s.parent_user_id
WHERE s.parent_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.parent_students ps
    WHERE ps.parent_id = p.id AND ps.student_id = s.id
  );

-- ── 5. Calendar (Student / Parent / Admin) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  event_type public.calendar_event_type NOT NULL DEFAULT 'other',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  audience public.notice_audience NOT NULL DEFAULT 'all',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_calendar_events_school_starts_idx
  ON public.school_calendar_events (school_id, starts_at);
ALTER TABLE public.school_calendar_events ENABLE ROW LEVEL SECURITY;

-- ── 6. Learning resources (Student Resources panel) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  subject text,
  title text NOT NULL,
  description text,
  resource_type public.resource_type NOT NULL DEFAULT 'link',
  url text,
  storage_path text,
  is_published boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_resources_school_idx ON public.learning_resources(school_id);
CREATE INDEX IF NOT EXISTS learning_resources_class_idx ON public.learning_resources(class_id);
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;

-- ── 7. Subjects catalog (Admin / Teacher) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  name text NOT NULL,
  code text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

-- ── 8. Academic terms ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  name text NOT NULL,
  academic_year text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name, academic_year)
);

ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

-- ── 9. Principal / Admin pending approvals queue ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  request_type text NOT NULL, -- leave | announcement | fee_waiver | other
  title text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  urgency text NOT NULL DEFAULT 'normal',
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  related_leave_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  related_notice_id uuid REFERENCES public.notices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS approval_requests_school_status_idx
  ON public.approval_requests (school_id, status);
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

-- ── 10. Timetable periods (richer than class_timetables blob) ────────────────
CREATE TABLE IF NOT EXISTS public.timetable_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  period_number smallint NOT NULL,
  subject text NOT NULL,
  starts_at time,
  ends_at time,
  room text,
  UNIQUE (class_id, day_of_week, period_number)
);

CREATE INDEX IF NOT EXISTS timetable_slots_school_idx ON public.timetable_slots(school_id);
ALTER TABLE public.timetable_slots ENABLE ROW LEVEL SECURITY;

-- ── 11. Activity feed (Principal / Admin dashboard) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.school_activity_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_activity_feed_school_created_idx
  ON public.school_activity_feed (school_id, created_at DESC);
ALTER TABLE public.school_activity_feed ENABLE ROW LEVEL SECURITY;

-- ── 12. RLS — school isolation for new tables + key ops tables ───────────────
-- Helper policy pattern: same_school(school_id) OR admin/principal

-- Parents
DROP POLICY IF EXISTS parents_school_select ON public.parents;
CREATE POLICY parents_school_select ON public.parents FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );
DROP POLICY IF EXISTS parents_admin_write ON public.parents;
CREATE POLICY parents_admin_write ON public.parents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id));

DROP POLICY IF EXISTS parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = parent_id AND p.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );
DROP POLICY IF EXISTS parent_students_admin_write ON public.parent_students;
CREATE POLICY parent_students_admin_write ON public.parent_students FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id));

-- Calendar
DROP POLICY IF EXISTS calendar_select ON public.school_calendar_events;
CREATE POLICY calendar_select ON public.school_calendar_events FOR SELECT TO authenticated
  USING (public.same_school(school_id));
DROP POLICY IF EXISTS calendar_manage ON public.school_calendar_events;
CREATE POLICY calendar_manage ON public.school_calendar_events FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal') OR public.has_role(auth.uid(), 'teacher'))
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal') OR public.has_role(auth.uid(), 'teacher'))
  );

-- Resources
DROP POLICY IF EXISTS resources_select ON public.learning_resources;
CREATE POLICY resources_select ON public.learning_resources FOR SELECT TO authenticated
  USING (public.same_school(school_id) AND (is_published OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'teacher')));
DROP POLICY IF EXISTS resources_manage ON public.learning_resources;
CREATE POLICY resources_manage ON public.learning_resources FOR ALL TO authenticated
  USING (public.same_school(school_id) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'teacher')))
  WITH CHECK (public.same_school(school_id) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'teacher')));

-- Subjects / terms
DROP POLICY IF EXISTS subjects_select ON public.subjects;
CREATE POLICY subjects_select ON public.subjects FOR SELECT TO authenticated
  USING (public.same_school(school_id));
DROP POLICY IF EXISTS subjects_admin ON public.subjects;
CREATE POLICY subjects_admin ON public.subjects FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id));

DROP POLICY IF EXISTS terms_select ON public.academic_terms;
CREATE POLICY terms_select ON public.academic_terms FOR SELECT TO authenticated
  USING (public.same_school(school_id));
DROP POLICY IF EXISTS terms_admin ON public.academic_terms;
CREATE POLICY terms_admin ON public.academic_terms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND public.same_school(school_id));

-- Approvals
DROP POLICY IF EXISTS approvals_select ON public.approval_requests;
CREATE POLICY approvals_select ON public.approval_requests FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      requested_by = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
    )
  );
DROP POLICY IF EXISTS approvals_write ON public.approval_requests;
CREATE POLICY approvals_write ON public.approval_requests FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      requested_by = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
    )
  )
  WITH CHECK (public.same_school(school_id));

-- Timetable slots
DROP POLICY IF EXISTS timetable_slots_select ON public.timetable_slots;
CREATE POLICY timetable_slots_select ON public.timetable_slots FOR SELECT TO authenticated
  USING (public.same_school(school_id));
DROP POLICY IF EXISTS timetable_slots_manage ON public.timetable_slots;
CREATE POLICY timetable_slots_manage ON public.timetable_slots FOR ALL TO authenticated
  USING (public.same_school(school_id) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal')))
  WITH CHECK (public.same_school(school_id) AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal')));

-- Activity feed
DROP POLICY IF EXISTS activity_feed_select ON public.school_activity_feed;
CREATE POLICY activity_feed_select ON public.school_activity_feed FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal') OR public.has_role(auth.uid(), 'teacher'))
  );
DROP POLICY IF EXISTS activity_feed_insert ON public.school_activity_feed;
CREATE POLICY activity_feed_insert ON public.school_activity_feed FOR INSERT TO authenticated
  WITH CHECK (public.same_school(school_id));

-- Tighten classes read to school (keep existing admin write)
DROP POLICY IF EXISTS classes_school_read ON public.classes;
CREATE POLICY classes_school_read ON public.classes FOR SELECT TO authenticated
  USING (public.same_school(school_id) OR school_id IS NULL);

-- ── 13. Auth fixes — intended role + claim RPC + bootstrap ───────────────────
CREATE OR REPLACE FUNCTION public.claim_signup_role(_role public.app_role)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.app_role;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only student/parent may self-claim; staff are admin-provisioned
  IF _role NOT IN ('student'::public.app_role, 'parent'::public.app_role) THEN
    RAISE EXCEPTION 'Only student or parent roles can be claimed on signup';
  END IF;

  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, _role)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  RETURN _existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_signup_role(public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  _student_id uuid;
  _default_school uuid := public.default_school_id();
  _intended text;
  _has_role boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, school_id, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.phone,
    COALESCE((NEW.raw_user_meta_data->>'school_id')::uuid, _default_school),
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE
          WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END,
        school_id = COALESCE(public.profiles.school_id, EXCLUDED.school_id);

  PERFORM public.link_portal_on_auth(NEW.id);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  IF NEW.raw_user_meta_data->>'admission_number' IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students
      WHERE admission_number = NEW.raw_user_meta_data->>'admission_number'
        AND user_id IS NULL
      LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = NEW.id WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, 'student')
        ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
    END IF;
  END IF;

  -- Honor self-signup intended_role for student/parent when still unassigned
  IF NOT _has_role THEN
    _intended := lower(coalesce(NEW.raw_user_meta_data->>'intended_role', ''));
    IF _intended IN ('student', 'parent') THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, _intended::public.app_role)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  photo_url text,
  is_active boolean,
  role public.app_role,
  school_id uuid,
  school_name text,
  school_slug text,
  school_logo_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _uid uuid := auth.uid();
  _intended text;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.link_portal_on_auth(_uid);

  INSERT INTO public.profiles (id, full_name, email, school_id)
  SELECT _uid,
         coalesce((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = _uid), ''),
         (SELECT email FROM auth.users WHERE id = _uid),
         public.default_school_id()
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
  SET school_id = coalesce(school_id, public.default_school_id())
  WHERE id = _uid AND school_id IS NULL;

  -- Apply intended_role if still missing
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid) THEN
    SELECT lower(coalesce(raw_user_meta_data->>'intended_role', ''))
      INTO _intended FROM auth.users WHERE id = _uid;
    IF _intended IN ('student', 'parent') THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (_uid, _intended::public.app_role)
      ON CONFLICT (user_id) DO NOTHING;
    ELSE
      PERFORM public.ensure_default_role();
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.photo_url,
    p.is_active,
    ur.role,
    p.school_id,
    s.name,
    s.slug,
    s.logo_url
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_context() TO authenticated;

-- Updated-at triggers for new tables
DROP TRIGGER IF EXISTS trg_parents_upd ON public.parents;
CREATE TRIGGER trg_parents_upd BEFORE UPDATE ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_calendar_upd ON public.school_calendar_events;
CREATE TRIGGER trg_calendar_upd BEFORE UPDATE ON public.school_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_resources_upd ON public.learning_resources;
CREATE TRIGGER trg_resources_upd BEFORE UPDATE ON public.learning_resources
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.parents IS 'First-class parent records for Admin Parent Management and Parent panel';
COMMENT ON TABLE public.parent_students IS 'Many-to-many link between parents and students';
COMMENT ON TABLE public.school_calendar_events IS 'School calendar for Student/Parent/Admin panels';
COMMENT ON TABLE public.learning_resources IS 'Study resources for Student Resources panel';
COMMENT ON TABLE public.approval_requests IS 'Principal/Admin pending approvals queue';
COMMENT ON FUNCTION public.claim_signup_role(public.app_role) IS 'Authenticated self-signup role claim (student|parent only)';
