-- ============================================================================
-- Gurukul Academic Engine — Phase 1: Schema & Domain Backbone
-- ============================================================================
-- Additive, non-breaking. Maps product entities onto existing tables where
-- possible; introduces only the tables required for one source of truth,
-- event-driven sync, auto academic profiles, and audit.
-- Prerequisites: 20260730000000 + 20260730010000

-- ── 0. Enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.academic_event_status AS ENUM (
    'pending', 'processing', 'processed', 'failed', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.academic_year_status AS ENUM (
    'planned', 'active', 'closed', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 1. Academic years (formal year entity; text fields remain for compat) ────
CREATE TABLE IF NOT EXISTS public.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE
    DEFAULT public.default_school_id(),
  name text NOT NULL,                       -- e.g. "2025-26"
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status public.academic_year_status NOT NULL DEFAULT 'planned',
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_years_date_range CHECK (ends_on > starts_on),
  UNIQUE (school_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current_per_school
  ON public.academic_years (school_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS academic_years_school_idx
  ON public.academic_years (school_id);

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_years_school_select ON public.academic_years;
CREATE POLICY academic_years_school_select ON public.academic_years
  FOR SELECT TO authenticated
  USING (public.same_school(school_id) OR public.is_principal_or_admin(auth.uid()));

DROP POLICY IF EXISTS academic_years_admin_write ON public.academic_years;
CREATE POLICY academic_years_admin_write ON public.academic_years
  FOR ALL TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id))
  WITH CHECK (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

-- Seed current year for default school if empty
INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, status, is_current)
SELECT public.default_school_id(), '2025-26', '2025-04-01', '2026-03-31', 'active', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.academic_years WHERE school_id = public.default_school_id()
);

-- Link terms / classes optionally (keep legacy text columns)
ALTER TABLE public.academic_terms
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL;

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS classes_academic_year_id_idx ON public.classes (academic_year_id);
CREATE INDEX IF NOT EXISTS academic_terms_year_id_idx ON public.academic_terms (academic_year_id);

-- ── 2. Subject FK bridge (text subject columns remain source until backfilled)
ALTER TABLE public.teacher_classes
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='timetable_slots') THEN
    ALTER TABLE public.timetable_slots
      ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dpps') THEN
    ALTER TABLE public.dpps
      ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS teacher_classes_subject_id_idx ON public.teacher_classes (subject_id);
CREATE INDEX IF NOT EXISTS homework_subject_id_idx ON public.homework (subject_id);
CREATE INDEX IF NOT EXISTS exams_subject_id_idx ON public.exams (subject_id);

-- Strengthen mapping uniqueness when school_id is present (additive; ignore if dups exist)
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS teacher_classes_school_mapping_uidx
    ON public.teacher_classes (
      school_id,
      teacher_id,
      class_id,
      coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(subject, '')
    );
EXCEPTION WHEN unique_violation OR duplicate_table THEN
  RAISE NOTICE 'teacher_classes_school_mapping_uidx skipped (duplicates or exists)';
END $$;

-- ── 3. Teacher remarks (first-class entity; no longer only free-text fields) ─
CREATE TABLE IF NOT EXISTS public.teacher_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE
    DEFAULT public.default_school_id(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  remark_type text NOT NULL DEFAULT 'general', -- general | academic | behavior | improvement
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'parent_student', -- teacher_only | parent_student | staff
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_remarks_student_idx
  ON public.teacher_remarks (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS teacher_remarks_school_idx
  ON public.teacher_remarks (school_id, created_at DESC);

ALTER TABLE public.teacher_remarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teacher_remarks_school_select ON public.teacher_remarks;
CREATE POLICY teacher_remarks_school_select ON public.teacher_remarks
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.is_principal_or_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_id AND t.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.parent_students ps
        JOIN public.parents p ON p.id = ps.parent_id
        WHERE ps.student_id = teacher_remarks.student_id AND p.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS teacher_remarks_teacher_write ON public.teacher_remarks;
CREATE POLICY teacher_remarks_teacher_write ON public.teacher_remarks
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.is_principal_or_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_id AND t.user_id = auth.uid())
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.is_principal_or_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_id AND t.user_id = auth.uid())
    )
  );

