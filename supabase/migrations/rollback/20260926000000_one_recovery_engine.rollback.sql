-- Rollback for 20260926000000.
--
-- READ THIS FIRST: the two tables come back EMPTY, and they come back with no
-- writer and no reader. The 17 assignments and 57 questions that were in them
-- are not recoverable from here; every one of those assignments sat at
-- questions_completed = 0, and the screens that could have opened them were
-- deleted in "Delete the retired recovery-assignment flow", one commit before
-- the drop. Rolling this back restores a shape, not a feature.
--
-- What it DOES restore, and the reason to run it, is the function surface: if
-- something outside this repository calls rpc_get_recovery_assignment,
-- rpc_submit_recovery_answer, rpc_complete_recovery_assignment,
-- rpc_student_recovery_zone, rpc_assign_concept_recovery or
-- rpc_complete_revision, this file is not enough — those six function bodies
-- were dropped and are recoverable only from the migrations that created them
-- (search supabase/migrations for each name). This file restores the tables
-- they need, so those bodies can be re-applied on top.
--
-- The six rewritten functions are NOT reverted here either, for the same
-- reason 20260926000000 guards them by md5: their live bodies had already
-- diverged from every migration file. Reverting one would need its previous
-- body, and the only copy of that is in the transcript of the session that
-- wrote the migration. What this file gives back is the schema those bodies
-- referenced.

BEGIN;

CREATE TABLE IF NOT EXISTS public.recovery_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id          uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subject             text NOT NULL,
  chapter             text,
  concept             text NOT NULL,
  subconcept          text,
  severity            text NOT NULL CHECK (severity IN ('minor', 'moderate', 'severe')),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  question_count      integer NOT NULL DEFAULT 0,
  questions_completed integer NOT NULL DEFAULT 0,
  questions_correct   integer NOT NULL DEFAULT 0,
  source_type         text CHECK (source_type IN ('practice', 'test', 'battle')),
  source_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  school_id           uuid REFERENCES public.schools(id)
);

CREATE TABLE IF NOT EXISTS public.recovery_assignment_questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id    uuid NOT NULL REFERENCES public.recovery_assignments(id) ON DELETE CASCADE,
  order_index      integer NOT NULL DEFAULT 0,
  question_text    text NOT NULL,
  options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer   jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation      text,
  bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  template_id      uuid REFERENCES public.question_templates(id) ON DELETE SET NULL,
  answered         boolean NOT NULL DEFAULT false,
  is_correct       boolean,
  student_answer   jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  school_id        uuid REFERENCES public.schools(id)
);

CREATE INDEX IF NOT EXISTS recovery_assignments_school_id_idx
  ON public.recovery_assignments (school_id);
CREATE INDEX IF NOT EXISTS recovery_assignments_user_open
  ON public.recovery_assignments (user_id, status)
  WHERE status IN ('pending', 'in_progress');
-- The v2 index is the one that closed the "2x Polynomials" duplicate found in
-- the production audit (G2-8). Without it rpc_assign_concept_recovery has no
-- idempotency at all.
CREATE UNIQUE INDEX IF NOT EXISTS recovery_assignments_open_unique_v2
  ON public.recovery_assignments (user_id, subject, COALESCE(chapter, ''), concept)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS recovery_assignment_questions_school_id_idx
  ON public.recovery_assignment_questions (school_id);
CREATE INDEX IF NOT EXISTS recovery_questions_assignment
  ON public.recovery_assignment_questions (assignment_id, order_index);

ALTER TABLE public.recovery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_assignment_questions ENABLE ROW LEVEL SECURITY;

-- Both tables carried the blanket anon/authenticated DML grant these schemas
-- get by default, so the RESTRICTIVE fence is the only thing standing between
-- anon and the rows. Restore it in the same statement order as the table.
DROP POLICY IF EXISTS recovery_assignments_tenant_fence ON public.recovery_assignments;
CREATE POLICY recovery_assignments_tenant_fence ON public.recovery_assignments
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS "recovery self" ON public.recovery_assignments;
CREATE POLICY "recovery self" ON public.recovery_assignments
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recovery_assignment_questions_tenant_fence ON public.recovery_assignment_questions;
CREATE POLICY recovery_assignment_questions_tenant_fence ON public.recovery_assignment_questions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS "recovery q via assignment" ON public.recovery_assignment_questions;
CREATE POLICY "recovery q via assignment" ON public.recovery_assignment_questions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recovery_assignments a
     WHERE a.id = recovery_assignment_questions.assignment_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recovery_assignments a
     WHERE a.id = recovery_assignment_questions.assignment_id AND a.user_id = auth.uid()));

DROP TRIGGER IF EXISTS recovery_assignments_set_school ON public.recovery_assignments;
CREATE TRIGGER recovery_assignments_set_school
  BEFORE INSERT ON public.recovery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP TRIGGER IF EXISTS trg_recovery_assignment_questions_set_school ON public.recovery_assignment_questions;
CREATE TRIGGER trg_recovery_assignment_questions_set_school
  BEFORE INSERT ON public.recovery_assignment_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

COMMIT;
