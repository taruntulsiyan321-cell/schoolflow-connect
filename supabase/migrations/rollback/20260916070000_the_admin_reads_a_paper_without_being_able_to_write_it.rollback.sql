-- Rollback for 20260916070000_the_admin_reads_a_paper_without_being_able_to_write_it
--
-- Drops the three read-only staff policies. After this an admin can no longer
-- see a teacher's question paper, its sections or its questions, and probe17
-- claim 6 — "an admin of the same school DOES see it (staff rule)" — goes red
-- again. That claim has stood since the tables were created, so expect the
-- suite to fail after running this; that is the correct signal, not a fault.
--
-- The author-only WRITE rule from 20260916040000 is untouched: rolling back a
-- read policy must not hand write access back to the principal and to every
-- signed-in student.

DROP POLICY IF EXISTS question_papers_staff_read ON public.question_papers;
DROP POLICY IF EXISTS qps_staff_read ON public.question_paper_sections;
DROP POLICY IF EXISTS qpq_staff_read ON public.question_paper_questions;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND policyname IN ('question_papers_staff_read','qps_staff_read','qpq_staff_read')
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: a staff-read policy is still present';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public'
         AND policyname IN ('question_papers_owner','qps_owner','qpq_owner')
         AND (coalesce(qual,'') || coalesce(with_check,''))
             SIMILAR TO '%(can_author_question_paper|owns_question_paper)%') <> 3 THEN
    RAISE EXCEPTION
      'ROLLED BACK: the author-only write rule went with them — that would reopen '
      'question-paper writes to the principal and to students';
  END IF;

  RAISE NOTICE 'staff-read policies removed; the author-only write rule is intact. probe17 claim 6 will now fail.';
END $verify$;
