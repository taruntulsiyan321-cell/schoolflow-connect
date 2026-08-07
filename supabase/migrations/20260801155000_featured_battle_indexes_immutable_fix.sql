-- Migration 20260801160000_battleground_defect_fixes.sql creates three partial
-- unique indexes on public.battles using ((starts_at)::date) and
-- date_trunc('week', starts_at) — both invalid as index expressions because
-- casting/truncating a timestamptz depends on the session timezone, so
-- Postgres rejects them as "functions in index expression must be marked
-- IMMUTABLE". This is true on any database, not environment-specific.
-- Creating the same three indexes here first, with the value pinned to UTC
-- (AT TIME ZONE 'UTC' makes the expression IMMUTABLE), so 20260801160000's
-- own CREATE UNIQUE INDEX IF NOT EXISTS statements find these names already
-- present and skip as safe no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_daily_class_day
  ON public.battles (class_id, ((starts_at AT TIME ZONE 'UTC')::date))
  WHERE source = 'featured_daily' AND status IN ('live', 'scheduled') AND class_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_weekly_class_week
  ON public.battles (class_id, (date_trunc('week', starts_at AT TIME ZONE 'UTC')))
  WHERE source = 'featured_weekly' AND status IN ('live', 'scheduled') AND class_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_ncert_class_day
  ON public.battles (class_id, ((starts_at AT TIME ZONE 'UTC')::date))
  WHERE source = 'featured_ncert' AND status IN ('live', 'scheduled') AND class_id IS NOT NULL;
