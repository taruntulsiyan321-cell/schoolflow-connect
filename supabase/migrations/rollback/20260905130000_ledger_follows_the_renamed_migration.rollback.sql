-- ROLLBACK 20260905130000_ledger_follows_the_renamed_migration — written 2026-09-22; the migration shipped without one.
--
-- Puts the ledger row back under the timestamp it was renamed from. THIS RESTORES THE DUPLICATE: 20260830160000 is
-- then carried by two migrations again (fix_stale_column_refs and chunk95_batch2_restore_five), which is what made
-- timestamp-keyed tools read one of them as missing. The file itself stays 20260830160001_fix_stale_column_refs.sql,
-- so after this the ledger and the tree disagree about its name — the state the forward migration existed to end.
UPDATE public.schema_migrations
   SET version = '20260830160000_fix_stale_column_refs'
 WHERE version = '20260830160001_fix_stale_column_refs';

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '20260830160001_fix_stale_column_refs') THEN
    RAISE EXCEPTION 'rollback: the renamed ledger row is still there';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20260905130000_ledger_follows_the_renamed_migration';
