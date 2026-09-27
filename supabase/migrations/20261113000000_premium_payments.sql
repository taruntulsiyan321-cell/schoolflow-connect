-- ===========================================================================
-- PREMIUM PAYMENTS — an order, a captured payment, and exactly one plan for it.
--
-- Razorpay (docs read 2026-09-27): the server creates an Order for an amount;
-- Checkout collects the payment; the payment is captured (automatically, by
-- the account's capture setting); a plan is delivered ONLY after capture —
-- Razorpay refunds uncaptured payments on its own. Webhooks can arrive more
-- than once and are told apart by x-razorpay-event-id.
--
-- What this migration guarantees, and where:
--
--   * THE AMOUNT IS THE SERVER'S. premium_begin_order copies the product's
--     price, validity and plan into the order; the edge function creates the
--     Razorpay order for exactly that amount; premium_fulfil_payment refuses a
--     payment whose amount or currency is not the order's.
--   * ONE PLAN PER PAYMENT. The order row is locked, the account is locked,
--     razorpay_payment_id is unique, and a second call for the same payment
--     returns the plan it already made.
--   * A WEBHOOK IS HANDLED ONCE. premium_handle_provider_event records the
--     event id and acts on it in ONE transaction: if acting fails, the event
--     is not recorded either, the webhook answers 500, and Razorpay retries.
--   * NOTHING IS SOLD UNDER TERMS THAT DO NOT EXIST. premium_begin_order
--     refuses while sales are off, and records the terms version the buyer
--     accepted, when, and their confirmation that they are 18 or older or
--     that their parent or guardian is paying.
--   * A PURCHASE IS NEVER WASTED. The same plan again starts when the current
--     one ends. A higher plan starts now, and the unused value of a paid lower
--     plan is converted into extra days of it. A lower plan cannot be bought
--     while a higher one is running (and, if two tabs race, it waits for it).
--   * A FULL REFUND ENDS THE PLAN. A partial refund is recorded and left to
--     the owner.
--
-- Money records keep account_id without a foreign key to auth.users, like
-- premium_entitlements: deleting a user never deletes what they paid.
--
-- ROLLBACK: rollback/20261113000000_premium_payments.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.premium_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL,
  product_code        text NOT NULL REFERENCES public.premium_products(code) ON UPDATE CASCADE,
  -- What was sold, copied from the product when the order was made.
  tier_code           text NOT NULL REFERENCES public.premium_tiers(code) ON UPDATE CASCADE,
  amount_paise        integer NOT NULL CHECK (amount_paise > 0),
  currency            text NOT NULL CHECK (currency = 'INR'),
  validity_days       integer NOT NULL CHECK (validity_days BETWEEN 1 AND 400),
  -- Consent, as given.
  terms_version       text NOT NULL CHECK (btrim(terms_version) <> ''),
  accepted_terms_at   timestamptz NOT NULL,
  guardian_confirmed  boolean NOT NULL CHECK (guardian_confirmed),
  -- The provider's side.
  razorpay_order_id   text UNIQUE CHECK (razorpay_order_id IS NULL OR razorpay_order_id ~ '^order_[A-Za-z0-9]+$'),
  razorpay_payment_id text UNIQUE CHECK (razorpay_payment_id IS NULL OR razorpay_payment_id ~ '^pay_[A-Za-z0-9]+$'),
  payment_method      text,
  status              text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'refunded')),
  paid_at             timestamptz,
  entitlement_id      uuid UNIQUE REFERENCES public.premium_entitlements(id),
  refunded_paise      integer NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT premium_orders_paid_is_complete CHECK (
    (status = 'created') = (paid_at IS NULL)
    AND (status = 'created') = (razorpay_payment_id IS NULL)
    AND (status = 'created') = (entitlement_id IS NULL)),
  CONSTRAINT premium_orders_refund_within_amount CHECK (refunded_paise <= amount_paise),
  CONSTRAINT premium_orders_refunded_is_full CHECK ((status = 'refunded') = (refunded_paise = amount_paise AND paid_at IS NOT NULL))
);
CREATE INDEX premium_orders_account_idx ON public.premium_orders (account_id, created_at DESC);
COMMENT ON TABLE public.premium_orders IS
  'One attempt to buy a plan. Amount, plan and validity are copied from the product when it is made; paid only after Razorpay captured exactly that amount.';

