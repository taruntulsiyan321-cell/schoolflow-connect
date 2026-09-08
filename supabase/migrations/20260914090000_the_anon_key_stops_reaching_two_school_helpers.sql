-- ═══════════════════════════════════════════════════════════════════════════
-- A signed-out visitor stops reaching two school helpers (§10.19)
--
-- Found by `node scripts/run-verification-files.mjs` on 2026-09-08 —
-- CHUNK95_ANON_SURFACE_VERIFY item 1:
--
--   (FAIL) 1: anon can EXECUTE these and no class explains why — a signed-out
--   visitor holding the public anon key can call them:
--   my_visible_exam_ids(), storage_object_owner_school_id(text).
--
-- The `anon` key ships in the browser bundle. Anything `anon` may EXECUTE is
-- callable by anyone who opens the site, signed out, with curl.
--
-- ── 1. storage_object_owner_school_id(text) — MY DEFECT, 2026-09-07 ───────
--
-- `20260914010000` created it and then wrote:
--
--     GRANT EXECUTE ON FUNCTION public.storage_object_owner_school_id(text)
--       TO anon, authenticated, service_role;
--
-- The `anon, authenticated, service_role` triple is the Supabase default and it
-- was copied without asking whether a signed-out visitor needs this one. It
-- does not. The function is SECURITY DEFINER and resolves the SCHOOL of
-- whoever uploaded a storage object — it exists solely so the `academic files
-- read` policy can resolve tenancy without reading `profiles` as the caller
-- (which is the defect that migration was fixing). Both buckets it serves are
-- private as of `20260914000000`, so anon never evaluates that policy at all.
--
-- Only the anon grant goes. `authenticated` and `service_role` keep theirs, and
-- keep them EXPLICITLY rather than through PUBLIC — the policy runs as the
-- caller, so an over-broad REVOKE here would refuse every academic file to
-- every legitimate reader. That is the failure `20260914070000` already had
-- once, from a DROP that took its grants with it.
--
-- ── 2. my_visible_exam_ids() — DEAD SINCE 2026-09-09 ─────────────────────
--
-- Its ACL is `=X/postgres`: granted to PUBLIC, which is how anon reaches it.
-- `20260909000000` replaced it in `exams_read` with the row-local
-- `can_read_exam_row(school_id, class_id)`, because a policy on `exams` that
-- SELECTs from `exams` cannot see the row being inserted and refuses every
-- `INSERT ... RETURNING` with 42501. The old function was left behind.
--
-- Measured across the whole catalog before dropping — policies (USING and
-- WITH CHECK), function bodies, views, and constraints:
--
--     references to my_visible_exam_ids() ....... 0
--
-- Nothing in `src/` calls it either; the only occurrence is the generated
-- `types.ts`, which is regenerated from the schema. So it is dropped rather
-- than re-granted. Leaving an unreferenced SECURITY DEFINER function that
-- returns exam ids reachable by a signed-out visitor buys nothing.
--
-- Its comment claimed it was still "safe in policies on OTHER tables that
-- reference exams". No such policy exists, and `can_read_exam_row` computes the
-- identical predicate for one that ever wants it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── the premise: nothing may depend on what is about to be dropped ────────
DO $premise$
DECLARE _sites text;
BEGIN
  SELECT string_agg(site, ', ') INTO _sites FROM (
    SELECT 'policy ' || c.relname || '.' || pol.polname AS site
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
     WHERE coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
        || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%my_visible_exam_ids%'
    UNION ALL
    SELECT 'function ' || n.nspname || '.' || p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prokind = 'f' AND p.proname <> 'my_visible_exam_ids'
       AND pg_get_functiondef(p.oid) ILIKE '%my_visible_exam_ids%'
    UNION ALL
    SELECT 'view ' || schemaname || '.' || viewname
      FROM pg_views WHERE definition ILIKE '%my_visible_exam_ids%'
    UNION ALL
    SELECT 'constraint ' || conname
      FROM pg_constraint WHERE pg_get_constraintdef(oid) ILIKE '%my_visible_exam_ids%'
  ) s;

  IF _sites IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: my_visible_exam_ids() is still referenced by: % -- it is not dead, do not drop it', _sites;
  END IF;
END $premise$;

DROP FUNCTION IF EXISTS public.my_visible_exam_ids();

REVOKE EXECUTE ON FUNCTION public.storage_object_owner_school_id(text) FROM anon;

COMMENT ON FUNCTION public.storage_object_owner_school_id(text) IS
  'The school of whoever uploaded a storage object, read from segment 1 of the '
  'object name. SECURITY DEFINER because the `academic files read` policy runs '
  'as the CALLER, and a student can only see their own profiles row. NOT '
  'granted to anon: both buckets it serves are private, so a signed-out visitor '
  'never evaluates that policy, and the anon key ships in the browser bundle.';

-- ── verification: inside the transaction, so a failure rolls back ─────────
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'my_visible_exam_ids') THEN
    RAISE EXCEPTION 'ABORT: my_visible_exam_ids() survived the drop';
  END IF;

  IF has_function_privilege('anon', 'public.storage_object_owner_school_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: anon can still execute storage_object_owner_school_id';
  END IF;

  -- POSITIVE CONTROLS. A revoke that also cut off the roles that need the
  -- function would refuse every academic file to everyone, and item 1 of the
  -- anon gate would still go green -- the exact shape of the 20260914070000
  -- regression, where seven failing assertions were all positive controls.
  IF NOT has_function_privilege('authenticated', 'public.storage_object_owner_school_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated LOST execute -- every academic file is now unreadable';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.storage_object_owner_school_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: service_role LOST execute on storage_object_owner_school_id';
  END IF;

  -- The replacement for the dropped function must still be here and reachable,
  -- or exams_read is broken and this migration caused it.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'can_read_exam_row') THEN
    RAISE EXCEPTION 'ABORT: can_read_exam_row is missing -- exams_read has no predicate';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.can_read_exam_row(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated cannot execute can_read_exam_row -- exams_read would refuse everyone';
  END IF;

  RAISE NOTICE 'anon no longer reaches either helper; authenticated keeps both. probe35 asserts it as the caller.';
END $verify$;

COMMIT;
