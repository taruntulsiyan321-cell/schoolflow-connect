-- =============================================================================
-- Recreate public.student_academic_brain and public.academic_agent_cache
--
-- Discovered missing on the live database on 2026-08-04 by probing the anon
-- REST API directly: `student_academic_brain?select=user_id&limit=1` returns
-- PGRST205 "Could not find the table ... in the schema cache", even though it
-- was defined back in 20260619000000_academic_intelligence_system.sql -- a
-- migration chronologically well before many others (e.g. everything from
-- 2026-07-30 onward) that DO exist live. This is not "migrations after some
-- date are missing" -- it's a specific migration that appears to have been
-- skipped while later ones landed, consistent with this repo's own tooling
-- admitting it "previously skipped 70+ Aug 2026 security/integrity
-- migrations" (scripts/apply-pending-migrations.mjs).
--
-- Why this matters: rpc_refresh_academic_brain() INSERTs into this table on
-- every correct practice answer (called from rpc_record_question_attempt,
-- unguarded at that call site -- unlike the guarded call in
-- rpc_finish_practice_session, which wraps it in BEGIN/EXCEPTION WHEN
-- others THEN NULL). If this table genuinely doesn't exist, that INSERT
-- raises an unhandled exception, which rolls back the ENTIRE attempt-recording
-- transaction -- meaning a student's correct answer would fail to save at all,
-- not just fail to update the cache.
--
-- academic_agent_cache is missing for the identical reason -- defined in the
-- same source migration, also 404s live. Recreated alongside it.
--
-- This migration only recreates the missing tables/indexes/policies, copied
-- verbatim from the original migration. It does not touch anything else from
-- that file (which also altered question_bank/question_templates/
-- question_attempts/student_mistakes columns already confirmed live). Fully
-- idempotent -- safe to run even if the tables turn out to already exist.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.student_academic_brain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  strong_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  strong_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  strong_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  mistake_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  practice_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  speed_trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  accuracy_trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  consistency_trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  mastery_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  improvement_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  mistake_classification_trends jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_session_analytics jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery_completion_pct numeric NOT NULL DEFAULT 0,
  improvement_trend text NOT NULL DEFAULT 'steady'
    CHECK (improvement_trend IN ('improving', 'slipping', 'steady')),
  total_activities int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_academic_brain_student
  ON public.student_academic_brain (student_id);

ALTER TABLE public.student_academic_brain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brain self" ON public.student_academic_brain;
CREATE POLICY "brain self" ON public.student_academic_brain
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "brain teacher" ON public.student_academic_brain;
CREATE POLICY "brain teacher" ON public.student_academic_brain
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = student_academic_brain.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

CREATE TABLE IF NOT EXISTS public.academic_agent_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_type text NOT NULL CHECK (agent_type IN (
    'learning_pattern', 'recovery', 'revision', 'coach'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'rule' CHECK (source IN ('coach', 'rule')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_type)
);

ALTER TABLE public.academic_agent_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent cache self" ON public.academic_agent_cache;
CREATE POLICY "agent cache self" ON public.academic_agent_cache
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
