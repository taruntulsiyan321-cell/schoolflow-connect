-- ===========================================================================
-- THE PLANS TAKE THE NAMES THE LANDING PAGE ALREADY PUBLISHES.
--
-- www.gurukul.study has sold nothing yet but already names the individual
-- plans Starter (₹199), Standard (₹499) and Premium (₹999).
-- 20261111000000 called the last two pro and max, which would have put two
-- names on one plan: one in the database, reports and receipts, another on
-- the page a buyer reads. The codes and names become the published ones;
-- nothing else about the plans changes.
--
-- Every reference follows by ON UPDATE CASCADE (limits, products,
-- entitlements, orders). No order or entitlement exists yet.
--
-- ROLLBACK: rollback/20261114000000_premium_plans_take_their_published_names.rollback.sql
-- ===========================================================================

BEGIN;

UPDATE public.premium_tiers SET code = 'standard', display_name = 'Standard' WHERE code = 'pro';
UPDATE public.premium_tiers SET code = 'premium',  display_name = 'Premium'  WHERE code = 'max';

UPDATE public.premium_products SET code = 'standard_30d', display_name = 'Standard — 30 days' WHERE code = 'pro_30d';
UPDATE public.premium_products SET code = 'premium_30d',  display_name = 'Premium — 30 days'  WHERE code = 'max_30d';

DO $check$
DECLARE
  _tiers text;
  _products text;
BEGIN
  SELECT string_agg(code || ':' || display_name || ':' || rank, ',' ORDER BY rank) INTO _tiers FROM public.premium_tiers;
  SELECT string_agg(code || ':' || tier_code || ':' || amount_paise, ',' ORDER BY amount_paise) INTO _products FROM public.premium_products;
  IF _tiers IS DISTINCT FROM 'free:Free:0,starter:Starter:1,standard:Standard:2,premium:Premium:3' THEN
    RAISE EXCEPTION 'tiers are %', _tiers;
  END IF;
  IF _products IS DISTINCT FROM 'starter_30d:starter:19900,standard_30d:standard:49900,premium_30d:premium:99900' THEN
    RAISE EXCEPTION 'products are %', _products;
  END IF;
  -- The limits followed the codes: 26 rows, none left on an old code.
  IF (SELECT count(*) FROM public.premium_limits) <> 26
     OR EXISTS (SELECT 1 FROM public.premium_limits WHERE tier_code IN ('pro', 'max')) THEN
    RAISE EXCEPTION 'the limits did not follow the renamed plans';
  END IF;
  IF (SELECT count(*) FROM public.premium_limits WHERE tier_code = 'premium' AND max_uses IS NULL) <> 6 THEN
    RAISE EXCEPTION 'Premium lost its unlimited features';
  END IF;
END
$check$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261114000000_premium_plans_take_their_published_names')
ON CONFLICT (version) DO NOTHING;

COMMIT;
