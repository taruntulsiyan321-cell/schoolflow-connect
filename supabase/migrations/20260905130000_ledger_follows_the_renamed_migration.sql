-- ═══════════════════════════════════════════════════════════════════════════
-- The ledger follows a renamed migration file
--
-- ── WHY THE FILE WAS RENAMED ─────────────────────────────────────────────
--
-- Two migrations shared the timestamp `20260830160000`:
--
--     20260830160000_chunk95_batch2_restore_five.sql
--     20260830160000_fix_stale_column_refs.sql
--
-- Nothing in the repo declares which runs first. The applied order came from
-- filename sort — `chunk95…` sorts before `fix_stale…` — so a from-zero replay
-- on a runner that sorts differently, or that reads directory order, could
-- apply them the other way round and would be testing a sequence this database
-- has never run.
--
-- `fix_stale_column_refs` is now `20260830160001`, which PRESERVES the applied
-- order and makes it explicit instead of incidental.
--
-- ── WHY THE LEDGER NEEDS A ROW UPDATE ────────────────────────────────────
--
-- `public.schema_migrations` records the filename, so after the rename it named
-- a file that no longer exists. `npm run db:check-migrations` reports nothing
-- pending either way, so this is not a live break — but a ledger entry pointing
-- at a missing file is the kind of small untruth that costs a later session an
-- hour, and a future runner that matches by name could decide the renamed file
-- is unapplied and run it again.
--
-- The migration it names is unchanged. Only the name it is recorded under moves.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $premise$
BEGIN
  -- Refuse if the world is not as described: either already renamed, or the old
  -- row is missing for some other reason worth understanding first.
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations
                  WHERE version = '20260830160000_fix_stale_column_refs') THEN
    IF EXISTS (SELECT 1 FROM public.schema_migrations
                WHERE version = '20260830160001_fix_stale_column_refs') THEN
      RAISE NOTICE 'ledger already carries the renamed version; nothing to do';
    ELSE
      RAISE EXCEPTION
        'ABORT: neither the old nor the new ledger row for fix_stale_column_refs exists. Re-read before proceeding.';
    END IF;
  END IF;

  -- The sibling that keeps 20260830160000 must still be there, or the rename
  -- solved a different problem than the one described above.
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations
                  WHERE version = '20260830160000_chunk95_batch2_restore_five') THEN
    RAISE EXCEPTION
      'ABORT: 20260830160000_chunk95_batch2_restore_five is not in the ledger; the duplicate-timestamp premise does not hold';
  END IF;
END $premise$;

UPDATE public.schema_migrations
   SET version = '20260830160001_fix_stale_column_refs'
 WHERE version = '20260830160000_fix_stale_column_refs';

-- ── Verification ──────────────────────────────────────────────────────────
DO $verify$
DECLARE _dupes int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations
              WHERE version = '20260830160000_fix_stale_column_refs') THEN
    RAISE EXCEPTION 'ABORT: the old ledger row survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations
                  WHERE version = '20260830160001_fix_stale_column_refs') THEN
    RAISE EXCEPTION 'ABORT: the renamed ledger row is absent';
  END IF;

  -- The point of the exercise: no timestamp prefix may be shared by two
  -- entries. This is the assertion, not the rename itself.
  SELECT count(*) INTO _dupes FROM (
    SELECT left(version, 14) AS ts
      FROM public.schema_migrations
     WHERE version ~ '^\d{14}_'
     GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF _dupes <> 0 THEN
    RAISE EXCEPTION 'ABORT: % timestamp prefix(es) are still shared by more than one migration', _dupes;
  END IF;
END $verify$;

COMMIT;
