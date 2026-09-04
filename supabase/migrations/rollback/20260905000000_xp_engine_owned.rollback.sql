-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — hand student_xp writes back to the browser
--
-- READ THIS BEFORE RUNNING IT.
--
-- The forward migration closed a hole that was measured live, not theorised:
-- probe8 took a student from rank 11 of 11 to rank 1 on BOTH leaderboards with
-- a single UPDATE of their own row, and the board it moved is the one the
-- student sees by default. Running this file restores that exactly.
--
-- There is no data reason to run it. Nothing written through
-- rpc_apply_progression or rpc_set_equipped_badge depends on the policy or the
-- grant restored here — both are SECURITY DEFINER and bypass RLS either way.
-- The only reason is a bisect.
--
-- Restores, verbatim as measured before the change:
--   POLICY "xp self upsert"  PERMISSIVE  ALL  {authenticated}
--     USING      (user_id = auth.uid())
--     WITH CHECK ((user_id = auth.uid())
--                 AND (school_id IS NULL OR school_id = get_my_school_id()))
--   GRANT INSERT, UPDATE, DELETE ON student_xp TO anon, authenticated
--
-- Note the grant restored is arwd-shaped for anon as well as authenticated,
-- because that is what relacl held before: both roles carried arwdDxtm.
--
-- rpc_set_equipped_badge is dropped, so XpService.setEquippedBadge must be
-- reverted to its direct-write form in the same step or badge equip will fail.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT INSERT, UPDATE, DELETE ON public.student_xp TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.student_xp TO anon;

DROP POLICY IF EXISTS "xp self upsert" ON public.student_xp;

CREATE POLICY "xp self upsert" ON public.student_xp
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    (user_id = auth.uid())
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

DROP FUNCTION IF EXISTS public.rpc_set_equipped_badge(text);

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.student_xp'::regclass
                    AND polname = 'xp self upsert' AND polcmd = '*') THEN
    RAISE EXCEPTION 'xp self upsert was not restored as FOR ALL';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.student_xp', 'UPDATE') THEN
    RAISE EXCEPTION 'the UPDATE grant was not restored';
  END IF;
  IF to_regprocedure('public.rpc_set_equipped_badge(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_set_equipped_badge still exists';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations WHERE version = '20260905000000_xp_engine_owned';

COMMIT;
