-- ROLLBACK 20261114000000 — the plans go back to the codes pro / max and the
-- names Pro / Max (references follow by ON UPDATE CASCADE).

BEGIN;

UPDATE public.premium_products SET code = 'pro_30d', display_name = 'Pro — 30 days' WHERE code = 'standard_30d';
UPDATE public.premium_products SET code = 'max_30d', display_name = 'Max — 30 days' WHERE code = 'premium_30d';
UPDATE public.premium_tiers SET code = 'pro', display_name = 'Pro' WHERE code = 'standard';
UPDATE public.premium_tiers SET code = 'max', display_name = 'Max' WHERE code = 'premium';

DO $check$
BEGIN
  IF (SELECT string_agg(code, ',' ORDER BY rank) FROM public.premium_tiers) IS DISTINCT FROM 'free,starter,pro,max' THEN
    RAISE EXCEPTION 'the plan codes were not restored';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20261114000000_premium_plans_take_their_published_names';

COMMIT;
