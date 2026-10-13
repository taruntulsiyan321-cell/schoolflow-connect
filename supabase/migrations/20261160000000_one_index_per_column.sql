-- ═══════════════════════════════════════════════════════════════════════════
-- ONE INDEX PER COLUMN (Supabase performance advisor: duplicate_index)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two tables carried an identical second index, maintained on every write and
-- never needed (measured 2026-10-13; neither backs a constraint):
--   app_settings  app_settings_school_uidx = app_settings_pkey   (school_id)
--   notices       idx_notices_created_at   = notices_created_at_idx (created_at DESC)
-- The primary key and notices_created_at_idx stay.
--
-- ROLLBACK: rollback/20261160000000_one_index_per_column.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP INDEX public.app_settings_school_uidx;
DROP INDEX public.idx_notices_created_at;

DO $proof$
DECLARE _n int;
BEGIN
  -- each column still has exactly one index, and app_settings is still unique on school_id
  SELECT count(*) INTO _n FROM pg_index i
   WHERE i.indrelid = 'public.app_settings'::regclass
     AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (school_id)';
  IF _n <> 1 THEN RAISE EXCEPTION 'VERIFY FAILED: app_settings has % indexes on school_id', _n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'VERIFY FAILED: app_settings lost its primary key';
  END IF;
  SELECT count(*) INTO _n FROM pg_index i
   WHERE i.indrelid = 'public.notices'::regclass
     AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (created_at DESC)';
  IF _n <> 1 THEN RAISE EXCEPTION 'VERIFY FAILED: notices has % indexes on created_at', _n; END IF;
END $proof$;

COMMIT;
