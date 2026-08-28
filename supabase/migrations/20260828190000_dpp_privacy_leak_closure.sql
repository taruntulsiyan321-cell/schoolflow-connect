-- ═══════════════════════════════════════════════════════════════════════════
-- CLOSE THE DPP PRACTICE LEAK
--
-- Independent of the decision to remove DPP as a feature. DPP is legacy and is
-- being removed, but named students' practice accuracy served to any
-- authenticated teacher is a live §10.8 violation and does not wait for a
-- feature removal to be planned, reported and approved.
--
-- §10.8: "Self-directed only. Completely private to the student. No teacher,
-- no parent, no principal, no aggregate, no school-side AI use."
--
-- A DPP is student-initiated and not teacher-assigned, so under the
-- transient-vs-durable ruling it is practice, not assessment. Everything below
-- therefore has no right to exist.
--
-- ── WHAT WAS LEAKING ───────────────────────────────────────────────────────
--
-- 1. rpc_teacher_class_insights(_class_id) — SECURITY DEFINER, EXECUTE granted
--    to authenticated, gated to admin / principal / teacher-of-class. Returned:
--
--      at_risk[].avg_accuracy   named students, each with their DPP accuracy,
--                               from dpp_attempts.correct_count / total_count
--      class_weak_topics        class-level practice aggregates built from
--                               dpp_answers.is_correct, grouped by subject
--                               and chapter
--
--    This is the same shape as rpc_teacher_concept_analytics(), which §10.8
--    ordered removed and Chunk 1.6 gutted. It survived because it lives inside
--    a SECURITY DEFINER body, which policy-level auditing does not see — the
--    exact gap the doc warns about, and the third instance of it (Nova's
--    facts bundle, rpc_dpp_pick_from_bank in 7A, this).
--
-- 2. Five permissive read policies, which is how the teacher page
--    src/pages/teacher/DppAnalytics.tsx reads the same data directly:
--
--      dpp_answers   "dppans teacher read"      teacher of the class
--      dpp_answers   "dppans admin all"         admin
--      dpp_attempts  "dppa teacher read"        teacher of the class
--      dpp_attempts  "dppa parent read child"   parent, for their child
--      dpp_attempts  "dppa admin all"           admin
--
--    Removing only the RPC would have left the accuracy readable: a teacher
--    still reads correct_count / total_count straight off dpp_attempts.
--
-- ── WHAT WAS CHECKED AND IS NOT LEAKING ────────────────────────────────────
--
-- Every other DPP-reading function was read rather than assumed:
--
--   _weak_topics_for_user, _build_concept_recovery_report,
--   _capture_dpp_mistakes           EXECUTE not granted to authenticated;
--                                   reachable only from other definers.
--   rpc_dpp_submit                  binds to auth.uid().
--   rpc_get_concept_recovery_report takes a caller-supplied _source_id, but
--                                   _build_concept_recovery_report filters
--                                   `AND att.user_id = _uid` on both of its
--                                   queries, so passing another student's
--                                   attempt id returns nothing.
--   rpc_student_academic_snapshot, rpc_student_improvement_plans,
--   rpc_student_performance_charts, rpc_student_revision_queue,
--   rpc_post_assessment_concept_analysis
--                                   take no user-id argument and derive
--                                   _uid := auth.uid().
--
-- ── WHAT BREAKS, DELIBERATELY ──────────────────────────────────────────────
--
-- src/pages/teacher/DppAnalytics.tsx will return nothing. Per §10.8: "Leave
-- the broken screens broken and list them. Do not silently substitute another
-- data source to keep them working" — that would reintroduce the leak through
-- a different door. The page is removed with the rest of DPP.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Prove the leak is real before closing it ────────────────────────────
--
-- G11: a check must pass for the reason it claims. Asserting "the teacher sees
-- zero" after the fix proves nothing on its own — a teacher who could never
-- see anything would also see zero. Measure first, with the policies still in
-- place, and refuse to continue if there is nothing to close.
DO $before$
DECLARE _teacher uuid; _att bigint; _ans bigint;
BEGIN
  SELECT id INTO _teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  IF _teacher IS NULL THEN
    RAISE EXCEPTION 'leak closure: no teacher account to measure with; the before/after would prove nothing.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _att FROM public.dpp_attempts;
  SELECT count(*) INTO _ans FROM public.dpp_answers;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _att = 0 AND _ans = 0 THEN
    RAISE EXCEPTION
      'leak closure: the teacher already reads 0 DPP attempts and 0 answers, so there is nothing here to close and the after-check would be vacuous. Investigate before assuming this is fixed.';
  END IF;

  RAISE NOTICE 'leak confirmed live: teacher reads % dpp_attempts and % dpp_answers before closure.', _att, _ans;
END
$before$;


-- ── 2. The definer that policy auditing could not see ──────────────────────
DROP FUNCTION IF EXISTS public.rpc_teacher_class_insights(uuid);


-- ── 3. The five permissive read policies ───────────────────────────────────
DROP POLICY IF EXISTS "dppans teacher read"    ON public.dpp_answers;
DROP POLICY IF EXISTS "dppans admin all"       ON public.dpp_answers;
DROP POLICY IF EXISTS "dppa teacher read"      ON public.dpp_attempts;
DROP POLICY IF EXISTS "dppa parent read child" ON public.dpp_attempts;
DROP POLICY IF EXISTS "dppa admin all"         ON public.dpp_attempts;


-- ── 4. Assert the closure, per role, and that the student still has theirs ─
DO $after$
DECLARE
  _r     record;
  _n     bigint;
  _fail  text := '';
  _owner uuid;
BEGIN
  FOR _r IN
    SELECT * FROM (VALUES
      ('teacher',   'priya.sharma@wisdomcampus.com'),
      ('parent',    'mehta.parent@wisdomcampus.com'),
      ('admin',     'admin@wisdomcampus.com'),
      ('principal', 'principal@wisdomcampus.com')
    ) AS v(label, email)
  LOOP
    DECLARE _uid uuid; _att bigint; _ans bigint;
    BEGIN
      SELECT id INTO _uid FROM auth.users WHERE email = _r.email;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO _att FROM public.dpp_attempts;
      SELECT count(*) INTO _ans FROM public.dpp_answers;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);

      IF _att <> 0 OR _ans <> 0 THEN
        _fail := _fail || format('[%s still reads %s attempts / %s answers] ', _r.label, _att, _ans);
      END IF;
    END;
  END LOOP;

  -- The other half: the student whose data it is must still read it. Without
  -- this, a fence that locked everyone out would pass the checks above.
  SELECT a.user_id INTO _owner
    FROM public.dpp_attempts a
   WHERE EXISTS (SELECT 1 FROM public.dpp_answers x WHERE x.attempt_id = a.id)
   LIMIT 1;

  IF _owner IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.dpp_attempts;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF _n = 0 THEN
      _fail := _fail || '[the owning student can no longer read their own DPP attempts — over-tightened] ';
    END IF;
  END IF;

  -- And the definer is gone, not merely revoked.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'rpc_teacher_class_insights') THEN
    _fail := _fail || '[rpc_teacher_class_insights still exists] ';
  END IF;

  -- Nothing else may grant a non-student read on these two tables.
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname IN ('dpp_answers','dpp_attempts')
       AND p.polpermissive
       AND pg_get_expr(p.polqual, p.polrelid) ~* 'has_role|teacher_teaches_class|parent'
  ) THEN
    _fail := _fail || '[a permissive role-based read policy survives on a DPP table] ';
  END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'DPP leak closure FAILED: %', _fail;
  END IF;
END
$after$;

COMMIT;
