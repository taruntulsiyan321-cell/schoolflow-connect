-- =====================================================================
-- CHUNK 1 (continued) — TENANCY AS A RESTRICTIVE INVARIANT
--
-- G1 says: "No query may reach across institutions." Until now that was a
-- property each of 297 policies had to remember to enforce, and the leak
-- survey proved they do not: after the membership fence closed the local-record
-- paths, 29 table/person pairs still leaked because those tables' own policies
-- grant by `user_id = auth.uid()` with no tenancy term at all.
--
-- Patching another 30 policies would leave the same trap for policy 298. So
-- instead tenancy becomes a RESTRICTIVE policy: Postgres ANDs restrictive
-- policies with every permissive policy on the table, so no present or future
-- permissive policy can grant across institutions even by mistake. This is G1
-- stated once, as an invariant, instead of 297 times as a convention.
--
-- Verified live before writing this:
--   * service_role and postgres both have rolbypassrls = true, so edge
--     functions and every SECURITY DEFINER RPC are completely unaffected.
--   * authenticated and anon do NOT bypass, which is exactly the surface
--     this is meant to cover.
--
-- same_school() is used, so the super-admin logged-access bypass still works.
--
-- `school_id IS NULL` is permitted. 84 such rows exist outside the exclusion
-- list (ai_feature_flags 4, chat_participants 22, notifications 58) and they
-- are reachable today; blocking them here would be a silent access regression
-- unrelated to tenancy. The NULL-school_id backfill is its own known task.
--
-- Reverse: supabase/migrations/rollback/20260825140000_chunk1_tenant_fence_down.sql
-- =====================================================================

DO $fence$
DECLARE
  _t         text;
  _made      int := 0;
  -- Tables that must NOT be fenced, and exactly why:
  --   memberships           you must see your memberships at OTHER institutions,
  --                         otherwise the panel picker cannot offer a switch
  --   invitations           the invitee has no membership there yet — that is
  --                         the entire point of an invitation
  --   super_admin_access_log  G2 global; its own policies are identity-based
  --   question_bank         G2 "questions": centralised and shared across all
  --                         schools by locked decision 10.9
  --   profiles              global identity; your own profile row must resolve
  --                         regardless of which institution you are active in
  _exclude text[] := ARRAY[
    'memberships', 'invitations', 'super_admin_access_log', 'question_bank', 'profiles'
  ];
BEGIN
  FOR _t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity
       AND NOT (c.relname = ANY (_exclude))
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'school_id'
                      AND a.attnum > 0 AND NOT a.attisdropped)
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_tenant_fence', _t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO authenticated, anon
        USING      (school_id IS NULL OR public.same_school(school_id))
        WITH CHECK (school_id IS NULL OR public.same_school(school_id))
    $f$, _t || '_tenant_fence', _t);
    _made := _made + 1;
  END LOOP;

  RAISE NOTICE 'tenant fence applied to % table(s)', _made;
END;
$fence$;


-- ---------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  -- Every school-scoped table outside the exclusion list carries the fence.
  SELECT count(*), string_agg(c.relname, ', ') INTO _n, _d
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND c.relname NOT IN ('memberships','invitations','super_admin_access_log','question_bank','profiles')
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='school_id'
                   AND a.attnum>0 AND NOT a.attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname='public' AND p.tablename=c.relname
                        AND p.permissive='RESTRICTIVE' AND p.policyname = c.relname||'_tenant_fence');
  IF _n > 0 THEN
    RAISE EXCEPTION 'tenant fence missing on % table(s): %', _n, _d;
  END IF;

  -- The excluded tables must NOT have picked one up.
  SELECT count(*), string_agg(p.tablename, ', ') INTO _n, _d
    FROM pg_policies p
   WHERE p.schemaname='public' AND p.permissive='RESTRICTIVE'
     AND p.policyname LIKE '%_tenant_fence'
     AND p.tablename IN ('memberships','invitations','super_admin_access_log','question_bank','profiles');
  IF _n > 0 THEN
    RAISE EXCEPTION 'tenant fence wrongly applied to excluded table(s): %', _d;
  END IF;

  -- A fence that fenced everyone out of everything would also "pass" the
  -- checks above, so confirm the sole institution still resolves.
  IF (SELECT count(*) FROM public.schools) = 1
     AND (SELECT public.default_school_id()) IS NULL THEN
    RAISE EXCEPTION 'tenant fence: default_school_id() no longer resolves';
  END IF;
END $$;
