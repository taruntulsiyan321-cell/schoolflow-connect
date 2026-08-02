-- =============================================================================
-- APPLY_SUPA_HW_MARKS_PUBLISH_INTEGRITY.sql
-- Source: supabase/migrations/20260802530000_supa_hw_marks_publish_integrity.sql
-- Production integrity: school-scoped scheduled publish + marks RLS gate until
-- exams.results_published_at is set (student/parent/classmate reads).
-- Apply in Supabase SQL editor if migrations are not auto-applied.
-- =============================================================================
-- Supervisor A: scheduled publish school-scope + marks publish gate at RLS
-- Cross-impact: teacher schedule → student homework/tests; finalize≠publish for student/parent reads.

-- ── 0. Ensure publish-gate / RPC columns exist (idempotent) ───────────────────
-- Prior migrations (homework_engine / teacher_academic_workspace) may be unapplied
-- on some environments; policies and the publish RPC must not fail on missing cols.
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS results_published_at timestamptz;

ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.dpps
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 1. School-scoped due publish (homework + class tests) ─────────────────────
CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework(_school_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n_hw int := 0;
  _n_test int := 0;
BEGIN
  UPDATE public.homework
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_school_id IS NULL OR school_id = _school_id);
  GET DIAGNOSTICS _n_hw = ROW_COUNT;

  UPDATE public.dpps
  SET status = 'published',
      is_published = true,
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_school_id IS NULL OR school_id = _school_id);
  GET DIAGNOSTICS _n_test = ROW_COUNT;

  RETURN _n_hw + _n_test;
END;
$$;

COMMENT ON FUNCTION public.publish_due_scheduled_homework(uuid) IS
  'Publishes scheduled homework and class tests (dpps) whose scheduled_publish_at has passed; optional school scope.';

GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_homework(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_homework(uuid) TO service_role;

-- Keep zero-arg overload for any legacy callers / cron
CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.publish_due_scheduled_homework(NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_homework() TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_homework() TO service_role;

-- ── 2. Marks SELECT: students/parents/classmates only after results published ─
DROP POLICY IF EXISTS "marks student read" ON public.marks;
CREATE POLICY "marks student read" ON public.marks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.exams e ON e.id = marks.exam_id
      WHERE s.id = marks.student_id
        AND s.user_id = auth.uid()
        AND e.results_published_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "marks parent read" ON public.marks;
CREATE POLICY "marks parent read" ON public.marks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.exams e ON e.id = marks.exam_id
      WHERE s.id = marks.student_id
        AND s.parent_user_id = auth.uid()
        AND e.results_published_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Parents via parent_students can view marks" ON public.marks;
CREATE POLICY "Parents via parent_students can view marks"
  ON public.marks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parents p
      JOIN public.parent_students ps ON ps.parent_id = p.id
      JOIN public.exams e ON e.id = marks.exam_id
      WHERE p.user_id = auth.uid()
        AND ps.student_id = marks.student_id
        AND e.results_published_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "marks classmate read" ON public.marks;
CREATE POLICY "marks classmate read" ON public.marks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.exams e
      JOIN public.students me ON (me.user_id = auth.uid() OR me.parent_user_id = auth.uid())
      WHERE e.id = marks.exam_id
        AND e.class_id = me.class_id
        AND e.results_published_at IS NOT NULL
    )
  );