ALTER TABLE public.premium_entitlements
  ADD CONSTRAINT premium_entitlements_order_fk FOREIGN KEY (order_id) REFERENCES public.premium_orders(id);
ALTER TABLE public.premium_entitlements
  ADD COLUMN credit_seconds bigint NOT NULL DEFAULT 0 CHECK (credit_seconds >= 0);
COMMENT ON COLUMN public.premium_entitlements.credit_seconds IS
  'Extra time included because the unused value of a lower paid plan was converted into this one.';

CREATE TABLE public.premium_refunds (
  razorpay_refund_id text PRIMARY KEY CHECK (razorpay_refund_id ~ '^rfnd_[A-Za-z0-9]+$'),
  order_id           uuid NOT NULL REFERENCES public.premium_orders(id),
  amount_paise       integer NOT NULL CHECK (amount_paise > 0),
  status             text NOT NULL CHECK (status IN ('created', 'processed', 'failed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Everything the provider told us, and everything we did about it. Appended,
-- never edited by a client.
CREATE TABLE public.premium_payment_events (
  id                  bigserial PRIMARY KEY,
  provider_event_id   text UNIQUE,
  source              text NOT NULL CHECK (source IN ('webhook', 'verify')),
  event_type          text NOT NULL,
  razorpay_order_id   text,
  razorpay_payment_id text,
  payload             jsonb NOT NULL,
  outcome             jsonb,
  received_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT premium_payment_events_webhook_has_id CHECK (source <> 'webhook' OR provider_event_id IS NOT NULL)
);
CREATE INDEX premium_payment_events_order_idx ON public.premium_payment_events (razorpay_order_id);

ALTER TABLE public.premium_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_refunds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.premium_orders, public.premium_refunds, public.premium_payment_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.premium_payment_events_id_seq FROM PUBLIC, anon, authenticated;
-- A buyer reads their own orders (receipts); nothing else, and writes nothing.
GRANT SELECT ON public.premium_orders TO authenticated;
CREATE POLICY premium_orders_own ON public.premium_orders FOR SELECT TO authenticated
  USING (account_id = (SELECT auth.uid()));

-- ── Placing a plan ──────────────────────────────────────────────────────────

-- Makes the entitlement a paid order buys, and returns its id. Called only by
-- premium_fulfil_payment, with the account already locked.
CREATE FUNCTION public._premium_place_order(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _o        public.premium_orders;
  _rank     smallint;
  _now      timestamptz := now();
  _start    timestamptz;
  _covered  timestamptz;
  _validity numeric;
  _credit   numeric := 0;
  _e        record;
  _id       uuid;
BEGIN
  SELECT * INTO _o FROM public.premium_orders WHERE id = _order_id;
  SELECT t.rank INTO _rank FROM public.premium_tiers t WHERE t.code = _o.tier_code;
  _validity := _o.validity_days::numeric * 86400;

  -- Time already covered at this plan or better: the purchase starts when it ends.
  SELECT max(e.ends_at) INTO _covered
    FROM public.premium_entitlements e
    JOIN public.premium_tiers t ON t.code = e.tier_code
   WHERE e.account_id = _o.account_id AND e.revoked_at IS NULL AND e.ends_at > _now AND t.rank >= _rank;

  IF _covered IS NOT NULL THEN
    _start := _covered;
  ELSE
    -- An upgrade: it starts now, and every paid lower plan still running or
    -- waiting is converted — its unused share of what was paid for it becomes
    -- extra time on this one, at this plan's price per second.
    _start := _now;
    FOR _e IN
      SELECT e.id, e.starts_at, e.ends_at, po.amount_paise AS paid
        FROM public.premium_entitlements e
        JOIN public.premium_tiers t ON t.code = e.tier_code
        JOIN public.premium_orders po ON po.id = e.order_id
       WHERE e.account_id = _o.account_id AND e.revoked_at IS NULL AND e.ends_at > _now
         AND t.rank < _rank AND e.source = 'payment'
       FOR UPDATE OF e
    LOOP
      _credit := _credit
        + (_e.paid::numeric
           * extract(epoch FROM (_e.ends_at - greatest(_e.starts_at, _now)))
           / extract(epoch FROM (_e.ends_at - _e.starts_at)))
        * (_validity / _o.amount_paise);
      UPDATE public.premium_entitlements
         SET revoked_at = _now, revoke_reason = 'converted into the upgrade paid by order ' || _o.id
       WHERE id = _e.id;
    END LOOP;
  END IF;

  INSERT INTO public.premium_entitlements
    (account_id, tier_code, starts_at, ends_at, source, order_id, credit_seconds)
  VALUES
    (_o.account_id, _o.tier_code, _start,
     _start + make_interval(secs => _validity + floor(_credit)),
     'payment', _o.id, floor(_credit)::bigint)
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

-- ── Beginning an order (checkout) ───────────────────────────────────────────

-- Makes the order a buyer is about to pay for. Refuses, with a reason the app
-- can show, anything that should not be sold.
CREATE FUNCTION public.premium_begin_order(_account uuid, _product text, _terms_version text, _guardian_confirmed boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s     public.premium_settings;
  _p     public.premium_products;
  _rank  smallint;
  _top   text;
  _id    uuid;
BEGIN
  SELECT * INTO _s FROM public.premium_settings;
  IF NOT _s.sales_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_closed');
  END IF;
  IF NOT public._premium_is_individual(_account) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_an_individual_account');
  END IF;
  IF _terms_version IS DISTINCT FROM _s.terms_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'terms_not_accepted', 'terms_version', _s.terms_version);
  END IF;
  IF _guardian_confirmed IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'guardian_not_confirmed');
  END IF;
  SELECT * INTO _p FROM public.premium_products WHERE code = _product AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_product');
  END IF;

  SELECT t.rank INTO _rank FROM public.premium_tiers t WHERE t.code = _p.tier_code;
  _top := public._premium_tier(_account);
  IF (SELECT t.rank FROM public.premium_tiers t WHERE t.code = _top) > _rank THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lower_plan_while_higher_active', 'tier', _top);
  END IF;

  INSERT INTO public.premium_orders
    (account_id, product_code, tier_code, amount_paise, currency, validity_days,
     terms_version, accepted_terms_at, guardian_confirmed)
  VALUES
    (_account, _p.code, _p.tier_code, _p.amount_paise, _p.currency, _p.validity_days,
     _terms_version, now(), true)
  RETURNING id INTO _id;

  RETURN jsonb_build_object(
    'ok', true, 'order_id', _id, 'amount_paise', _p.amount_paise, 'currency', _p.currency,
    'tier', _p.tier_code, 'validity_days', _p.validity_days, 'display_name', _p.display_name);
END;
$function$;

-- Records the Razorpay order made for one of ours. Once only.
CREATE FUNCTION public.premium_attach_provider_order(_order_id uuid, _razorpay_order_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH u AS (
    UPDATE public.premium_orders
       SET razorpay_order_id = _razorpay_order_id
     WHERE id = _order_id AND razorpay_order_id IS NULL AND status = 'created'
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$function$;

-- ── Fulfilling a captured payment ───────────────────────────────────────────

CREATE FUNCTION public.premium_fulfil_payment(
  _razorpay_order_id text, _razorpay_payment_id text, _amount_paise integer, _currency text,
  _status text, _method text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _o   public.premium_orders;
  _ent public.premium_entitlements;
  _eid uuid;
BEGIN
  -- Deliver only after capture (Razorpay refunds what is never captured).
  IF _status IS DISTINCT FROM 'captured' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captured', 'status', _status);
  END IF;

  SELECT * INTO _o FROM public.premium_orders WHERE razorpay_order_id = _razorpay_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_order');
  END IF;
  -- One placement at a time per account, so two purchases never both start
  -- at the same end.
  PERFORM pg_advisory_xact_lock(hashtext('premium:' || _o.account_id::text));

  IF _o.status <> 'created' THEN
    IF _o.razorpay_payment_id = _razorpay_payment_id THEN
      SELECT * INTO _ent FROM public.premium_entitlements WHERE id = _o.entitlement_id;
      RETURN jsonb_build_object('ok', true, 'already', true, 'order_id', _o.id,
        'tier', _ent.tier_code, 'starts_at', _ent.starts_at, 'ends_at', _ent.ends_at);
    END IF;
    -- A second payment for an order already paid: nothing is granted; the
    -- owner refunds it.
    RETURN jsonb_build_object('ok', false, 'reason', 'order_already_paid', 'order_id', _o.id);
  END IF;

  IF _amount_paise IS DISTINCT FROM _o.amount_paise OR _currency IS DISTINCT FROM _o.currency THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'order_id', _o.id,
      'expected', _o.amount_paise, 'got', _amount_paise, 'currency', _currency);
  END IF;

  _eid := public._premium_place_order(_o.id);
  UPDATE public.premium_orders
     SET status = 'paid', paid_at = now(), razorpay_payment_id = _razorpay_payment_id,
         payment_method = _method, entitlement_id = _eid
   WHERE id = _o.id;

  SELECT * INTO _ent FROM public.premium_entitlements WHERE id = _eid;
  RETURN jsonb_build_object('ok', true, 'already', false, 'order_id', _o.id,
    'tier', _ent.tier_code, 'starts_at', _ent.starts_at, 'ends_at', _ent.ends_at,
    'credit_seconds', _ent.credit_seconds);
END;
$function$;

-- ── Refunds ─────────────────────────────────────────────────────────────────

CREATE FUNCTION public.premium_record_refund(_razorpay_payment_id text, _razorpay_refund_id text, _amount_paise integer, _status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _o        public.premium_orders;
  _refunded integer;
BEGIN
  SELECT * INTO _o FROM public.premium_orders WHERE razorpay_payment_id = _razorpay_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_payment');
  END IF;

  INSERT INTO public.premium_refunds (razorpay_refund_id, order_id, amount_paise, status)
  VALUES (_razorpay_refund_id, _o.id, _amount_paise, _status)
  ON CONFLICT (razorpay_refund_id) DO UPDATE
    SET status = EXCLUDED.status, amount_paise = EXCLUDED.amount_paise, updated_at = now()
  WHERE premium_refunds.order_id = EXCLUDED.order_id;

  SELECT COALESCE(sum(r.amount_paise), 0)::int INTO _refunded
    FROM public.premium_refunds r WHERE r.order_id = _o.id AND r.status = 'processed';
  _refunded := LEAST(_refunded, _o.amount_paise);

  UPDATE public.premium_orders
     SET refunded_paise = _refunded,
         status = CASE WHEN _refunded = amount_paise THEN 'refunded' ELSE status END
   WHERE id = _o.id;

  IF _refunded = _o.amount_paise THEN
    UPDATE public.premium_entitlements
       SET revoked_at = now(), revoke_reason = 'refunded (' || _razorpay_refund_id || ')'
     WHERE id = _o.entitlement_id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', _o.id, 'refunded_paise', _refunded,
    'full', _refunded = _o.amount_paise);
END;
$function$;

-- ── A webhook, handled once ─────────────────────────────────────────────────

-- The edge function has already checked X-Razorpay-Signature over the raw
-- body. This records the event and acts on it in one transaction.
CREATE FUNCTION public.premium_handle_provider_event(_event_id text, _event_type text, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row     bigint;
  _pay     jsonb := _payload #> '{payload,payment,entity}';
  _refund  jsonb := _payload #> '{payload,refund,entity}';
  _outcome jsonb;
BEGIN
  IF _event_id IS NULL OR btrim(_event_id) = '' THEN
    RAISE EXCEPTION 'premium: a webhook without an event id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.premium_payment_events
    (provider_event_id, source, event_type, razorpay_order_id, razorpay_payment_id, payload)
  VALUES
    (_event_id, 'webhook', _event_type, _pay->>'order_id', COALESCE(_pay->>'id', _refund->>'payment_id'), _payload)
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO _row;
  IF _row IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  _outcome := CASE
    WHEN _event_type IN ('payment.captured', 'order.paid') AND _pay IS NOT NULL THEN
      public.premium_fulfil_payment(_pay->>'order_id', _pay->>'id', (_pay->>'amount')::int,
                                    _pay->>'currency', _pay->>'status', _pay->>'method')
    WHEN _event_type IN ('refund.created', 'refund.processed', 'refund.failed') AND _refund IS NOT NULL THEN
      public.premium_record_refund(_refund->>'payment_id', _refund->>'id', (_refund->>'amount')::int,
                                   CASE _event_type WHEN 'refund.created' THEN 'created'
                                                    WHEN 'refund.processed' THEN 'processed'
                                                    ELSE 'failed' END)
    ELSE jsonb_build_object('ok', true, 'recorded_only', true)
  END;

  UPDATE public.premium_payment_events SET outcome = _outcome WHERE id = _row;
  RETURN _outcome;
END;
$function$;

-- The verify endpoint's record of what it saw and did.
CREATE FUNCTION public.premium_record_verify(_razorpay_order_id text, _razorpay_payment_id text, _payload jsonb, _outcome jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.premium_payment_events
    (source, event_type, razorpay_order_id, razorpay_payment_id, payload, outcome)
  VALUES ('verify', 'verify', _razorpay_order_id, _razorpay_payment_id, _payload, _outcome)
$function$;

-- ── For the app: receipts ───────────────────────────────────────────────────

CREATE FUNCTION public.rpc_my_premium_orders()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_id', o.id, 'product', o.product_code, 'tier', o.tier_code,
           'amount_paise', o.amount_paise, 'currency', o.currency, 'validity_days', o.validity_days,
           'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at,
           'razorpay_order_id', o.razorpay_order_id, 'razorpay_payment_id', o.razorpay_payment_id,
           'payment_method', o.payment_method, 'refunded_paise', o.refunded_paise,
           'terms_version', o.terms_version,
           'starts_at', e.starts_at, 'ends_at', e.ends_at, 'credit_seconds', e.credit_seconds,
           'revoked_at', e.revoked_at, 'revoke_reason', e.revoke_reason)
         ORDER BY o.created_at DESC), '[]'::jsonb)
    FROM public.premium_orders o
    LEFT JOIN public.premium_entitlements e ON e.id = o.entitlement_id
   WHERE o.account_id = auth.uid()
     AND (o.status <> 'created' OR o.created_at > now() - interval '1 day')
$function$;

REVOKE ALL ON FUNCTION public._premium_place_order(uuid)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_begin_order(uuid, text, text, boolean)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_attach_provider_order(uuid, text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_fulfil_payment(text, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_record_refund(text, text, integer, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_handle_provider_event(text, text, jsonb)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_record_verify(text, text, jsonb, jsonb)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_my_premium_orders()                                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.premium_begin_order(uuid, text, text, boolean)               TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_attach_provider_order(uuid, text)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_fulfil_payment(text, text, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_record_refund(text, text, integer, text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_handle_provider_event(text, text, jsonb)             TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_record_verify(text, text, jsonb, jsonb)              TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_my_premium_orders()                                      TO authenticated;

-- ── Proof (rolled back; every check can fail) ───────────────────────────────
DO $proof$
DECLARE
  _a     uuid;
  _r     jsonb;
  _o1    uuid;
  _o2    uuid;
  _o3    uuid;
  _e1    public.premium_entitlements;
  _e2    public.premium_entitlements;
  _e3    public.premium_entitlements;
  _msg   text;
  _exp   numeric;
BEGIN
  SELECT ea.account_id INTO _a
    FROM public.exam_accounts ea JOIN public.competitive_exams ce ON ce.id = ea.exam_id
   WHERE ce.code = 'cuet' ORDER BY ea.created_at LIMIT 1;
  IF _a IS NULL THEN RAISE EXCEPTION 'no CUET account to prove payments with'; END IF;

  BEGIN
    -- 0. Closed: nothing can be bought.
    _r := public.premium_begin_order(_a, 'starter_30d', 'v-proof', true);
    IF _r->>'reason' IS DISTINCT FROM 'sales_closed' THEN RAISE EXCEPTION 'sold while sales are closed: %', _r; END IF;

    UPDATE public.premium_settings SET sales_enabled = true, terms_version = 'v-proof';

    -- 1. Consent is required, exactly.
    IF public.premium_begin_order(_a, 'starter_30d', 'v-old', true)->>'reason' IS DISTINCT FROM 'terms_not_accepted' THEN
      RAISE EXCEPTION 'sold under terms that are not current';
    END IF;
    IF public.premium_begin_order(_a, 'starter_30d', 'v-proof', false)->>'reason' IS DISTINCT FROM 'guardian_not_confirmed' THEN
      RAISE EXCEPTION 'sold without the 18+/guardian confirmation';
    END IF;
    IF public.premium_begin_order('d1000003-0001-4000-8000-000000000001', 'starter_30d', 'v-proof', true)->>'reason'
       IS DISTINCT FROM 'not_an_individual_account' THEN
      RAISE EXCEPTION 'sold to a school student';
    END IF;

    -- 2. A Starter order, paid.
    _r := public.premium_begin_order(_a, 'starter_30d', 'v-proof', true);
    IF (_r->>'ok')::boolean IS NOT TRUE OR (_r->>'amount_paise')::int IS DISTINCT FROM 19900 THEN RAISE EXCEPTION 'begin: %', _r; END IF;
    _o1 := (_r->>'order_id')::uuid;
    IF public.premium_attach_provider_order(_o1, 'order_PROOF1') IS NOT TRUE THEN RAISE EXCEPTION 'attach failed'; END IF;
    IF public.premium_attach_provider_order(_o1, 'order_PROOF1b') IS NOT FALSE THEN RAISE EXCEPTION 'attached twice'; END IF;

    IF public.premium_fulfil_payment('order_PROOF1', 'pay_PROOF1', 19900, 'INR', 'authorized', 'upi')->>'reason'
       IS DISTINCT FROM 'not_captured' THEN RAISE EXCEPTION 'granted before capture'; END IF;
    IF public.premium_fulfil_payment('order_PROOF1', 'pay_PROOF1', 100, 'INR', 'captured', 'upi')->>'reason'
       IS DISTINCT FROM 'amount_mismatch' THEN RAISE EXCEPTION 'granted for the wrong amount'; END IF;
    IF public.premium_fulfil_payment('order_PROOFX', 'pay_PROOF1', 19900, 'INR', 'captured', 'upi')->>'reason'
       IS DISTINCT FROM 'unknown_order' THEN RAISE EXCEPTION 'granted for an order that is not ours'; END IF;

    _r := public.premium_fulfil_payment('order_PROOF1', 'pay_PROOF1', 19900, 'INR', 'captured', 'upi');
    IF (_r->>'ok')::boolean IS NOT TRUE OR (_r->>'already')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'fulfil: %', _r; END IF;
    SELECT e.* INTO _e1 FROM public.premium_entitlements e JOIN public.premium_orders o ON o.entitlement_id = e.id WHERE o.id = _o1;
    IF _e1.tier_code <> 'starter' OR abs(extract(epoch FROM (_e1.ends_at - _e1.starts_at)) - 30 * 86400) > 1
       OR abs(extract(epoch FROM (_e1.starts_at - now()))) > 1 THEN
      RAISE EXCEPTION 'the first plan is not 30 days of Starter from now';
    END IF;
    IF public._premium_tier(_a) <> 'starter' THEN RAISE EXCEPTION 'the account is not Starter after paying'; END IF;

    -- 3. The same payment again changes nothing; another payment for it grants nothing.
    _r := public.premium_fulfil_payment('order_PROOF1', 'pay_PROOF1', 19900, 'INR', 'captured', 'upi');
    IF (_r->>'already')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'a repeat grant: %', _r; END IF;
    IF public.premium_fulfil_payment('order_PROOF1', 'pay_PROOF2', 19900, 'INR', 'captured', 'upi')->>'reason'
       IS DISTINCT FROM 'order_already_paid' THEN RAISE EXCEPTION 'a second payment granted a second plan'; END IF;
    IF (SELECT count(*) FROM public.premium_entitlements WHERE account_id = _a) <> 1 THEN
      RAISE EXCEPTION 'more than one plan for one payment';
    END IF;

    -- 4. Starter again, through a webhook: it waits for the first to end. The
    --    same event again is recognised and changes nothing.
    _o2 := (public.premium_begin_order(_a, 'starter_30d', 'v-proof', true)->>'order_id')::uuid;
    PERFORM public.premium_attach_provider_order(_o2, 'order_PROOF2');
    _r := public.premium_handle_provider_event('evt_PROOF2', 'payment.captured', jsonb_build_object('payload', jsonb_build_object(
            'payment', jsonb_build_object('entity', jsonb_build_object(
              'id', 'pay_PROOF3', 'order_id', 'order_PROOF2', 'amount', 19900, 'currency', 'INR', 'status', 'captured', 'method', 'card')))));
    IF (_r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'webhook fulfil: %', _r; END IF;
    _r := public.premium_handle_provider_event('evt_PROOF2', 'payment.captured', jsonb_build_object('payload', jsonb_build_object(
            'payment', jsonb_build_object('entity', jsonb_build_object(
              'id', 'pay_PROOF3', 'order_id', 'order_PROOF2', 'amount', 19900, 'currency', 'INR', 'status', 'captured', 'method', 'card')))));
    IF (_r->>'duplicate')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'a duplicate webhook was acted on: %', _r; END IF;
    SELECT e.* INTO _e2 FROM public.premium_entitlements e JOIN public.premium_orders o ON o.entitlement_id = e.id WHERE o.id = _o2;
    IF _e2.starts_at <> _e1.ends_at THEN RAISE EXCEPTION 'a second Starter did not start when the first ends'; END IF;

    -- 5. Upgrade to Pro: starts now; both Starters are converted into extra days.
    _o3 := (public.premium_begin_order(_a, 'pro_30d', 'v-proof', true)->>'order_id')::uuid;
    PERFORM public.premium_attach_provider_order(_o3, 'order_PROOF3');
    _r := public.premium_fulfil_payment('order_PROOF3', 'pay_PROOF4', 49900, 'INR', 'captured', 'netbanking');
    SELECT e.* INTO _e3 FROM public.premium_entitlements e JOIN public.premium_orders o ON o.entitlement_id = e.id WHERE o.id = _o3;
    -- Unused value: the live Starter almost all of 19900, the waiting one all of it.
    _exp := (19900 + 19900) * (30 * 86400.0 / 49900);
    IF _e3.tier_code <> 'pro' OR abs(extract(epoch FROM (_e3.starts_at - now()))) > 1
       OR abs(_e3.credit_seconds - _exp) > 5
       OR abs(extract(epoch FROM (_e3.ends_at - _e3.starts_at)) - (30 * 86400 + _e3.credit_seconds)) > 1 THEN
      RAISE EXCEPTION 'upgrade: pro from % to %, credit % (expected ~%)', _e3.starts_at, _e3.ends_at, _e3.credit_seconds, round(_exp);
    END IF;
    IF EXISTS (SELECT 1 FROM public.premium_entitlements WHERE id IN (_e1.id, _e2.id) AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'a converted Starter still counts';
    END IF;
    IF public._premium_tier(_a) <> 'pro' THEN RAISE EXCEPTION 'the account is not Pro after upgrading'; END IF;

    -- 6. A lower plan cannot be bought while a higher one runs.
    IF public.premium_begin_order(_a, 'starter_30d', 'v-proof', true)->>'reason'
       IS DISTINCT FROM 'lower_plan_while_higher_active' THEN
      RAISE EXCEPTION 'sold Starter over a running Pro';
    END IF;

    -- 7. A partial refund is recorded; a full one ends the plan.
    _r := public.premium_handle_provider_event('evt_PROOF4', 'refund.processed', jsonb_build_object('payload', jsonb_build_object(
            'refund', jsonb_build_object('entity', jsonb_build_object('id', 'rfnd_PROOF1', 'payment_id', 'pay_PROOF4', 'amount', 10000, 'currency', 'INR')))));
    IF (_r->>'full')::boolean IS NOT FALSE OR public._premium_tier(_a) <> 'pro' THEN RAISE EXCEPTION 'a partial refund ended the plan: %', _r; END IF;
    _r := public.premium_handle_provider_event('evt_PROOF5', 'refund.processed', jsonb_build_object('payload', jsonb_build_object(
            'refund', jsonb_build_object('entity', jsonb_build_object('id', 'rfnd_PROOF2', 'payment_id', 'pay_PROOF4', 'amount', 39900, 'currency', 'INR')))));
    IF (_r->>'full')::boolean IS NOT TRUE OR (SELECT status FROM public.premium_orders WHERE id = _o3) <> 'refunded'
       OR public._premium_tier(_a) = 'pro' THEN
      RAISE EXCEPTION 'a full refund did not end the plan: %', _r;
    END IF;

    -- 8. Unknown events are recorded and harmless; a webhook without an id is refused.
    _r := public.premium_handle_provider_event('evt_PROOF6', 'payment.failed', '{"payload":{}}'::jsonb);
    IF (_r->>'recorded_only')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'a failed payment was acted on'; END IF;

    -- 9. The buyer sees their own orders; no client can write or act.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _r := public.rpc_my_premium_orders();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF jsonb_array_length(_r) <> 3 THEN RAISE EXCEPTION 'receipts: expected 3 orders, got %', jsonb_array_length(_r); END IF;
    IF has_function_privilege('authenticated', 'public.premium_fulfil_payment(text,text,integer,text,text,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.premium_begin_order(uuid,text,text,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.premium_handle_provider_event(text,text,jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.premium_record_refund(text,text,integer,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.rpc_my_premium_orders()', 'EXECUTE')
       OR has_table_privilege('authenticated', 'public.premium_orders', 'INSERT')
       OR has_table_privilege('authenticated', 'public.premium_orders', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.premium_payment_events', 'SELECT')
       OR has_table_privilege('authenticated', 'public.premium_refunds', 'SELECT') THEN
      RAISE EXCEPTION 'a payment door is open to a client';
    END IF;

    RAISE EXCEPTION 'payments_proof_ok';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg <> 'payments_proof_ok' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.premium_orders) OR EXISTS (SELECT 1 FROM public.premium_entitlements)
     OR EXISTS (SELECT 1 FROM public.premium_payment_events) OR EXISTS (SELECT 1 FROM public.premium_refunds)
     OR (SELECT sales_enabled FROM public.premium_settings) THEN
    RAISE EXCEPTION 'the proof left something behind';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261113000000_premium_payments')
ON CONFLICT (version) DO NOTHING;

COMMIT;
