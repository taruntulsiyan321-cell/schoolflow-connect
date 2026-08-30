-- ═══════════════════════════════════════════════════════════════════════════
-- HOTFIX: four functions still address `tests` with `dpps` column names
--
-- Found by the Chunk 9.5 batch 2 smoke gate, and NOT caused by it. The student
-- screen failed with
--
--     HTTP 400  rpc_student_academic_snapshot
--     42703: column d.is_published does not exist
--
-- 42703 is "undefined column", not 42501 "permission denied". A revoke
-- produces the latter. And rpc_student_academic_snapshot still holds its grant
-- — verified — so the grant is not what broke it.
--
-- ── What actually happened ────────────────────────────────────────────────
--
-- Chunk 7.5c repointed the Tests feature from `dpps` onto `tests`. In these
-- four functions it changed the TABLE and left the COLUMNS:
--
--   publish_due_scheduled_homework   UPDATE public.tests SET ... is_published = true
--   rpc_leaderboard                  FROM public.tests dp ... WHERE dp.is_published
--   rpc_principal_school_health      FROM public.tests d  ... WHERE d.is_published
--   rpc_student_academic_snapshot    FROM public.tests d  ... WHERE d.is_published
--                                                             AND d.class_id = ...
--
-- `dpps` had is_published and class_id. `tests` has neither: it carries
-- `status` plus `published_at`, and reaches its section through
-- section_subject_id. The alias `d` is itself a leftover — it stood for dpp.
--
-- So four live surfaces have been erroring since 7.5c: the student dashboard,
-- the leaderboard, the principal health brief, and the scheduled-homework
-- publisher. The student one throws on every page load.
--
-- ── Why no gate caught it until now ───────────────────────────────────────
--
-- 7.5 item 4 swept for the literal string `dpp` and found none — these bodies
-- say `tests`. Nothing swept for columns that no longer exist. A function body
-- referencing a dropped column is not a syntax error at CREATE time; plpgsql
-- resolves column names at execution, so it compiles clean and fails only when
-- a real user calls it.
--
-- That is worth a gate of its own, recorded as follow-up: parse every function
-- body for `alias.column` against the tables it selects from. Not done here —
-- this migration fixes the four and does not invent a linter while a student
-- dashboard is throwing.
--
-- ── The mapping ───────────────────────────────────────────────────────────
--
--   dpps.is_published  ->  tests.status = 'published'
--   dpps.class_id      ->  tests.section_subject_id IN (
--                            SELECT id FROM section_subjects WHERE section_id = ...)
--
-- Rewritten through pg_get_functiondef so signature, volatility, SECURITY
-- DEFINER flag and search_path survive exactly, and CREATE OR REPLACE so the
-- grants are not dropped.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Prove all four are broken before fixing them ───────────────────────────
DO $before$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.prosrc ~ '\mis_published\M';

  IF _n = 0 THEN
    RAISE EXCEPTION
      'hotfix: no function references is_published any more, so there is nothing to fix and the after-check would be vacuous.';
  END IF;
  RAISE NOTICE 'hotfix: % function(s) reference is_published before the fix.', _n;
END
$before$;


DO $fix$
DECLARE r record; _def text; _new text; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f' AND p.prosrc ~ '\mis_published\M'
     ORDER BY p.proname
  LOOP
    _def := pg_get_functiondef(r.oid);
    _new := _def;

    -- The write: status is already being set to 'published' beside it, so the
    -- column reference is simply removed rather than translated twice.
    _new := replace(_new, E'status = ''published'',\n      is_published = true,', E'status = ''published'',');
    _new := replace(_new, 'is_published = true,', '');

    -- The reads, alias by alias.
    _new := replace(_new, 'dp.is_published', 'dp.status = ''published''');
    _new := replace(_new, 'd.is_published',  'd.status = ''published''');

    -- tests has no class_id; it reaches a section through section_subjects.
    _new := replace(_new,
      'd.class_id = _s.class_id',
      'd.section_subject_id IN (SELECT ss.id FROM public.section_subjects ss WHERE ss.section_id = _s.class_id)');

    IF _new <> _def THEN
      EXECUTE _new;
      _n := _n + 1;
    END IF;
  END LOOP;

  IF _n <> 4 THEN
    RAISE EXCEPTION
      'hotfix: rewrote % function(s), expected 4. The bodies no longer match the patterns in this migration — re-read them rather than proceeding on a stale assumption.', _n;
  END IF;
END
$fix$;


-- ── Assert: no reference survives, and the student path actually runs ──────
DO $after$
DECLARE _left text; _uid uuid; _res jsonb;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _left
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.prosrc ~ '\mis_published\M';
  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'hotfix: is_published still referenced by %', _left;
  END IF;

  -- Behaviour, not catalog: call it as the student whose screen was throwing.
  -- A body that compiles proves nothing here — that was the whole failure mode.
  SELECT id INTO _uid FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _res := public.rpc_student_academic_snapshot();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _res IS NULL THEN
    RAISE EXCEPTION 'hotfix: rpc_student_academic_snapshot returned NULL for a real student.';
  END IF;
END
$after$;

COMMIT;
