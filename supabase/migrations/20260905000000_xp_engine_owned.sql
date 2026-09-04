-- ═══════════════════════════════════════════════════════════════════════════
-- XP is engine-owned: the browser stops writing student_xp
--
-- ── WHAT WAS MEASURED, NOT INFERRED ───────────────────────────────────────
--
-- probe8 ran as a real authenticated student (Vikram Joshi, xp 10, last of 11
-- in his class) through scripts/verify-caller-privileges.mjs:
--
--   XP baseline rank rpc_leaderboard                      OK: 11
--   XP baseline rank progression lifetime                 OK: 10
--   XP direct self-write to student_xp.xp                 OK: 1
--   XP value unchanged after direct write                 xp 10 -> 999999
--   XP rank after write rpc_leaderboard                   OK: 1
--   XP rank after write progression lifetime              OK: 1
--
-- The student reached rank 1 on both boards with one UPDATE of their own row.
-- This was live, not latent: LeaderboardPanel.tsx:54 opens on category "xp",
-- and line 116 maps that category to period "lifetime" — precisely the
-- rpc_progression_leaderboard branch that does ORDER BY x.xp DESC over the raw
-- column. The default leaderboard a student sees was the reachable one.
--
-- ── WHY IT WAS REACHABLE ──────────────────────────────────────────────────
--
-- Two independent grants of the same power, and both had to go:
--
--   1. POLICY "xp self upsert"  PERMISSIVE  ALL  {authenticated}
--        USING      (user_id = auth.uid())
--        WITH CHECK ((user_id = auth.uid())
--                    AND (school_id IS NULL OR school_id = get_my_school_id()))
--
--      The predicate answers "is this MY row?" and never "is this a column I
--      am allowed to set?". RLS cannot express the second question at all —
--      it filters rows, not columns — so FOR ALL on a table whose columns are
--      engine-owned is the whole hole.
--
--   2. GRANT: authenticated=arwdDxtm/postgres — full INSERT/UPDATE/DELETE.
--
--      Worth recording how nearly this was missed: information_schema.
--      role_table_grants returned ZERO rows for student_xp, because that view
--      filters to grants the querying role is a member of. pg_class.relacl is
--      the authoritative source and showed the grant plainly. A privilege
--      audit run through information_schema alone would have called this table
--      clean.
--
-- ── WHAT REPLACES IT ──────────────────────────────────────────────────────
--
-- rpc_apply_progression is already the legitimate path and is already correct:
-- SECURITY DEFINER, owner postgres, it derives the delta from
-- progression_xp_rules rather than trusting a caller-supplied amount, and it
-- guards _target_user_id so a student cannot award another student. It keeps
-- working after this migration because student_xp is NOT force-RLS and the
-- function's owner owns the table, so the definer path bypasses RLS entirely.
-- The verify block below pins both of those facts, because if either changes
-- the engine silently loses its own write.
--
-- The only other client write was XpService.setEquippedBadge (xpService.ts:
-- 132-133), which sets equipped_badge and — on the insert path — xp: 0,
-- level: 1. That is not an XP mutation worth a policy, so it moves to
-- rpc_set_equipped_badge, modelled column-for-column on the sibling that
-- already exists for the neighbouring column, rpc_set_featured_badges.
-- BadgeService.equip already refused unearned badges client-side; the RPC now
-- makes that check the authoritative one instead of a courtesy.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ───────────────────────────────────────
--
-- SELECT is untouched. "xp self read" (SELECT, user_id = auth.uid()) survives
-- unchanged and remains the only read path; anon and authenticated keep their
-- SELECT grant. Narrowing who may READ XP is a separate decision and is not
-- taken here.
--
-- The two competing leaderboard RPCs — rpc_leaderboard and
-- rpc_progression_leaderboard, both reading this same column — are left
-- exactly as they are. That is an SSOT question and needs a ruling, not a
-- migration.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.rpc_apply_progression(text, text, text, text, integer, jsonb, uuid)') IS NULL THEN
    RAISE EXCEPTION
      'ABORT: rpc_apply_progression is missing; revoking the client write would leave NO path that can award XP';
  END IF;

  IF to_regprocedure('public._ensure_student_xp(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: _ensure_student_xp is missing; the equip RPC could not create a first row';
  END IF;

  IF to_regclass('public.student_badges') IS NULL THEN
    RAISE EXCEPTION 'ABORT: student_badges is missing; the equip RPC could not verify a badge was earned';
  END IF;

  -- If the table ever gains FORCE ROW LEVEL SECURITY, dropping the write
  -- policy stops the engine's own SECURITY DEFINER write as well.
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.student_xp'::regclass) THEN
    RAISE EXCEPTION
      'ABORT: student_xp has FORCE ROW LEVEL SECURITY; rpc_apply_progression would be refused too';
  END IF;
END
$guard$;

-- ── 1. the badge-equip path the client keeps ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_set_equipped_badge(_badge_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM public._ensure_student_xp(_uid);

  IF _badge_code IS NULL THEN
    UPDATE public.student_xp SET equipped_badge = NULL, updated_at = now() WHERE user_id = _uid;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.student_badges WHERE user_id = _uid AND badge_code = _badge_code
  ) THEN
    RAISE EXCEPTION 'Badge not earned: %', _badge_code;
  END IF;

  UPDATE public.student_xp SET equipped_badge = _badge_code, updated_at = now() WHERE user_id = _uid;
END;
$function$;

COMMENT ON FUNCTION public.rpc_set_equipped_badge(text) IS
  'Equip/unequip an earned badge. The only client-reachable write to student_xp; every other column is engine-owned via rpc_apply_progression.';

-- Chunk 9.5: authenticated must be granted by name, never left to rely on PUBLIC.
REVOKE ALL ON FUNCTION public.rpc_set_equipped_badge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_equipped_badge(text) TO authenticated;

-- ── 2. the policy stops granting writes ───────────────────────────────────
DROP POLICY IF EXISTS "xp self upsert" ON public.student_xp;

-- "xp self read" (SELECT, user_id = auth.uid()) is deliberately left in place;
-- it already carries the whole read path.

-- ── 3. and so does the grant ──────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.student_xp FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_xp FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.student_xp FROM PUBLIC;

DO $verify$
DECLARE
  _n int;
BEGIN
  -- The write must be gone by BOTH mechanisms. Dropping only the policy would
  -- leave the grant, and revoking only the grant would leave a policy that
  -- silently starts working again the day someone re-grants the table.
  SELECT count(*) INTO _n FROM pg_policy
   WHERE polrelid = 'public.student_xp'::regclass
     AND polpermissive AND polcmd IN ('a', 'w', 'd', '*');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'student_xp still has % permissive write policy(ies)', _n;
  END IF;

  IF has_table_privilege('authenticated', 'public.student_xp', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.student_xp', 'INSERT')
     OR has_table_privilege('authenticated', 'public.student_xp', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated still holds a write privilege on student_xp';
  END IF;
  IF has_table_privilege('anon', 'public.student_xp', 'UPDATE')
     OR has_table_privilege('anon', 'public.student_xp', 'INSERT')
     OR has_table_privilege('anon', 'public.student_xp', 'DELETE') THEN
    RAISE EXCEPTION 'anon still holds a write privilege on student_xp';
  END IF;

  -- The read must survive, or every XP surface in the product goes blank.
  IF NOT has_table_privilege('authenticated', 'public.student_xp', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on student_xp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.student_xp'::regclass
                    AND polname = 'xp self read' AND polcmd = 'r') THEN
    RAISE EXCEPTION 'the SELECT policy "xp self read" is missing';
  END IF;

  -- The engine's own write must still be able to land.
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.rpc_apply_progression(text, text, text, text, integer, jsonb, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'rpc_apply_progression is no longer SECURITY DEFINER; its write would now be refused';
  END IF;
  IF (SELECT proowner FROM pg_proc
       WHERE oid = 'public.rpc_apply_progression(text, text, text, text, integer, jsonb, uuid)'::regprocedure)
     <> (SELECT relowner FROM pg_class WHERE oid = 'public.student_xp'::regclass) THEN
    RAISE EXCEPTION 'rpc_apply_progression is not owned by the owner of student_xp; it would not bypass RLS';
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.student_xp'::regclass) THEN
    RAISE EXCEPTION 'student_xp gained FORCE ROW LEVEL SECURITY; the definer path is refused';
  END IF;

  -- The equip path the client keeps.
  IF to_regprocedure('public.rpc_set_equipped_badge(text)') IS NULL THEN
    RAISE EXCEPTION 'rpc_set_equipped_badge was not created';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.rpc_set_equipped_badge(text)'::regprocedure) THEN
    RAISE EXCEPTION 'rpc_set_equipped_badge is not SECURITY DEFINER; it cannot write past the dropped policy';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rpc_set_equipped_badge(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute rpc_set_equipped_badge; badge equip would break';
  END IF;

  -- The RESTRICTIVE tenancy fence is orthogonal to this change and must remain.
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.student_xp'::regclass
                    AND polname = 'student_xp_tenant_fence'
                    AND polpermissive = false) THEN
    RAISE EXCEPTION 'the RESTRICTIVE tenant fence is missing';
  END IF;
END
$verify$;

COMMIT;
