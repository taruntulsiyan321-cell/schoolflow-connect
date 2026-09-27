-- ROLLBACK 20261113000000 — removes premium payments.
--
-- Refuses while any order has been paid: those are records of money taken,
-- and removing them would lose what each buyer paid for. With no paid order
-- it drops the payment functions and tables and the entitlements' link to
-- orders.

BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.premium_orders WHERE status <> 'created') THEN
    RAISE EXCEPTION 'rollback refused: paid orders exist — export them before removing payments';
  END IF;
END
$guard$;

DROP FUNCTION public.rpc_my_premium_orders();
DROP FUNCTION public.premium_record_verify(text, text, jsonb, jsonb);
DROP FUNCTION public.premium_handle_provider_event(text, text, jsonb);
DROP FUNCTION public.premium_record_refund(text, text, integer, text);
DROP FUNCTION public.premium_fulfil_payment(text, text, integer, text, text, text);
DROP FUNCTION public.premium_attach_provider_order(uuid, text);
DROP FUNCTION public.premium_begin_order(uuid, text, text, boolean);
DROP FUNCTION public._premium_place_order(uuid);

ALTER TABLE public.premium_entitlements DROP CONSTRAINT premium_entitlements_order_fk;
ALTER TABLE public.premium_entitlements DROP COLUMN credit_seconds;

DROP TABLE public.premium_payment_events;
DROP TABLE public.premium_refunds;
DROP TABLE public.premium_orders;

DO $check$
BEGIN
  IF to_regclass('public.premium_orders') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'premium_entitlements' AND column_name = 'credit_seconds') THEN
    RAISE EXCEPTION 'payments were not fully removed';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20261113000000_premium_payments';

COMMIT;