-- ── 4. Student academic profile (auto-maintained; ONE per student) ───────────
-- Source of truth for dashboards / parent / principal / AI summaries.
-- Never edit manually from UI — sync engine owns writes.
CREATE TABLE IF NOT EXISTS public.student_academic_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE
    DEFAULT public.default_school_id(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,

  attendance_present integer NOT NULL DEFAULT 0,
  attendance_total integer NOT NULL DEFAULT 0,
  attendance_pct numeric(5,2) NOT NULL DEFAULT 0,

  homework_assigned integer NOT NULL DEFAULT 0,
  homework_submitted integer NOT NULL DEFAULT 0,
  homework_completion_pct numeric(5,2) NOT NULL DEFAULT 0,

  tests_attempted integer NOT NULL DEFAULT 0,
  tests_avg_pct numeric(5,2) NOT NULL DEFAULT 0,

  exams_recorded integer NOT NULL DEFAULT 0,
  exams_avg_pct numeric(5,2) NOT NULL DEFAULT 0,

  practice_sessions integer NOT NULL DEFAULT 0,
  practice_accuracy_pct numeric(5,2) NOT NULL DEFAULT 0,

  doubts_asked integer NOT NULL DEFAULT 0,
  doubts_resolved integer NOT NULL DEFAULT 0,
  remarks_count integer NOT NULL DEFAULT 0,

  -- Extensible rollups (subject breakdowns, trends) without duplicating facts
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_type text,
  last_event_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT student_academic_profiles_one_per_student UNIQUE (student_id),
  CONSTRAINT student_academic_profiles_pct_range CHECK (
    attendance_pct BETWEEN 0 AND 100
    AND homework_completion_pct BETWEEN 0 AND 100
    AND tests_avg_pct BETWEEN 0 AND 100
    AND exams_avg_pct BETWEEN 0 AND 100
    AND practice_accuracy_pct BETWEEN 0 AND 100
  )
);

CREATE INDEX IF NOT EXISTS student_academic_profiles_school_idx
  ON public.student_academic_profiles (school_id);
CREATE INDEX IF NOT EXISTS student_academic_profiles_refreshed_idx
  ON public.student_academic_profiles (school_id, refreshed_at DESC);

ALTER TABLE public.student_academic_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sap_school_select ON public.student_academic_profiles;
CREATE POLICY sap_school_select ON public.student_academic_profiles
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.is_principal_or_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.parent_user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.parent_students ps
        JOIN public.parents p ON p.id = ps.parent_id
        WHERE ps.student_id = student_academic_profiles.student_id AND p.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = student_id AND public.teacher_teaches_class(auth.uid(), s.class_id)
      )
    )
  );

-- Writes only via SECURITY DEFINER sync helpers (no direct client INSERT/UPDATE)
DROP POLICY IF EXISTS sap_no_direct_write ON public.student_academic_profiles;
CREATE POLICY sap_no_direct_write ON public.student_academic_profiles
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY sap_no_direct_update ON public.student_academic_profiles
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY sap_no_direct_delete ON public.student_academic_profiles
  FOR DELETE TO authenticated USING (false);

