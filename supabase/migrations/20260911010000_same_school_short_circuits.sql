-- ═══════════════════════════════════════════════════════════════════════════
-- same_school() answers NULL instead of false for a caller with no school, and
-- pays a per-row join to do it
--
-- ── HOW IT SURFACED ──────────────────────────────────────────────────────
--
-- 20260911000000 stopped `get_my_school_id()` handing a super admin a school
-- through `profiles.school_id` (§10.20: the access-log row is the grant). That
-- is correct, and it immediately turned one page into a 500:
--
--     GET /rest/v1/school_activity_feed?school_id=eq.<school A>
--     super_admin -> 500 {"code":"57014","message":"canceling statement due to
--                         statement timeout"}
--     admin       -> 200 (rows)
--
-- Not a permission error. A TIMEOUT.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
--     SELECT _school_id IS NOT NULL
--       AND ( _school_id = public.get_my_school_id()
--             OR public.super_admin_has_access(_school_id) )
--
-- With `get_my_school_id()` NULL, `_school_id = NULL` is NULL — not false. So
-- the OR cannot be folded away, and the planner has no constant to index
-- against. It walks the table, and for EVERY ROW it calls
-- `super_admin_has_access(_school_id)`, which joins `super_admin_access_log` to
-- `super_admins`. The permissive policy alongside then calls `has_role()` three
-- times per surviving row. On a feed table that is a scan with four
-- SECURITY DEFINER lookups per row, and it runs out of statement_timeout.
--
-- The row-level ANSWER was never in doubt: NULL and false both exclude a row,
-- in USING and in WITH CHECK alike. What differs is the cost of arriving at it.
--
-- ── THIS IS NOT ONLY A SUPER ADMIN PROBLEM ───────────────────────────────
--
-- Any caller whose `get_my_school_id()` is NULL takes the same path, and that
-- is not a rare state: 42 of 62 accounts hold no role, and an account with no
-- membership, no student/teacher/parent row and no `profiles.school_id`
-- resolves NULL today. 20260911000000 added one more such account; it did not
-- invent the shape. Every one of them was already paying a full scan on every
-- policy keyed on `same_school`.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- Two guards, both of which the planner can evaluate ONCE because neither
-- depends on the row:
--
--   · `get_my_school_id() IS NOT NULL AND _school_id = get_my_school_id()`
--     makes the answer false rather than NULL for a school-less caller, and
--     collapses the branch to a constant.
--   · `super_admin_has_any_access()` takes no argument, so it is evaluated once
--     and gates the per-row `super_admin_has_access(_school_id)` behind it.
--     A caller with no live grant never pays that join at all; one WITH a grant
--     still gets the per-school check, unchanged.
--
-- SEMANTICS ARE UNCHANGED, and that is the claim to check rather than trust.
-- For every caller that previously got true, both new branches still yield
-- true; for every caller that previously got NULL or false, the result is
-- false. probe23 asserts both directions as the caller, including that a super
-- admin WITH a grant still passes for the granted school and only that school.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.same_school(_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _school_id IS NOT NULL
    AND (
      -- The IS NOT NULL guard is what makes this FALSE rather than NULL for a
      -- caller with no school, so the planner can fold it instead of scanning.
      (public.get_my_school_id() IS NOT NULL AND _school_id = public.get_my_school_id())
      -- Argument-free, so evaluated once per statement: a caller with no live
      -- grant never pays the per-row access-log join behind it.
      OR (public.super_admin_has_any_access() AND public.super_admin_has_access(_school_id))
    )
$function$;

COMMENT ON FUNCTION public.same_school(uuid) IS
  'True when the caller may act in _school_id: their own school, or a school '
  'they hold a live super-admin access grant for (§10.20). Returns FALSE, never '
  'NULL, for a caller with no school -- NULL prevented the planner folding the '
  'predicate and produced a full scan with per-row SECURITY DEFINER lookups, '
  'which timed out (57014) on feed-sized tables.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres`, which has no auth.uid(), so it proves NOTHING about who
-- passes (rule 6). Shape only. The behavioural claims -- that a teacher still
-- matches their own school and not another, that a granted super admin matches
-- the granted school and only that one, and that a school-less caller now gets
-- FALSE rather than NULL -- are asserted as the caller in probe23 (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _fn    text;
  _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'same_school';

  IF _fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: same_school is missing';
  END IF;

  -- Both foldable guards must be present, or the timeout comes back.
  IF _fn !~ 'get_my_school_id\(\)\s+IS NOT NULL' THEN
    RAISE EXCEPTION 'ABORT: the school-less caller still yields NULL, not false';
  END IF;
  IF _fn !~ 'super_admin_has_any_access' THEN
    RAISE EXCEPTION 'ABORT: the per-row access-log join is not gated';
  END IF;

  -- ...and neither of the two ways in may be lost.
  IF _fn !~ 'super_admin_has_access' THEN
    RAISE EXCEPTION 'ABORT: the granted-school branch was dropped -- a granted super admin would be refused';
  END IF;
  IF _fn !~ '_school_id IS NOT NULL' THEN
    RAISE EXCEPTION 'ABORT: a NULL school_id would now match';
  END IF;

  RAISE NOTICE 'same_school folds for school-less callers; behaviour is in probe23.';
END $verify$;
