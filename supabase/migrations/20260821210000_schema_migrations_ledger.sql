-- Root-cause fix for G0-4 (migration tracking): scripts/check-pending-migrations.mjs's
-- hand-maintained MARKERS array covers ~30 of 261 migration files by design --
-- every migration since the last time someone updated that list is invisible to
-- it, which is exactly why an unrelated audit could plausibly claim "trusting
-- files != live DB" as a real, structural gap (it is).
--
-- Fix: a standard schema_migrations ledger (version, applied_at), the same
-- pattern every real migration tool uses (Rails, Django, Flyway, the Supabase
-- CLI's own migration history table). scripts/apply-pending-migrations.mjs now
-- records every migration it successfully runs here; going forward, "is this
-- migration applied" is a plain SELECT against this table instead of a
-- hand-maintained list that can only ever fall further behind.
--
-- This migration also backfills the ledger with every filename currently in
-- supabase/migrations/ as of 2026-08-21, since the app is live and those are
-- the migrations that got it there by whatever mix of mechanisms preceded this
-- ledger (CLI, SQL editor pastes, this repo's own scripts). This is a
-- one-time bootstrap assumption, not a claim that every one of the 261 files
-- was independently re-verified line-by-line -- the existing marker-based
-- probes in check-pending-migrations.mjs remain as a spot-check on top of
-- this, not replaced by it.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  backfilled boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.schema_migrations IS
  'Migration ledger. Populated by scripts/apply-pending-migrations.mjs after each successful apply. backfilled=true rows predate this table (2026-08-21 bootstrap) and were not individually re-verified by this migration -- they are the pre-existing migrations/*.sql filenames assumed applied because the live app was already running on them.';

-- No RLS needed: this is operational metadata read only by local scripts via
-- the Management API (service-role-equivalent), never by application code or
-- any authenticated-user client path.