-- ── 5. Academic event outbox (sync backbone) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE
    DEFAULT public.default_school_id(),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.academic_event_status NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS academic_events_pending_idx
  ON public.academic_events (status, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS academic_events_school_created_idx
  ON public.academic_events (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS academic_events_student_idx
  ON public.academic_events (student_id, created_at DESC)
  WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS academic_events_type_idx
  ON public.academic_events (school_id, event_type, created_at DESC);

ALTER TABLE public.academic_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_events_admin_select ON public.academic_events;
CREATE POLICY academic_events_admin_select ON public.academic_events
  FOR SELECT TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

-- Clients never write events directly
DROP POLICY IF EXISTS academic_events_no_direct_write ON public.academic_events;
CREATE POLICY academic_events_no_client_insert ON public.academic_events
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY academic_events_no_client_update ON public.academic_events
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY academic_events_no_client_delete ON public.academic_events
  FOR DELETE TO authenticated USING (false);

-- ── 6. Academic audit trail (critical mutations) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE
    DEFAULT public.default_school_id(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,                    -- insert | update | delete | publish | grade
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academic_audit_entity_idx
  ON public.academic_audit (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS academic_audit_school_idx
  ON public.academic_audit (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS academic_audit_actor_idx
  ON public.academic_audit (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.academic_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_audit_admin_select ON public.academic_audit;
CREATE POLICY academic_audit_admin_select ON public.academic_audit
  FOR SELECT TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

CREATE POLICY academic_audit_no_client_insert ON public.academic_audit
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY academic_audit_no_client_update ON public.academic_audit
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY academic_audit_no_client_delete ON public.academic_audit
  FOR DELETE TO authenticated USING (false);

-- ── 7. Integrity helpers ─────────────────────────────────────────────────────
-- Marks cannot exceed exam max_marks when max_marks is set
CREATE OR REPLACE FUNCTION public.tg_marks_within_max()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _max numeric;
BEGIN
  SELECT max_marks INTO _max FROM public.exams WHERE id = NEW.exam_id;
  IF _max IS NOT NULL AND NEW.marks_obtained > _max THEN
    RAISE EXCEPTION 'marks_obtained (%) exceeds exam max_marks (%)', NEW.marks_obtained, _max;
  END IF;
  IF NEW.marks_obtained < 0 THEN
    RAISE EXCEPTION 'marks_obtained cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marks_within_max ON public.marks;
CREATE TRIGGER trg_marks_within_max
  BEFORE INSERT OR UPDATE OF marks_obtained, exam_id ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.tg_marks_within_max();

-- Soft-delete students: forbid hard delete when academic history exists
-- (panels should set status = alumni). ON DELETE CASCADE on children already
-- preserves via profile policy: we RESTRICT hard delete when marks/attendance exist.
CREATE OR REPLACE FUNCTION public.tg_students_prevent_orphan_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.attendance WHERE student_id = OLD.id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.marks WHERE student_id = OLD.id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.homework_submissions WHERE student_id = OLD.id LIMIT 1)
  THEN
    RAISE EXCEPTION
      'Cannot delete student % with academic history. Set status to alumni instead.',
      OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_prevent_orphan_history ON public.students;
CREATE TRIGGER trg_students_prevent_orphan_history
  BEFORE DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.tg_students_prevent_orphan_history();

-- ── 8. Emit + audit + ensure profile (SECURITY DEFINER API for later layers) ─
CREATE OR REPLACE FUNCTION public.emit_academic_event(
  _event_type text,
  _entity_type text,
  _entity_id uuid DEFAULT NULL,
  _school_id uuid DEFAULT NULL,
  _student_id uuid DEFAULT NULL,
  _class_id uuid DEFAULT NULL,
  _teacher_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _sid uuid;
BEGIN
  _sid := coalesce(
    _school_id,
    (SELECT school_id FROM public.students WHERE id = _student_id),
    (SELECT school_id FROM public.classes WHERE id = _class_id),
    public.get_my_school_id(),
    public.default_school_id()
  );

  INSERT INTO public.academic_events (
    school_id, event_type, entity_type, entity_id,
    actor_user_id, student_id, class_id, teacher_id, payload
  ) VALUES (
    _sid, _event_type, _entity_type, _entity_id,
    auth.uid(), _student_id, _class_id, _teacher_id, coalesce(_payload, '{}'::jsonb)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.emit_academic_event(
  text, text, uuid, uuid, uuid, uuid, uuid, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.write_academic_audit(
  _entity_type text,
  _entity_id uuid,
  _action text,
  _previous jsonb DEFAULT NULL,
  _new jsonb DEFAULT NULL,
  _school_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _sid uuid;
  _role text;
BEGIN
  _sid := coalesce(_school_id, public.get_my_school_id(), public.default_school_id());
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.academic_audit (
    school_id, entity_type, entity_id, action,
    actor_user_id, actor_role, previous_value, new_value, metadata
  ) VALUES (
    _sid, _entity_type, _entity_id, _action,
    auth.uid(), _role, _previous, _new, coalesce(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_academic_audit(
  text, uuid, text, jsonb, jsonb, uuid, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_student_academic_profile(_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _school uuid;
  _year uuid;
BEGIN
  SELECT school_id INTO _school FROM public.students WHERE id = _student_id;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'student % not found', _student_id;
  END IF;

  SELECT id INTO _year FROM public.academic_years
  WHERE school_id = _school AND is_current = true
  LIMIT 1;

  INSERT INTO public.student_academic_profiles (school_id, student_id, academic_year_id)
  VALUES (_school, _student_id, _year)
  ON CONFLICT (student_id) DO UPDATE
    SET academic_year_id = coalesce(public.student_academic_profiles.academic_year_id, EXCLUDED.academic_year_id),
        updated_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_student_academic_profile(uuid) TO authenticated;

-- Auto-create profile when a student row is inserted
CREATE OR REPLACE FUNCTION public.tg_students_ensure_academic_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_student_academic_profile(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_ensure_academic_profile ON public.students;
CREATE TRIGGER trg_students_ensure_academic_profile
  AFTER INSERT ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.tg_students_ensure_academic_profile();

-- Backfill profiles for existing students
INSERT INTO public.student_academic_profiles (school_id, student_id, academic_year_id)
SELECT s.school_id, s.id,
       (SELECT ay.id FROM public.academic_years ay
        WHERE ay.school_id = s.school_id AND ay.is_current = true LIMIT 1)
FROM public.students s
WHERE NOT EXISTS (
  SELECT 1 FROM public.student_academic_profiles p WHERE p.student_id = s.id
)
ON CONFLICT (student_id) DO NOTHING;

-- ── 9. Core event emission triggers (wire sync in Phase 4; outbox fills now) ─
CREATE OR REPLACE FUNCTION public.tg_emit_attendance_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_academic_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'attendance.marked' ELSE 'attendance.updated' END,
    'attendance',
    NEW.id,
    NEW.school_id,
    NEW.student_id,
    NEW.class_id,
    NULL,
    jsonb_build_object(
      'date', NEW.date,
      'status', NEW.status,
      'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
    )
  );
  PERFORM public.write_academic_audit(
    'attendance', NEW.id,
    lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    NEW.school_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_attendance_event ON public.attendance;
CREATE TRIGGER trg_emit_attendance_event
  AFTER INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_attendance_event();

CREATE OR REPLACE FUNCTION public.tg_emit_homework_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_academic_event(
    CASE
      WHEN TG_OP = 'INSERT' THEN 'homework.assigned'
      WHEN TG_OP = 'UPDATE'
        AND NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status IN ('published', 'active') THEN 'homework.published'
      ELSE 'homework.updated'
    END,
    'homework',
    NEW.id,
    NEW.school_id,
    NULL,
    NEW.class_id,
    NULL,
    jsonb_build_object(
      'subject', NEW.subject,
      'status', NEW.status,
      'subject_id', NEW.subject_id,
      'created_by', NEW.created_by
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_homework_event ON public.homework;
CREATE TRIGGER trg_emit_homework_event
  AFTER INSERT OR UPDATE ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_homework_event();

CREATE OR REPLACE FUNCTION public.tg_emit_marks_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _exam record;
BEGIN
  SELECT * INTO _exam FROM public.exams WHERE id = NEW.exam_id;
  PERFORM public.emit_academic_event(
    CASE WHEN TG_OP = 'INSERT' THEN 'marks.published' ELSE 'marks.updated' END,
    'marks',
    NEW.id,
    coalesce(NEW.school_id, _exam.school_id),
    NEW.student_id,
    _exam.class_id,
    NULL,
    jsonb_build_object(
      'exam_id', NEW.exam_id,
      'marks_obtained', NEW.marks_obtained,
      'max_marks', _exam.max_marks,
      'previous', CASE WHEN TG_OP = 'UPDATE' THEN OLD.marks_obtained ELSE NULL END
    )
  );
  PERFORM public.write_academic_audit(
    'marks', NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'publish' ELSE 'update' END,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    coalesce(NEW.school_id, _exam.school_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_marks_event ON public.marks;
CREATE TRIGGER trg_emit_marks_event
  AFTER INSERT OR UPDATE ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_marks_event();

CREATE OR REPLACE FUNCTION public.tg_emit_notice_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_academic_event(
      'announcement.published',
      'announcement',
      NEW.id,
      NEW.school_id,
      NULL,
      NEW.class_id,
      NULL,
      jsonb_build_object('title', NEW.title, 'audience', NEW.audience, 'priority', NEW.priority)
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'published' THEN
    PERFORM public.emit_academic_event(
      'announcement.published',
      'announcement',
      NEW.id,
      NEW.school_id,
      NULL,
      NEW.class_id,
      NULL,
      jsonb_build_object('title', NEW.title, 'audience', NEW.audience, 'priority', NEW.priority)
    );
  END IF;

  PERFORM public.write_academic_audit(
    'announcement', NEW.id, lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    NEW.school_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_notice_event ON public.notices;
CREATE TRIGGER trg_emit_notice_event
  AFTER INSERT OR UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_notice_event();

CREATE OR REPLACE FUNCTION public.tg_emit_remark_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_academic_event(
    'remark.created',
    'teacher_remark',
    NEW.id,
    NEW.school_id,
    NEW.student_id,
    NEW.class_id,
    NEW.teacher_id,
    jsonb_build_object('remark_type', NEW.remark_type)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_remark_event ON public.teacher_remarks;
CREATE TRIGGER trg_emit_remark_event
  AFTER INSERT ON public.teacher_remarks
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_remark_event();

-- ── 10. Performance indexes for high-volume academic reads ───────────────────
CREATE INDEX IF NOT EXISTS attendance_school_date_idx
  ON public.attendance (school_id, date DESC);
CREATE INDEX IF NOT EXISTS homework_school_class_idx
  ON public.homework (school_id, class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS marks_school_student_idx
  ON public.marks (school_id, student_id);
CREATE INDEX IF NOT EXISTS exams_school_class_idx
  ON public.exams (school_id, class_id, exam_date DESC);

COMMENT ON TABLE public.academic_years IS 'Formal academic year per school; classes/terms may link via academic_year_id';
COMMENT ON TABLE public.student_academic_profiles IS 'Auto-maintained single academic profile per student — source for dashboards/AI; never edit from UI';
COMMENT ON TABLE public.academic_events IS 'Academic event outbox; sync engine processes pending rows';
COMMENT ON TABLE public.academic_audit IS 'Immutable audit trail for critical academic mutations';
COMMENT ON TABLE public.teacher_remarks IS 'First-class teacher remarks owned by Teacher module';
COMMENT ON FUNCTION public.emit_academic_event IS 'Central event publisher — all academic actions should emit through this';
