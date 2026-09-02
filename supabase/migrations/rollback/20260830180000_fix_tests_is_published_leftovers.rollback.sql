-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — tests is_published leftovers
-- Undoes 20260830180000_fix_tests_is_published_leftovers.sql
--
-- ⚠ Rolling this back RE-BREAKS four live functions. The migration it undoes
-- was a hotfix: Chunk 7.5c repointed the Tests feature from `dpps` onto
-- `tests` and left column references behind, so four functions referenced
-- columns that do not exist and threw at execution — including
-- rpc_student_academic_snapshot, which threw on every student page load.
-- Restoring the prior bodies restores that outage.
--
-- ── Why this one IS invertible, when 20260901100000 is not ────────────────
--
-- Both migrations rewrite through pg_get_functiondef. The difference is what
-- they do with the text. This migration's five substitutions are all
-- text-for-text, so each has an exact inverse and applying the inverses to the
-- CURRENT body reverts this change alone — every later fix to these functions
-- survives untouched. 20260901100000 deletes text instead, and a deletion has
-- no inverse: see that file's rollback.
--
-- ── The inverses, in the order they must run ──────────────────────────────
--
-- Order is not cosmetic. The read-restores put the literal `status =
-- 'published'` back into the body, so the write-restore — which keys off
-- `status = 'published',` — has to run FIRST or it would also match text the
-- read-restores had just produced and insert is_published in the wrong places.
--
--   1  status = 'published',              ->  ... , is_published = true,   (write)
--   2  dp.status = 'published'            ->  dp.is_published             (read)
--   3  d.status = 'published'             ->  d.is_published              (read)
--   4  d.section_subject_id IN (...)      ->  d.class_id = _s.class_id
--
-- Note 2 and 3 cannot collide: the substring `d.status` does not occur inside
-- `dp.status`, because there the `d` is followed by `p`.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Prove the fix is actually in place before reverting it ────────────────
-- If nothing references the post-fix shape, this file has nothing to undo and
-- the after-check would pass vacuously.
DO $before$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname IN ('publish_due_scheduled_homework', 'rpc_leaderboard',
                       'rpc_principal_school_health', 'rpc_student_academic_snapshot');
  IF _n <> 4 THEN
    RAISE EXCEPTION
      'rollback: expected the 4 rewritten functions, found %. The list is stale — re-read the bodies rather than reverting on an assumption.', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ '\mis_published\M';
  IF _n <> 0 THEN
    RAISE EXCEPTION
      'rollback: % function(s) already reference is_published, so the forward migration is not cleanly in place.', _n;
  END IF;
END
$before$;


DO $revert$
DECLARE r record; _def text; _new text; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('publish_due_scheduled_homework', 'rpc_leaderboard',
                         'rpc_principal_school_health', 'rpc_student_academic_snapshot')
     ORDER BY p.proname
  LOOP
    _def := pg_get_functiondef(r.oid);
    _new := _def;

    -- 1. The write, first — see the ordering note in the header.
    IF r.proname = 'publish_due_scheduled_homework' THEN
      _new := replace(_new, E'status = ''published'',', E'status = ''published'',\n      is_published = true,');
    END IF;

    -- 2 and 3. The reads, alias by alias.
    _new := replace(_new, 'dp.status = ''published''', 'dp.is_published');
    _new := replace(_new, 'd.status = ''published''',  'd.is_published');

    -- 4. tests reaches a section through section_subjects; dpps had class_id.
    _new := replace(_new,
      'd.section_subject_id IN (SELECT ss.id FROM public.section_subjects ss WHERE ss.section_id = _s.class_id)',
      'd.class_id = _s.class_id');

    IF _new <> _def THEN
      EXECUTE _new;
      _n := _n + 1;
    END IF;
  END LOOP;

  IF _n <> 4 THEN
    RAISE EXCEPTION
      'rollback: reverted % function(s), expected 4. The bodies no longer match the patterns this file inverts.', _n;
  END IF;
END
$revert$;


-- ── Assert the revert took, by outcome ────────────────────────────────────
-- The forward migration asserted that NO function references is_published.
-- The exact mirror of that is the right check here.
DO $after$
DECLARE _n int; _names text;
BEGIN
  SELECT count(*), string_agg(p.proname, ', ') INTO _n, _names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ '\mis_published\M';

  IF _n <> 4 THEN
    RAISE EXCEPTION
      'rollback: % function(s) reference is_published after the revert, expected 4 (%).', _n, COALESCE(_names, 'none');
  END IF;

  -- No behavioural call here, deliberately. These bodies are broken by design
  -- once reverted — calling rpc_student_academic_snapshot would throw, which is
  -- the state being restored, not a failure of this file.
  RAISE NOTICE 'rollback complete: 4 function(s) reference is_published again and WILL throw at execution.';
END
$after$;

COMMIT;
