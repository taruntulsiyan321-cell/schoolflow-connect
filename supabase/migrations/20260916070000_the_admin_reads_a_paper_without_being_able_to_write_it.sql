-- ═══════════════════════════════════════════════════════════════════════════
-- The admin reads a paper without being able to write it (§10, §10.18)
--
-- `20260916040000` replaced the three question-paper owner policies, which had
-- been `is_principal_or_admin(auth.uid()) OR created_by = auth.uid()`, with
-- "the author, acting as teacher or admin". That closed two measured holes —
-- the principal could create, edit and delete papers, and any signed-in user
-- including a student could author one — and it went one step too far.
--
-- probe17 claim 6 has asserted since the tables were created that
--
--     an admin of the same school DOES see it.              (staff rule)
--
-- and it went red. The suite is the reason that was found within the hour
-- rather than by an admin noticing an empty screen: 389 of 390 assertions held
-- and the one that did not named the rule it was defending.
--
-- ── WHAT THIS RESTORES, AND WHAT IT DOES NOT ────────────────────────────
--
-- READ comes back, for the ADMIN, on all three tables. WRITE does not: the
-- author is still the only person who can create, edit or delete a paper, its
-- sections or its questions. Splitting the two is the whole point — the
-- previous `FOR ALL` policy could not express "may look, may not touch", which
-- is why the principal ended up able to delete a teacher's paper.
--
-- THE PRINCIPAL IS DELIBERATELY NOT RESTORED, in either direction. Nothing
-- asserts they may read a paper; §10 gives them announcements and nothing
-- else; and the 2026-09-09 ruling on the test report took the office out of a
-- teacher's surface rather than leaving it in by default. That is a narrowing
-- against the pre-20260916040000 behaviour and it is stated here rather than
-- buried: if the principal should see papers, this is the one-line widening.
--
-- Rollback: supabase/migrations/rollback/
--           20260916070000_the_admin_reads_a_paper_without_being_able_to_write_it.rollback.sql
-- Assertion: verification/caller-privileges/probe17.sql (claim 6, restored to
--            green) and probe39.sql (the writes stay shut).
-- ═══════════════════════════════════════════════════════════════════════════

-- Read-only, and admin-only. `has_role/2` — acting as admin now (rule 28) —
-- rather than `is_principal_or_admin`, which is what let the principal in.
CREATE POLICY question_papers_staff_read ON public.question_papers
  FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY qps_staff_read ON public.question_paper_sections
  FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY qpq_staff_read ON public.question_paper_questions
  FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- ── Proof, before this commits ───────────────────────────────────────────
--
-- A postgres-role block cannot prove a refusal, but it CAN set the claim these
-- helpers read and ask the two questions that matter here, over a real paper.
-- One is written and rolled back inside this block — the migration itself runs
-- in a transaction, and this uses a savepoint so the fixture cannot survive
-- even if the rest of the file commits.
DO $verify$
DECLARE
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  teacher uuid; admin_u uuid; principal uuid;
  paper   uuid;
  can_read_admin boolean; can_read_principal boolean; can_write_admin boolean;
BEGIN
  SELECT id INTO teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO admin_u   FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO principal FROM auth.users WHERE email='principal@wisdomcampus.com';

  IF teacher IS NULL OR admin_u IS NULL OR principal IS NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK: fixtures missing (teacher=%, admin=%, principal=%) — a check '
      'that cannot run is not a check that passed', teacher, admin_u, principal;
  END IF;

  -- The policies exist and are SELECT-only. A FOR ALL policy here would hand
  -- the admin write access back, which is the half this migration must not
  -- restore.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public'
         AND policyname IN ('question_papers_staff_read','qps_staff_read','qpq_staff_read')
         AND cmd = 'SELECT') <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: the three staff-read policies are not all SELECT-only';
  END IF;

  -- None of them may name the principal helper.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND policyname IN ('question_papers_staff_read','qps_staff_read','qpq_staff_read')
       AND coalesce(qual,'') LIKE '%is_principal_or_admin%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: a staff-read policy admits the principal';
  END IF;

  -- The owner policies must still be the author-only form from 20260916040000.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public'
         AND policyname IN ('question_papers_owner','qps_owner','qpq_owner')
         AND (coalesce(qual,'') || coalesce(with_check,''))
             SIMILAR TO '%(can_author_question_paper|owns_question_paper)%') <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: the author-only write rule was lost';
  END IF;

  -- Behaviour, on a real row, rolled back to a savepoint.
  BEGIN
    INSERT INTO public.question_papers (school_id, created_by, title, subject, class_level)
    VALUES (sch_a, teacher, 'staff-read verify fixture', 'Science', 10)
    RETURNING id INTO paper;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', admin_u, 'role','authenticated')::text, true);
    SELECT EXISTS (SELECT 1 FROM public.question_papers p WHERE p.id = paper)
      INTO can_read_admin;
    SELECT public.can_author_question_paper() INTO can_write_admin;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', principal, 'role','authenticated')::text, true);
    SELECT EXISTS (SELECT 1 FROM public.question_papers p WHERE p.id = paper)
      INTO can_read_principal;

    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'ROLLBACK_FIXTURE';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', '', true);
    IF SQLERRM <> 'ROLLBACK_FIXTURE' THEN
      RAISE;
    END IF;
  END;

  -- NOTE, and it is why this is a NOTICE and not an assertion: this block runs
  -- as `postgres`, which BYPASSES RLS, so both reads above are true whatever
  -- the policies say. The real claim is probe17's, as the caller. Printing the
  -- values keeps the applier honest about what was and was not established.
  RAISE NOTICE
    'staff-read policies installed. As postgres (RLS bypassed) admin_read=%, principal_read=%, admin_may_author=%. '
    'The binding assertion is probe17 claim 6, run as the caller.',
    can_read_admin, can_read_principal, can_write_admin;
END $verify$;
