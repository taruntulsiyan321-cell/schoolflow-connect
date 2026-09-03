-- ═══════════════════════════════════════════════════════════════════════════
-- Only a parent may raise a complaint — Chunk 8 verification item 5
--
-- Item 5: "Teacher attempts to raise a complaint — rejected."
-- It fails today. The INSERT policy is:
--
--   complaints submit  FOR INSERT TO authenticated
--   WITH CHECK (submitted_by = auth.uid() AND school_id = get_my_school_id())
--
-- Tenant-bound and author-bound, with NO ROLE PREDICATE. Any authenticated
-- user with a school passes it — teacher, student, admin, principal.
--
-- §10.19: "Distinct from a complaint, which only a parent can raise and which
-- goes to the principal." §10.15 puts it on the parent panel and says the
-- parent sees the outcome only. §10.12 gives students question-reporting
-- instead and never mentions complaints. The three sections agree.
--
-- ── TWO DOORS, NOT ONE ────────────────────────────────────────────────────
--
-- Fixing `complaints submit` alone would not make the rule true. Postgres ORs
-- permissive policies together, and `complaints staff all` is FOR ALL with a
-- WITH CHECK — so it is an INSERT policy as well as an UPDATE one, and an admin
-- or principal would still be able to raise a complaint through it. The
-- teacher case (item 5) would pass while the rule stayed broken for two other
-- roles. That is the G13 shape at policy level: the second door nobody counted.
--
-- So `complaints staff all` is replaced by the operations staff actually need:
-- UPDATE, which is what the principal's screen uses to set status, and DELETE.
-- SELECT is untouched — `complaints read own` already grants admin and
-- principal read across the school, so no staff read is lost here.
--
-- ── WHAT THIS BREAKS: NOTHING ─────────────────────────────────────────────
--
-- Checked before writing, because "parents only" would be an unshippable change
-- if the only writer were staff. The single INSERT site in the client is
-- OperationalCases.tsx:149, inside `ComplaintsReport`, behind `allowSubmit`
-- — a prop that defaults to FALSE and that its only caller, PrincipalApp.tsx:397,
-- does not pass. The complaint form has never rendered. There is no live writer
-- of any role to break.
--
-- The consequence, stated: this policy is correct and currently unreachable.
-- The parent panel has no complaint form yet, so nothing can insert until one
-- is built. That is the right order — a policy that admits the wrong roles is
-- worse than one nothing has reached yet — but it means item 5 is proved by the
-- policy rejecting a teacher, not by a parent succeeding end to end.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                  WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'parent') THEN
    RAISE EXCEPTION 'ABORT: app_role has no ''parent'' member; the policy below would never admit anyone';
  END IF;
END $$;

-- ── INSERT: parents only ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "complaints submit" ON public.school_complaints;
CREATE POLICY "complaints submit" ON public.school_complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND school_id = public.get_my_school_id()
    AND public.has_role(auth.uid(), 'parent'::public.app_role)
  );

-- ── The staff door, narrowed off INSERT ───────────────────────────────────
DROP POLICY IF EXISTS "complaints staff all" ON public.school_complaints;

CREATE POLICY "complaints staff update" ON public.school_complaints
  FOR UPDATE TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

CREATE POLICY "complaints staff delete" ON public.school_complaints
  FOR DELETE TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE
  _insert_policies text[];
  _bad int;
BEGIN
  SELECT array_agg(polname ORDER BY polname) INTO _insert_policies
  FROM pg_policy
  WHERE polrelid = 'public.school_complaints'::regclass
    AND polpermissive
    AND polcmd IN ('a', '*');   -- 'a' = INSERT, '*' = ALL, which includes INSERT

  IF _insert_policies IS DISTINCT FROM ARRAY['complaints submit'] THEN
    RAISE EXCEPTION
      'ABORT: expected exactly one permissive INSERT path ("complaints submit"), found %',
      COALESCE(array_to_string(_insert_policies, ', '), '(none)');
  END IF;

  -- G11: the check must be able to fail. This one names the predicate, so a
  -- policy recreated without the role test aborts rather than passing on the
  -- strength of its name.
  SELECT count(*) INTO _bad
  FROM pg_policy
  WHERE polrelid = 'public.school_complaints'::regclass
    AND polname = 'complaints submit'
    AND pg_get_expr(polwithcheck, polrelid) NOT ILIKE '%''parent''::app_role%';

  IF _bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: "complaints submit" does not test for the parent role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.school_complaints'::regclass
                    AND polname = 'complaints staff update') THEN
    RAISE EXCEPTION
      'ABORT: staff cannot update complaints; the principal could not set a status';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.school_complaints'::regclass
                    AND polname = 'complaints read own') THEN
    RAISE EXCEPTION
      'ABORT: "complaints read own" is missing; dropping the FOR ALL policy has cost staff their read';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.school_complaints'::regclass
                    AND polname = 'school_complaints_tenant_fence'
                    AND polpermissive = false) THEN
    RAISE EXCEPTION 'ABORT: the RESTRICTIVE tenant fence is missing';
  END IF;
END $$;

COMMIT;
