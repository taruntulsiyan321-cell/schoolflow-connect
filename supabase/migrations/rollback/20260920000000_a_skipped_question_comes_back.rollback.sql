-- Rollback for 20260920000000.
--
-- Recreates practice_skipped with its RLS and indexes as 7B-1 built it.
--
-- READ THIS FIRST: the table comes back EMPTY and still has NO WRITER. That
-- was the defect — nothing has written a skip into it since 20260828170000
-- stripped _upsert_question_record out of rpc_record_question_attempt. Rolling
-- back restores the shape, not the behaviour, and the rows carried out of
-- question_records in 7B-1 are not recoverable from here.
--
-- Only run this if something outside this repository reads the table. If the
-- goal is to make "Skipped Questions" work, question_attempts is where a skip
-- actually lands (`skipped = true`) and the client already reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.practice_skipped (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id  uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_skipped_unique UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS practice_skipped_user_idx ON public.practice_skipped (user_id);

ALTER TABLE public.practice_skipped ENABLE ROW LEVEL SECURITY;

-- Reproduced exactly as 20260828170000 section 4 created them: a RESTRICTIVE
-- tenant fence to anon AND authenticated, and a PERMISSIVE self policy with
-- auth.uid() hoisted into a scalar sub-select so it is a one-time InitPlan
-- rather than a per-row call. Do not "simplify" either back to
-- same_school(school_id) or to a bare auth.uid() — both are recorded
-- performance dead ends in that migration's own header.
DROP POLICY IF EXISTS practice_skipped_tenant_fence ON public.practice_skipped;
CREATE POLICY practice_skipped_tenant_fence ON public.practice_skipped
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS practice_skipped_self ON public.practice_skipped;
CREATE POLICY practice_skipped_self ON public.practice_skipped
  FOR ALL TO authenticated
  USING      (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
