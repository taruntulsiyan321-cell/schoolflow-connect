-- ═══════════════════════════════════════════════════════════════════════════
-- POLICIES READ THE CALLER ONCE A STATEMENT, NOT ONCE A ROW
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Supabase's performance advisor (auth_rls_initplan) flagged 189 policies; 193
-- in public call auth.uid() bare. A bare call is evaluated for every row the
-- policy filters. Written `(SELECT auth.uid())` it is an initplan, evaluated
-- once per statement — the same value, because auth.uid() is STABLE.
--
-- Measured 2026-10-13, a student counting their own 3,007 question_attempts:
-- 10.17 ms through RLS as it was, 6.13 ms with that one policy rewritten, 1.06
-- ms with the filter written directly. The database is Micro compute and runs
-- out of CPU under parallel load (KNOWN_ISSUES 129).
--
-- The rewrite is computed from each policy's own live text: every bare
-- `auth.uid()` becomes `( SELECT auth.uid() AS uid)` — the form PostgreSQL
-- prints for that subquery — and calls already in that form are left alone.
-- Nothing else in any policy changes.
--
-- THE EQUIVALENCE WAS PROVEN BEFORE THIS RAN, READ-ONLY (scratchpad e10/equiv.mjs):
-- for each of the 258 USING / WITH CHECK expressions and each of eight people
-- (anonymous, an exam student, and one each of student, teacher, parent,
-- principal, admin, plus a second student), the rows the old expression admits
-- and the rows the new one admits were counted on live: 2,064 comparisons, 0
-- differences, 0 errors. That proof is not repeated here on purpose: run
-- inside this transaction it held the ALTERed tables' locks for two minutes
-- and stalled the cron queue (2026-10-13). This transaction only ALTERs, and
-- gives up rather than queue behind live traffic (lock_timeout).
--
-- After applying: npm run verify:caller-privileges (as each role, live).
--
-- ROLLBACK: rollback/20261161000000_policies_read_the_caller_once.rollback.sql
-- (each policy's exact text before this migration).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';

-- every bare auth.uid() wrapped; an already-wrapped call is set aside first
CREATE FUNCTION pg_temp.e10_wrap(_t text) RETURNS text LANGUAGE sql IMMUTABLE AS $w$
  SELECT CASE WHEN _t IS NULL THEN NULL ELSE
    replace(replace(replace(_t, '( SELECT auth.uid() AS uid)', chr(1)),
                    'auth.uid()', '( SELECT auth.uid() AS uid)'),
            chr(1), '( SELECT auth.uid() AS uid)') END
$w$;
CREATE FUNCTION pg_temp.e10_bare(_t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $w$
  SELECT coalesce(replace(_t, '( SELECT auth.uid() AS uid)', '') LIKE '%auth.uid()%', false)
$w$;

CREATE TEMP TABLE e10_policy AS
SELECT p.tablename, p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check,
       pg_temp.e10_wrap(p.qual) AS qual_new, pg_temp.e10_wrap(p.with_check) AS check_new
  FROM pg_policies p
 WHERE p.schemaname = 'public'
   AND (pg_temp.e10_bare(p.qual) OR pg_temp.e10_bare(p.with_check));

CREATE TEMP TABLE e10_untouched AS
SELECT p.tablename, p.policyname, p.qual, p.with_check
  FROM pg_policies p
 WHERE p.schemaname = 'public'
   AND NOT EXISTS (SELECT 1 FROM e10_policy e WHERE e.tablename = p.tablename AND e.policyname = p.policyname);

DO $rewrite$
DECLARE _p record;
BEGIN
  FOR _p IN SELECT * FROM e10_policy LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I%s%s', _p.policyname, _p.tablename,
                   CASE WHEN _p.qual IS NOT NULL THEN format(' USING (%s)', _p.qual_new) ELSE '' END,
                   CASE WHEN _p.with_check IS NOT NULL THEN format(' WITH CHECK (%s)', _p.check_new) ELSE '' END);
  END LOOP;
END $rewrite$;

-- ── PROOF ───────────────────────────────────────────────────────────────────
DO $proof$
DECLARE _n int; _bad text;
BEGIN
  SELECT count(*) INTO _n FROM e10_policy;
  IF _n < 150 THEN RAISE EXCEPTION 'VERIFY FAILED: only % policies to rewrite', _n; END IF;

  -- 1. each rewritten policy reads exactly as computed; command, roles and
  --    permissiveness unchanged
  SELECT count(*), min(e.tablename || '.' || e.policyname) INTO _n, _bad
    FROM e10_policy e
    LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = e.tablename AND p.policyname = e.policyname
   WHERE p.policyname IS NULL
      OR p.qual IS DISTINCT FROM e.qual_new OR p.with_check IS DISTINCT FROM e.check_new
      OR p.cmd IS DISTINCT FROM e.cmd OR p.roles IS DISTINCT FROM e.roles OR p.permissive IS DISTINCT FROM e.permissive;
  IF _n > 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % policies do not read as rewritten, first %', _n, _bad; END IF;

  -- 2. every other policy is byte-identical
  SELECT count(*), min(u.tablename || '.' || u.policyname) INTO _n, _bad
    FROM e10_untouched u
    LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = u.tablename AND p.policyname = u.policyname
   WHERE p.policyname IS NULL OR p.qual IS DISTINCT FROM u.qual OR p.with_check IS DISTINCT FROM u.with_check;
  IF _n > 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % untouched policies changed, first %', _n, _bad; END IF;

  -- 3. no bare call is left anywhere in public
  SELECT count(*) INTO _n FROM pg_policies p
   WHERE p.schemaname = 'public' AND (pg_temp.e10_bare(p.qual) OR pg_temp.e10_bare(p.with_check));
  IF _n > 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % policies still call auth.uid() per row', _n; END IF;
END $proof$;

DROP TABLE e10_policy, e10_untouched;
DROP FUNCTION pg_temp.e10_bare(text);
DROP FUNCTION pg_temp.e10_wrap(text);

COMMIT;
