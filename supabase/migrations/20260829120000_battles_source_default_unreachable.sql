-- ═══════════════════════════════════════════════════════════════════════════
-- battles.source: a column default its own CHECK constraint rejects
--
-- Found while seeding a battle for CHUNK7B_BATCH2E_VERIFY.
--
--   DEFAULT 'manual'
--   CHECK (source = ANY (ARRAY['bank','challenge','class','custom',
--          'featured_daily','featured_ncert','featured_weekly',
--          'mistake_book','open','quick','solo']))
--
-- 'manual' is not in that list, so ANY insert into battles that does not name
-- a source fails — and fails with a CHECK violation naming a value the caller
-- never supplied, which reads as a data problem rather than a schema one.
--
-- LATENT, not live, and the check that establishes that is worth recording:
-- all seven functions that insert into battles set source explicitly
-- (_seed_featured_battle_for_class, rpc_challenge_student,
-- rpc_create_class_battle, rpc_create_open_battle, rpc_create_quick_battle,
-- rpc_create_template_solo_battle, rpc_ensure_featured_battle), no client code
-- inserts into the table at all, and zero existing rows carry 'manual'. So
-- nothing is broken today; the next insert path that forgets is.
--
-- The default is DROPPED rather than changed to a valid member. Every real
-- caller already chooses a source deliberately, and there is no honest neutral
-- value to pick — 'custom' would be a guess recorded as fact. With NOT NULL
-- and no default, a forgetful caller now fails on "null value in column
-- source", which says exactly what went wrong.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  -- Refuse to run if the premise no longer holds.
  IF EXISTS (SELECT 1 FROM public.battles WHERE source = 'manual') THEN
    RAISE EXCEPTION 'battles rows carry source=''manual'', which the CHECK rejects — repair the data before dropping the default.';
  END IF;
END
$guard$;

ALTER TABLE public.battles ALTER COLUMN source DROP DEFAULT;

DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='battles'
       AND column_name='source' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'battles.source still has a default.';
  END IF;
END
$assert$;

COMMIT;
