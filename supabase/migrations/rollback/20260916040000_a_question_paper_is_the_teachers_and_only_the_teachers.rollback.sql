-- Rollback for 20260916040000_a_question_paper_is_the_teachers_and_only_the_teachers
--
-- THIS RESTORES A MEASURED HOLE. Before 20260916040000, as the caller:
--
--   PRINCIPAL creates a paper .................. inserted   (§10 says no)
--   PRINCIPAL edits a teacher's paper .......... updated
--   PRINCIPAL deletes a teacher's paper ........ 1 row
--   STUDENT creates a paper .................... inserted
--
-- Both come back with the old predicate. Run this only to unblock something
-- that genuinely depends on the previous authorship rule, and put it back.
--
-- The anon grants are NOT restored. They were unused, RLS refused anon either
-- way, and re-granting write on three tables to the browser-bundle key to
-- "restore prior state" would be a deliberate step backwards for no caller.
-- If something turns out to have needed them, that is a finding worth having.

CREATE OR REPLACE FUNCTION public.owns_question_paper(_paper_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (SELECT public.is_principal_or_admin((SELECT auth.uid())))
      OR EXISTS (SELECT 1 FROM public.question_papers p
                  WHERE p.id = _paper_id AND p.created_by = (SELECT auth.uid()))
$function$;

DROP POLICY IF EXISTS question_papers_owner ON public.question_papers;
CREATE POLICY question_papers_owner ON public.question_papers
  FOR ALL
  USING ((SELECT public.is_principal_or_admin(auth.uid())) OR created_by = (SELECT auth.uid()))
  WITH CHECK ((SELECT public.is_principal_or_admin(auth.uid())) OR created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS qps_owner ON public.question_paper_sections;
CREATE POLICY qps_owner ON public.question_paper_sections
  FOR ALL
  USING ((SELECT public.is_principal_or_admin(auth.uid())) OR EXISTS (
    SELECT 1 FROM public.question_papers p
     WHERE p.id = question_paper_sections.paper_id AND p.created_by = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.is_principal_or_admin(auth.uid())) OR EXISTS (
    SELECT 1 FROM public.question_papers p
     WHERE p.id = question_paper_sections.paper_id AND p.created_by = (SELECT auth.uid())));

DROP POLICY IF EXISTS qpq_owner ON public.question_paper_questions;
CREATE POLICY qpq_owner ON public.question_paper_questions
  FOR ALL
  USING ((SELECT public.is_principal_or_admin(auth.uid())) OR EXISTS (
    SELECT 1 FROM public.question_papers p
     WHERE p.id = question_paper_questions.paper_id AND p.created_by = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.is_principal_or_admin(auth.uid())) OR EXISTS (
    SELECT 1 FROM public.question_papers p
     WHERE p.id = question_paper_questions.paper_id AND p.created_by = (SELECT auth.uid())));

DROP FUNCTION IF EXISTS public.can_author_question_paper();

DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname='public'
     AND policyname IN ('question_papers_owner','qps_owner','qpq_owner')
     AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%can_author_question_paper%';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % owner policy/policies still reference the dropped helper', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname='public'
     AND policyname IN ('question_papers_tenant_fence','qps_tenant_fence','qpq_tenant_fence');
  IF _n <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of 3 tenant fences present — the school boundary must survive a rollback', _n;
  END IF;

  RAISE NOTICE 'authorship restored to the pre-20260916040000 predicate; the principal and any signed-in user can author papers again.';
END $verify$;
