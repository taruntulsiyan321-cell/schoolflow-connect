-- ═══════════════════════════════════════════════════════════════════════════
-- A question paper is the teacher's, and only the teacher's (§10, §10.18)
--
-- The three question-paper tables have existed with 0 rows and no UI. Before
-- building the UI onto them, measured who can write through their policies.
--
-- ── MEASURED AS THE CALLER, 2026-09-09, BEFORE THIS MIGRATION ────────────
--
--   TEACHER creates a paper .................... inserted   (positive control)
--   PRINCIPAL creates a paper .................. inserted   <- §10
--   PRINCIPAL edits a teacher's paper .......... updated    <- §10
--   PRINCIPAL deletes a teacher's paper ........ 1 row      <- §10
--   ADMIN creates a paper ...................... inserted
--   STUDENT creates a paper .................... inserted   <- nothing allows this
--   TEACHER writes into ANOTHER school ......... refused    (fence holds)
--   ANON creates a paper ....................... refused    (RLS holds)
--
-- `question_papers_owner` reads
--
--     is_principal_or_admin(auth.uid()) OR created_by = auth.uid()
--
-- and both halves are wrong in opposite directions. The first admits the
-- PRINCIPAL, who "cannot create or edit any record except announcements" —
-- the same defect `testService.ts` was rewritten for on 2026-09-09, one layer
-- down. The second asks only "is this row mine" and never "may this person
-- author a paper at all", so ANY signed-in user who sets `created_by` to
-- themselves passes it. A student authoring question papers is not a rule
-- anyone wrote; it is the absence of one.
--
-- The two child tables delegate to `question_papers.created_by` and carry the
-- same `is_principal_or_admin` branch, so all three move together.
--
-- ── THE RULE ────────────────────────────────────────────────────────────
--
-- The author, and only the author, and the author must be acting as a teacher
-- or an admin. Not the principal. Not another teacher in the same school — a
-- paper is a working draft, and nothing in the brief asks for sharing one.
-- Not the admin over somebody else's paper either: that is the same direction
-- as the 2026-09-09 report ruling, where the office was taken out of a
-- teacher's surface rather than left in it by default.
--
-- `has_role/2` — "acting in this role now" (rule 28) — is the right question
-- here, and it is the same call `is_principal_or_admin` already makes. RLS is
-- never evaluated under service_role, so `has_role/2`'s known NULL there
-- cannot reach this.
--
-- ── ANON ────────────────────────────────────────────────────────────────
--
-- anon holds SELECT, INSERT, UPDATE, DELETE and TRUNCATE on all three tables
-- in the grant table. RLS refuses it today — measured, "new row violates row
-- level security policy" — so this is defence in depth and not a live hole.
-- Chunk 9.5's rule is that anon holds nothing it does not need, and anon needs
-- nothing here at all.
--
-- Rollback: supabase/migrations/rollback/
--           20260916040000_a_question_paper_is_the_teachers_and_only_the_teachers.rollback.sql
-- Assertion: verification/caller-privileges/probe39.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── May this caller author question papers at all? ───────────────────────
CREATE OR REPLACE FUNCTION public.can_author_question_paper()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (SELECT public.has_role((SELECT auth.uid()), 'teacher'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
$function$;

COMMENT ON FUNCTION public.can_author_question_paper() IS
  'Teacher or admin, acting in that role now. The principal is deliberately '
  'absent (§10: creates nothing but announcements) and so is every other role: '
  'before 20260916040000 any signed-in user, students included, could author a '
  'question paper by setting created_by to themselves.';

-- ── ...and is this particular paper theirs? ──────────────────────────────
CREATE OR REPLACE FUNCTION public.owns_question_paper(_paper_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_author_question_paper()
     AND EXISTS (
           SELECT 1 FROM public.question_papers p
            WHERE p.id = _paper_id
              AND p.created_by = (SELECT auth.uid())
         )
$function$;

COMMENT ON FUNCTION public.owns_question_paper(uuid) IS
  'The single home for "this paper is mine to write". Both child tables ask it '
  'rather than repeating the join, so widening authorship is one edit.';

REVOKE ALL ON FUNCTION public.can_author_question_paper() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_question_paper(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_author_question_paper() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_question_paper(uuid) TO authenticated;

-- ── The three owner policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS question_papers_owner ON public.question_papers;
CREATE POLICY question_papers_owner ON public.question_papers
  FOR ALL
  USING (created_by = (SELECT auth.uid()) AND public.can_author_question_paper())
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.can_author_question_paper());

DROP POLICY IF EXISTS qps_owner ON public.question_paper_sections;
CREATE POLICY qps_owner ON public.question_paper_sections
  FOR ALL
  USING (public.owns_question_paper(paper_id))
  WITH CHECK (public.owns_question_paper(paper_id));

DROP POLICY IF EXISTS qpq_owner ON public.question_paper_questions;
CREATE POLICY qpq_owner ON public.question_paper_questions
  FOR ALL
  USING (public.owns_question_paper(paper_id))
  WITH CHECK (public.owns_question_paper(paper_id));

-- ── anon holds nothing here ──────────────────────────────────────────────
REVOKE ALL ON public.question_papers FROM anon;
REVOKE ALL ON public.question_paper_sections FROM anon;
REVOKE ALL ON public.question_paper_questions FROM anon;

-- ── Proof, before this commits ───────────────────────────────────────────
--
-- Runs as postgres, so it CANNOT prove a refusal — probe39 does that as the
-- caller. What it proves here is that the policies say what they are meant to
-- say and that the grant is gone, both of which are facts about the catalog
-- and are exactly what a postgres-role block can establish.
DO $verify$
DECLARE _n int; _bad text;
BEGIN
  -- No owner policy may still name the principal helper.
  SELECT string_agg(policyname, ', ') INTO _bad
    FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('question_papers','question_paper_sections','question_paper_questions')
     AND policyname IN ('question_papers_owner','qps_owner','qpq_owner')
     AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_principal_or_admin%';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: % still admits the principal', _bad;
  END IF;

  -- ...and every one of them must ask whether the caller may author at all —
  -- the parent policy directly, the two child policies through
  -- `owns_question_paper`, which is defined to require it.
  --
  -- THE INDIRECTION IS ASSERTED SEPARATELY, BELOW. Accepting the name
  -- `owns_question_paper` in a policy proves nothing on its own: if that
  -- function were ever rewritten to drop the capability test, all three
  -- policies would still read as checking it. The first version of this block
  -- looked for the direct call in all three and refused to commit — correctly,
  -- because the claim it was making was the wrong one.
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname='public'
     AND policyname IN ('question_papers_owner','qps_owner','qpq_owner')
     AND (coalesce(qual,'') || coalesce(with_check,''))
         SIMILAR TO '%(can_author_question_paper|owns_question_paper)%';
  IF _n <> 3 THEN
    RAISE EXCEPTION
      'ROLLED BACK: only % of 3 owner policies check authorship capability — a '
      'paper table whose policy asks only "is this row mine" lets any signed-in '
      'user write it', _n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='owns_question_paper'
       AND pg_get_functiondef(p.oid) LIKE '%can_author_question_paper%'
  ) THEN
    RAISE EXCEPTION
      'ROLLED BACK: owns_question_paper no longer asks whether the caller may '
      'author at all, so the two child policies check only ownership';
  END IF;

  -- The tenant fences must survive: this migration replaced the OWNER policies
  -- and must not have taken the school boundary with them.
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname='public'
     AND policyname IN ('question_papers_tenant_fence','qps_tenant_fence','qpq_tenant_fence');
  IF _n <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of 3 tenant fences present after the rewrite', _n;
  END IF;

  -- anon holds nothing.
  SELECT count(*) INTO _n
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee='anon'
     AND table_name IN ('question_papers','question_paper_sections','question_paper_questions');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: anon still holds % grant(s) on the paper tables', _n;
  END IF;

  RAISE NOTICE 'question paper authorship: the author, acting as teacher or admin, and nobody else.';
END $verify$;
