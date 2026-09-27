-- ===========================================================================
-- PREMIUM PLANS FOR INDIVIDUAL (EXAM) ACCOUNTS — what each plan allows, and
-- one place that decides it.
--
-- RULED by the owner, 2026-09-27 (docs/gurukul-spec-rules.md, "Premium"):
-- three paid plans, ₹199 / ₹499 / ₹999, for individual CUET accounts only —
-- never for a school's students. Free keeps Recovery, Revision, the Mistake
-- Book and its reattempts, and chapter-wise analysis; practice is unlimited on
-- every paid plan; topic-wise analysis and Explain my mistake from ₹199; Nova
-- chat is limited on Free; Custom Practice from ₹199 with a limit; screen
-- capture limited on ₹499 and unlimited on ₹999; full CUET mock tests to be
-- built. The numbers below that the owner did not name are the defaults
-- proposed on 2026-09-27; every one of them is a row in premium_limits and
-- can be changed without a release.
--
-- THE ONE HOME. A row in premium_limits says a feature is IN a plan, per what
-- period, and how many uses (NULL = unlimited). No row = not in the plan.
-- _premium_decide() is the only function that reads it; every gate — the
-- practice attempt below, the AI edge functions, mock tests — asks it.
--
-- NOTHING IS ENFORCED YET. premium_settings.enforcement_enabled is false and
-- premium_settings.sales_enabled is false. While enforcement is off every
-- decision says yes (and still counts, so the counters are real on the day it
-- is switched on). premium_enforced_accounts switches enforcement on for
-- named accounts only — how each gate is proved on production without
-- touching a real student.
--
-- MONEY RECORDS OUTLIVE ACCOUNTS. premium_entitlements keeps account_id
-- without a foreign key to auth.users: deleting a user must never delete the
-- record of what they paid for.
--
-- ROLLBACK: rollback/20261111000000_premium_plans_for_individual_accounts.rollback.sql
-- ===========================================================================

BEGIN;

-- ── The catalogue ───────────────────────────────────────────────────────────

CREATE TABLE public.premium_tiers (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  rank         smallint NOT NULL UNIQUE CHECK (rank >= 0),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Free is the floor every account stands on, and nothing else is.
  CONSTRAINT premium_tiers_free_is_rank_zero CHECK ((code = 'free') = (rank = 0))
);
COMMENT ON TABLE public.premium_tiers IS
  'Plans for individual (exam) accounts, ordered by rank. free is rank 0 and is what an account without a live entitlement has.';

INSERT INTO public.premium_tiers (code, rank, display_name) VALUES
  ('free',    0, 'Free'),
  ('starter', 1, 'Starter'),
  ('pro',     2, 'Pro'),
  ('max',     3, 'Max');

CREATE TABLE public.premium_features (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  description text NOT NULL CHECK (btrim(description) <> '')
);
COMMENT ON TABLE public.premium_features IS
  'What a plan can allow. premium_limits says which plan allows it and how much.';

INSERT INTO public.premium_features (code, description) VALUES
  ('practice.question',      'A new practice question answered. Recovery, Revision and Mistake Book reattempts are never counted.'),
  ('analysis.topic',         'Topic-wise analysis.'),
  ('nova.message',           'A message to Nova, the AI tutor: chat, Explain my mistake, and the Revision chat.'),
  ('mistake.explain',        'Explain my mistake: Nova on a question, and the explain panel after a session.'),
  ('insights.report',        'The AI insights coach on a practice session.'),
  ('custom_practice.upload', 'A Custom Practice upload that was accepted.'),
  ('screen_capture.mistake', 'A mistake captured from another app''s screen.'),
  ('mock_test.start',        'A full CUET mock test started.');

CREATE TABLE public.premium_limits (
  tier_code    text NOT NULL REFERENCES public.premium_tiers(code) ON UPDATE CASCADE,
  feature_code text NOT NULL REFERENCES public.premium_features(code) ON UPDATE CASCADE,
  -- day and month are Indian Standard Time; lifetime never resets; none means
  -- access only, never counted.
  period       text NOT NULL CHECK (period IN ('day', 'month', 'lifetime', 'none')),
  max_uses     integer CHECK (max_uses IS NULL OR max_uses > 0),
  PRIMARY KEY (tier_code, feature_code),
  CONSTRAINT premium_limits_access_is_uncounted CHECK (period <> 'none' OR max_uses IS NULL)
);
COMMENT ON TABLE public.premium_limits IS
  'THE ONE HOME for what a plan allows. A row = the feature is in the plan; max_uses NULL = unlimited; no row = not in the plan.';

INSERT INTO public.premium_limits (tier_code, feature_code, period, max_uses) VALUES
  -- Free
  ('free',    'practice.question',      'day',      20),
  ('free',    'nova.message',           'day',      5),
  ('free',    'mock_test.start',        'lifetime', 1),
  -- ₹199
  ('starter', 'practice.question',      'day',      NULL),
  ('starter', 'analysis.topic',         'none',     NULL),
  ('starter', 'nova.message',           'day',      20),
  ('starter', 'mistake.explain',        'none',     NULL),
  ('starter', 'insights.report',        'none',     NULL),
  ('starter', 'custom_practice.upload', 'month',    5),
  ('starter', 'mock_test.start',        'lifetime', 1),
  -- ₹499
  ('pro',     'practice.question',      'day',      NULL),
  ('pro',     'analysis.topic',         'none',     NULL),
  ('pro',     'nova.message',           'day',      100),
  ('pro',     'mistake.explain',        'none',     NULL),
  ('pro',     'insights.report',        'none',     NULL),
  ('pro',     'custom_practice.upload', 'month',    30),
  ('pro',     'screen_capture.mistake', 'day',      10),
  ('pro',     'mock_test.start',        'month',    4),
  -- ₹999
  ('max',     'practice.question',      'day',      NULL),
  ('max',     'analysis.topic',         'none',     NULL),
  ('max',     'nova.message',           'day',      300),
  ('max',     'mistake.explain',        'none',     NULL),
  ('max',     'insights.report',        'none',     NULL),
  ('max',     'custom_practice.upload', 'month',    100),
  ('max',     'screen_capture.mistake', 'day',      NULL),
  ('max',     'mock_test.start',        'month',    NULL);

-- What is sold. An order copies the amount, validity and tier it was sold at,
-- so changing a product never changes a purchase already made.
CREATE TABLE public.premium_products (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  tier_code     text NOT NULL REFERENCES public.premium_tiers(code) ON UPDATE CASCADE,
  amount_paise  integer NOT NULL CHECK (amount_paise > 0),
  currency      text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  validity_days integer NOT NULL CHECK (validity_days BETWEEN 1 AND 400),
  display_name  text NOT NULL CHECK (btrim(display_name) <> ''),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT premium_products_not_free CHECK (tier_code <> 'free')
);
COMMENT ON TABLE public.premium_products IS
  'What can be bought: a plan for a number of days, at a price in paise, GST included. One-time payment; nothing renews by itself.';

INSERT INTO public.premium_products (code, tier_code, amount_paise, validity_days, display_name) VALUES
  ('starter_30d', 'starter', 19900, 30, 'Starter — 30 days'),
  ('pro_30d',     'pro',     49900, 30, 'Pro — 30 days'),
  ('max_30d',     'max',     99900, 30, 'Max — 30 days');

-- ── The switches ────────────────────────────────────────────────────────────

CREATE TABLE public.premium_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Gates refuse only when this is on (or for an account in
  -- premium_enforced_accounts).
  enforcement_enabled boolean NOT NULL DEFAULT false,
  -- Checkout refuses while this is off.
  sales_enabled       boolean NOT NULL DEFAULT false,
  -- The Terms / Refund Policy version a buyer must accept. Checkout refuses
  -- while it is empty, so nothing can be sold under terms that do not exist.
  terms_version       text NOT NULL DEFAULT '',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT premium_settings_no_sales_without_terms CHECK (NOT sales_enabled OR btrim(terms_version) <> '')
);
INSERT INTO public.premium_settings (id) VALUES (true);
COMMENT ON TABLE public.premium_settings IS
  'One row. Nothing is enforced and nothing is sold until the owner switches these on.';

CREATE TABLE public.premium_enforced_accounts (
  account_id uuid PRIMARY KEY,
  note       text NOT NULL CHECK (btrim(note) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.premium_enforced_accounts IS
  'Accounts that plan limits apply to while premium_settings.enforcement_enabled is still off — for proving the gates on production.';

-- ── What an account has, and what it has used ───────────────────────────────

CREATE TABLE public.premium_entitlements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL,
  tier_code     text NOT NULL REFERENCES public.premium_tiers(code) ON UPDATE CASCADE,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  source        text NOT NULL CHECK (source IN ('payment', 'grant')),
  -- The order that paid for it (foreign key added with the orders table).
  order_id      uuid UNIQUE,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoke_reason text,
  CONSTRAINT premium_entitlements_has_length   CHECK (ends_at > starts_at),
  CONSTRAINT premium_entitlements_not_free     CHECK (tier_code <> 'free'),
  CONSTRAINT premium_entitlements_paid_has_order CHECK ((source = 'payment') = (order_id IS NOT NULL)),
  CONSTRAINT premium_entitlements_grant_says_why CHECK (source <> 'grant' OR btrim(coalesce(note, '')) <> ''),
  CONSTRAINT premium_entitlements_revoke_says_why CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX premium_entitlements_account_idx ON public.premium_entitlements (account_id, ends_at);
COMMENT ON TABLE public.premium_entitlements IS
  'A plan an account holds from starts_at to ends_at. The account''s plan now is the highest-ranked live one; with none it is free.';

CREATE TABLE public.premium_usage (
  account_id   uuid NOT NULL,
  feature_code text NOT NULL REFERENCES public.premium_features(code) ON UPDATE CASCADE,
  period_key   text NOT NULL CHECK (period_key ~ '^(d:\d{4}-\d{2}-\d{2}|m:\d{4}-\d{2}|l)$'),
  used         integer NOT NULL CHECK (used >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, feature_code, period_key)
);
COMMENT ON TABLE public.premium_usage IS
  'How much of each counted feature an account used in each period (IST day, IST month, or l for lifetime).';

-- ── Who may read what ───────────────────────────────────────────────────────
-- The catalogue is public (the pricing page is shown before sign-in). An
-- account reads its own entitlements and usage. Nobody but the server writes
-- anything here.

ALTER TABLE public.premium_tiers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_features          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_limits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_enforced_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_usage             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.premium_tiers, public.premium_features, public.premium_limits, public.premium_products,
              public.premium_settings, public.premium_enforced_accounts, public.premium_entitlements,
              public.premium_usage
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.premium_tiers, public.premium_features, public.premium_limits TO anon, authenticated;
GRANT SELECT ON public.premium_products TO anon, authenticated;
GRANT SELECT ON public.premium_entitlements, public.premium_usage TO authenticated;

CREATE POLICY premium_tiers_read    ON public.premium_tiers    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY premium_features_read ON public.premium_features FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY premium_limits_read   ON public.premium_limits   FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY premium_products_read ON public.premium_products FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY premium_entitlements_own ON public.premium_entitlements FOR SELECT TO authenticated
  USING (account_id = (SELECT auth.uid()));
CREATE POLICY premium_usage_own ON public.premium_usage FOR SELECT TO authenticated
  USING (account_id = (SELECT auth.uid()));

-- ── The decision ────────────────────────────────────────────────────────────

-- The period a use falls in. A day and a month are Indian Standard Time: a
-- student in India expects "today" to reset at their midnight, not UTC's.
CREATE FUNCTION public._premium_period_key(_period text, _at timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _period
    WHEN 'day'      THEN 'd:' || to_char(_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
    WHEN 'month'    THEN 'm:' || to_char(_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
    WHEN 'lifetime' THEN 'l'
  END
$function$;

-- Plans are for individual (exam) accounts only. A school's student is never
-- limited by them and never counted.
CREATE FUNCTION public._premium_is_individual(_account uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.exam_accounts ea WHERE ea.account_id = _account)
$function$;

CREATE FUNCTION public._premium_enforced_for(_account uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s.enforcement_enabled FROM public.premium_settings s), false)
      OR EXISTS (SELECT 1 FROM public.premium_enforced_accounts a WHERE a.account_id = _account)
$function$;

-- The plan an account has at a moment: its highest-ranked live entitlement,
-- or free.
CREATE FUNCTION public._premium_tier(_account uuid, _at timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT e.tier_code
      FROM public.premium_entitlements e
      JOIN public.premium_tiers t ON t.code = e.tier_code
     WHERE e.account_id = _account
       AND e.revoked_at IS NULL
       AND e.starts_at <= _at
       AND e.ends_at > _at
     ORDER BY t.rank DESC
     LIMIT 1), 'free')
$function$;

-- THE decision. Says whether _account may use _feature _units more times now,
-- and — when _consume — counts the use in the same statement that checks it,
-- so two requests racing for the last use cannot both get it.
--
-- Returns {ok, applies, enforced, tier, feature, period, period_key, limit,
-- used, remaining, reason}. reason is 'not_in_plan' or 'limit_reached' when
-- ok is false. applies is false for a school's student (always ok, never
-- counted). While enforcement is off it answers ok and still counts, with
-- would_deny set when enforcement would have refused.
CREATE FUNCTION public._premium_decide(_account uuid, _feature text, _units integer DEFAULT 1, _consume boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tier     text;
  _lim      record;
  _enforced boolean;
  _key      text;
  _used     integer;
  _deny     text;
BEGIN
  IF _account IS NULL THEN
    RAISE EXCEPTION 'premium: no account' USING ERRCODE = '22004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.premium_features f WHERE f.code = _feature) THEN
    RAISE EXCEPTION 'premium: unknown feature %', _feature USING ERRCODE = '22023';
  END IF;
  IF _units IS NULL OR _units < 1 THEN
    RAISE EXCEPTION 'premium: units must be at least 1' USING ERRCODE = '22023';
  END IF;

  IF NOT public._premium_is_individual(_account) THEN
    RETURN jsonb_build_object('ok', true, 'applies', false, 'feature', _feature);
  END IF;

  _tier := public._premium_tier(_account);
  _enforced := public._premium_enforced_for(_account);
  SELECT l.period, l.max_uses INTO _lim
    FROM public.premium_limits l
   WHERE l.tier_code = _tier AND l.feature_code = _feature;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', NOT _enforced, 'applies', true, 'enforced', _enforced, 'tier', _tier, 'feature', _feature,
      'reason', CASE WHEN _enforced THEN 'not_in_plan' END,
      'would_deny', CASE WHEN NOT _enforced THEN 'not_in_plan' END);
  END IF;

  IF _lim.period = 'none' THEN
    RETURN jsonb_build_object('ok', true, 'applies', true, 'enforced', _enforced, 'tier', _tier,
                              'feature', _feature, 'period', 'none');
  END IF;

  _key := public._premium_period_key(_lim.period);

  IF NOT _consume THEN
    SELECT u.used INTO _used FROM public.premium_usage u
     WHERE u.account_id = _account AND u.feature_code = _feature AND u.period_key = _key;
    _used := COALESCE(_used, 0);
    IF _lim.max_uses IS NOT NULL AND _used + _units > _lim.max_uses THEN
      _deny := 'limit_reached';
    END IF;
  ELSIF _lim.max_uses IS NULL OR NOT _enforced THEN
    -- Unlimited, or not enforced: count and allow.
    INSERT INTO public.premium_usage AS u (account_id, feature_code, period_key, used)
    VALUES (_account, _feature, _key, _units)
    ON CONFLICT (account_id, feature_code, period_key)
    DO UPDATE SET used = u.used + EXCLUDED.used, updated_at = now()
    RETURNING u.used INTO _used;
    IF _lim.max_uses IS NOT NULL AND _used > _lim.max_uses THEN
      _deny := 'limit_reached';   -- reported as would_deny: enforcement is off
    END IF;
  ELSIF _units > _lim.max_uses THEN
    SELECT u.used INTO _used FROM public.premium_usage u
     WHERE u.account_id = _account AND u.feature_code = _feature AND u.period_key = _key;
    _used := COALESCE(_used, 0);
    _deny := 'limit_reached';
  ELSE
    -- Check and count in one statement: the conflict arm only increments
    -- while the result stays within the limit, and returns no row when it
    -- would not.
    INSERT INTO public.premium_usage AS u (account_id, feature_code, period_key, used)
    VALUES (_account, _feature, _key, _units)
    ON CONFLICT (account_id, feature_code, period_key)
    DO UPDATE SET used = u.used + EXCLUDED.used, updated_at = now()
     WHERE u.used + EXCLUDED.used <= _lim.max_uses
    RETURNING u.used INTO _used;
    IF _used IS NULL THEN
      SELECT u.used INTO _used FROM public.premium_usage u
       WHERE u.account_id = _account AND u.feature_code = _feature AND u.period_key = _key;
      _deny := 'limit_reached';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', _deny IS NULL OR NOT _enforced,
    'applies', true,
    'enforced', _enforced,
    'tier', _tier,
    'feature', _feature,
    'period', _lim.period,
    'period_key', _key,
    'limit', _lim.max_uses,
    'used', _used,
    'remaining', CASE WHEN _lim.max_uses IS NULL THEN NULL ELSE GREATEST(_lim.max_uses - _used, 0) END,
    'reason', CASE WHEN _enforced THEN _deny END,
    'would_deny', CASE WHEN NOT _enforced THEN _deny END);
END;
$function$;

-- The same decision, for a gate inside the database: refuses with a message
-- the app recognises — 'plan_limit:<feature>' — and the decision as DETAIL.
CREATE FUNCTION public._premium_require(_account uuid, _feature text, _units integer DEFAULT 1, _consume boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _d jsonb := public._premium_decide(_account, _feature, _units, _consume);
BEGIN
  IF NOT (_d->>'ok')::boolean THEN
    RAISE EXCEPTION 'plan_limit:%', _feature
      USING ERRCODE = 'P0001', DETAIL = _d::text, HINT = _d->>'reason';
  END IF;
  RETURN _d;
END;
$function$;

-- Gives back a use counted for something that then did not happen (an AI
-- call that failed, a capture that held no mistake). Only in the period it
-- was counted in, never below zero.
CREATE FUNCTION public._premium_release(_account uuid, _feature text, _period_key text, _units integer DEFAULT 1)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.premium_usage u
     SET used = GREATEST(u.used - GREATEST(_units, 0), 0), updated_at = now()
   WHERE u.account_id = _account AND u.feature_code = _feature AND u.period_key = _period_key
$function$;

-- ── For the edge functions (service_role only) ──────────────────────────────

CREATE FUNCTION public.premium_consume(_account uuid, _feature text, _units integer DEFAULT 1)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$ SELECT public._premium_decide(_account, _feature, _units, true) $function$;

CREATE FUNCTION public.premium_check(_account uuid, _feature text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$ SELECT public._premium_decide(_account, _feature, 1, false) $function$;

CREATE FUNCTION public.premium_release(_account uuid, _feature text, _period_key text, _units integer DEFAULT 1)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$ SELECT public._premium_release(_account, _feature, _period_key, _units) $function$;

-- The owner's grant: a plan given, not sold (a tester, a goodwill extension).
-- It says why, and it is an entitlement like any other.
CREATE FUNCTION public.premium_grant(_account uuid, _tier text, _days integer, _note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF NOT public._premium_is_individual(_account) THEN
    RAISE EXCEPTION 'premium_grant: % is not an individual (exam) account', _account;
  END IF;
  IF _days IS NULL OR _days < 1 OR _days > 400 THEN
    RAISE EXCEPTION 'premium_grant: days must be 1..400';
  END IF;
  INSERT INTO public.premium_entitlements (account_id, tier_code, starts_at, ends_at, source, note)
  VALUES (_account, _tier, now(), now() + make_interval(days => _days), 'grant', _note)
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

-- ── For the app ─────────────────────────────────────────────────────────────

-- Everything the plans screen and the upgrade prompts need, for the caller.
CREATE FUNCTION public.rpc_my_premium()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid      uuid := auth.uid();
  _tier     text;
  _until    timestamptz;
  _next     timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public._premium_is_individual(_uid) THEN
    RETURN jsonb_build_object('individual', false);
  END IF;

  _tier := public._premium_tier(_uid);

  -- How long the current plan lasts: its live entitlement's end, carried on
  -- through any same-plan purchase that starts before it ends.
  SELECT max(e.ends_at) INTO _until
    FROM public.premium_entitlements e
   WHERE e.account_id = _uid AND e.tier_code = _tier AND e.revoked_at IS NULL
     AND e.starts_at <= now() AND e.ends_at > now();
  LOOP
    EXIT WHEN _until IS NULL;
    SELECT max(e.ends_at) INTO _next
      FROM public.premium_entitlements e
     WHERE e.account_id = _uid AND e.tier_code = _tier AND e.revoked_at IS NULL
       AND e.starts_at <= _until AND e.ends_at > _until;
    EXIT WHEN _next IS NULL;
    _until := _next;
  END LOOP;

  RETURN jsonb_build_object(
    'individual', true,
    'enforced', public._premium_enforced_for(_uid),
    'sales_enabled', (SELECT s.sales_enabled FROM public.premium_settings s),
    'terms_version', (SELECT s.terms_version FROM public.premium_settings s),
    'tier', _tier,
    'tier_rank', (SELECT t.rank FROM public.premium_tiers t WHERE t.code = _tier),
    'tier_until', _until,
    'entitlements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'tier', e.tier_code, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'source', e.source)
             ORDER BY e.starts_at)
        FROM public.premium_entitlements e
       WHERE e.account_id = _uid AND e.revoked_at IS NULL AND e.ends_at > now()), '[]'::jsonb),
    'features', COALESCE((
      SELECT jsonb_agg(public._premium_decide(_uid, f.code, 1, false) || jsonb_build_object('description', f.description)
             ORDER BY f.code)
        FROM public.premium_features f), '[]'::jsonb),
    'tiers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'code', t.code, 'rank', t.rank, 'display_name', t.display_name,
               'limits', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('feature', l.feature_code, 'period', l.period, 'limit', l.max_uses)
                        ORDER BY l.feature_code)
                   FROM public.premium_limits l WHERE l.tier_code = t.code), '[]'::jsonb))
             ORDER BY t.rank)
        FROM public.premium_tiers t), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'code', p.code, 'tier', p.tier_code, 'amount_paise', p.amount_paise, 'currency', p.currency,
               'validity_days', p.validity_days, 'display_name', p.display_name)
             ORDER BY p.amount_paise)
        FROM public.premium_products p WHERE p.is_active), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public._premium_period_key(text, timestamptz)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._premium_is_individual(uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._premium_enforced_for(uuid)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._premium_tier(uuid, timestamptz)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._premium_decide(uuid, text, integer, boolean)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._premium_require(uuid, text, integer, boolean)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._premium_release(uuid, text, text, integer)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_consume(uuid, text, integer)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_check(uuid, text)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_release(uuid, text, text, integer)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_grant(uuid, text, integer, text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_my_premium()                                       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.premium_consume(uuid, text, integer)       TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_check(uuid, text)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_release(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_grant(uuid, text, integer, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_my_premium()                           TO authenticated;

-- ── The practice gate ───────────────────────────────────────────────────────
-- rpc_record_question_attempt exactly as 20261097000000 left it (read back from
-- live and compared: identical), with the one block marked PREMIUM added.
CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(_correct_answer jsonb, _generated_question jsonb, _is_correct boolean, _selected_answer jsonb, _session_id uuid, _score numeric DEFAULT 0, _skipped boolean DEFAULT false, _template_id uuid DEFAULT NULL::uuid, _time_taken_ms integer DEFAULT NULL::integer, _bank_question_id uuid DEFAULT NULL::uuid, _hint_used boolean DEFAULT false, _source text DEFAULT 'practice'::text, _meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _aid uuid;
  _ps record;
  _tm record;
  _subject text;
  _chapter text;
  _topic text;
  _class int := 12;
  _concept_f text;
  _sub_f text;
  _difficulty text := 'medium';
  _explanation text;
  _resolved_correct boolean := false;
  _resolved_score numeric := 0;
  _resolved_correct_answer jsonb := COALESCE(_correct_answer, '{}'::jsonb);
  -- The question a mistake belongs to: a variant's origin, or the
  -- question itself. Set beside _bank_id so the two cannot drift.
  _mistake_qid uuid;
  _grade record;
  -- What the mistake row records: the question it names (see below).
  _origin record;
  _mk_subject text;
  _mk_chapter text;
  _mk_concept text;
  _mk_subconcept text;
  _mk_question text;
  _mk_options jsonb;
  _mk_answer jsonb;
  _mk_correct jsonb;
  _mk_explanation text;
  _bank_id uuid := COALESCE(
    _bank_question_id,
    NULLIF(_generated_question->>'bank_question_id', '')::uuid,
    NULLIF(_generated_question->>'question_id', '')::uuid
  );
  _src text := COALESCE(NULLIF(trim(_source), ''), 'practice');
  _m jsonb := COALESCE(_meta, '{}'::jsonb);
  _school uuid;
  _board text;
  _stream text;
  _practice_mode text;
  _source_id uuid;
  _solution_viewed boolean := COALESCE((_m->>'solution_viewed')::boolean, false);
  _confidence numeric := NULLIF(_m->>'confidence', '')::numeric;
  _attempt_number int := NULLIF(_m->>'attempt_number', '')::int;
  _timed_out boolean := COALESCE((_m->>'timed_out')::boolean, false);
  _answered_at timestamptz := COALESCE(NULLIF(_m->>'answered_at', '')::timestamptz, now());
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id, school_id INTO _sid, _school
  FROM public.students WHERE user_id = _uid LIMIT 1;

  -- One writer per session at a time: the de-duplication below is a read
  -- followed by a write, and two calls racing it both inserted.
  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid
  FOR UPDATE;

  IF _ps IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  _school := COALESCE(
    NULLIF(_m->>'school_id', '')::uuid,
    _ps.school_id,
    _school
  );
  _board := COALESCE(NULLIF(_m->>'board', ''), _ps.board);
  _stream := COALESCE(NULLIF(_m->>'stream', ''), _ps.stream);
  _practice_mode := COALESCE(
    NULLIF(_m->>'practice_mode', ''),
    _ps.practice_mode,
    NULLIF(_generated_question->>'practice_mode', '')
  );
  _source_id := COALESCE(
    NULLIF(_m->>'source_id', '')::uuid,
    _session_id
  );
  -- A topic string from the client is honoured ONLY for a question that is not
  -- in the bank. A bank question's topic is the bank's (below): a client that
  -- sends a stale or display-cleaned label must not file the attempt under a
  -- topic the question does not belong to.
  _topic := COALESCE(
    NULLIF(_m->>'topic', ''),
    NULLIF(_generated_question->>'topic', '')
  );
  IF _m ? 'hint_used' THEN
    _hint_used := COALESCE((_m->>'hint_used')::boolean, _hint_used);
  END IF;

  -- Same-session re-entry: update the existing attempt and return early, so
  -- counters are not double-counted within one session.
  IF _bank_id IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id = _bank_id
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        attempt_number = COALESCE(attempt_number, _attempt_number),
        practice_mode = COALESCE(practice_mode, _practice_mode),
        board = COALESCE(board, _board),
        stream = COALESCE(stream, _stream),
        class_level = COALESCE(class_level, NULLIF(_m->>'class_level', '')::int, _ps.class_level),
        school_id = COALESCE(school_id, _school),
        source_id = COALESCE(source_id, _source_id),
        answered_at = COALESCE(answered_at, _answered_at)
      WHERE id = _aid;
      RETURN public._attempt_verdict(_aid);
    END IF;
  END IF;

  -- Same fix, for the template path (bank_id IS NULL): Class12MathSession.tsx
  -- / Class12AiSession.tsx persist each answer live via
  -- recordPracticeAttemptBestEffort, then rpc_finish_practice_session
  -- unconditionally re-sends the same attempt again at session finish. The
  -- bank-path check above can't catch this (bank_question_id is null for a
  -- template attempt by definition) -- attempt_number is the equivalent
  -- natural key here, set by the client on every attempt regardless of
  -- source.
  IF _bank_id IS NULL AND _attempt_number IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id IS NULL
      AND attempt_number = _attempt_number
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        practice_mode = COALESCE(practice_mode, _practice_mode),
        topic = COALESCE(topic, _topic),
        board = COALESCE(board, _board),
        stream = COALESCE(stream, _stream),
        school_id = COALESCE(school_id, _school),
        source_id = COALESCE(source_id, _source_id),
        answered_at = COALESCE(answered_at, _answered_at)
      WHERE id = _aid;
      RETURN public._attempt_verdict(_aid);
    END IF;
  END IF;

  -- PREMIUM (20261111000000): a NEW practice question answered by an
  -- individual account counts against its plan's daily allowance, and is
  -- refused past it -- before it is graded, so no verdict is given for a
  -- question the plan does not cover. A re-entry returned above and is never
  -- counted twice. Recovery, Revision and Mistake Book reattempts are free
  -- (the owner's ruling, 2026-09-27), and so are uploaded and captured
  -- questions, which have plan limits of their own.
  IF _src = 'practice' AND COALESCE(_practice_mode, '') NOT IN ('recovery', 'revision', 'incorrect') THEN
    PERFORM public._premium_require(_uid, 'practice.question', 1);
  END IF;

  IF _bank_id IS NOT NULL THEN
    SELECT * INTO _grade
    FROM public._practice_grade_from_bank(_bank_id, COALESCE(_selected_answer, '{}'::jsonb), _correct_answer);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_question_not_found';
    END IF;
    IF COALESCE(_skipped, false) OR _timed_out THEN
      _resolved_correct := false;
      _resolved_score := 0;
    ELSE
      _resolved_correct := _grade.is_correct;
      _resolved_score := _grade.score;
    END IF;
    _resolved_correct_answer := _grade.correct_answer;
    SELECT COALESCE(qb.source_question_id, _bank_id) INTO _mistake_qid
      FROM public.question_bank qb WHERE qb.id = _bank_id;
    _subject := COALESCE(_grade.subject, _ps.subject, 'General');
    _chapter := COALESCE(_grade.chapter, _ps.chapter);
    -- The bank's topic, and nothing the client said. Mastery and mistakes key
    -- on it (as concept, with subconcept = concept, the shape this function
    -- has always written).
    _topic := COALESCE(_grade.topic, _chapter);
    _concept_f := COALESCE(_grade.topic, _chapter, _subject);
    _sub_f := _concept_f;
    _class := COALESCE(
      NULLIF(_m->>'class_level', '')::int,
      _grade.class_level,
      _ps.class_level,
      12
    );
    _difficulty := COALESCE(NULLIF(_m->>'difficulty', ''), _grade.difficulty, 'medium');
    _explanation := COALESCE(_grade.explanation, '');
    IF COALESCE(_generated_question->>'question', '') = '' THEN
      _generated_question := jsonb_build_object(
        'question', _grade.question_text,
        'options', _grade.options,
        'explanation', _explanation,
        'bank_question_id', _bank_id,
        'subject', _subject,
        'chapter', _chapter,
        'topic', _topic,
        'topic_id', _grade.topic_id,
        'difficulty', _difficulty,
        'practice_mode', _practice_mode
      );
    ELSE
      _generated_question := COALESCE(_generated_question, '{}'::jsonb)
        - 'concept'
        || jsonb_build_object(
          'bank_question_id', _bank_id,
          'explanation', COALESCE(_generated_question->>'explanation', _explanation),
          'subject', COALESCE(_generated_question->>'subject', _subject),
          'chapter', COALESCE(_generated_question->>'chapter', _chapter),
          'topic', _topic,
          'topic_id', _grade.topic_id,
          'practice_mode', COALESCE(_generated_question->>'practice_mode', _practice_mode)
        );
    END IF;
  ELSE
    -- Upload / free-text: no bank row, often no template. Never dereference
    -- _tm unless SELECT INTO assigned it — PL/pgSQL raises on unassigned
    -- record fields even inside COALESCE (§12.2 measured 2026-09-24).
    IF _template_id IS NOT NULL THEN
      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
      _subject := COALESCE(
        NULLIF(_generated_question->>'subject', ''),
        _tm.subject, _ps.subject, 'General'
      );
      _chapter := COALESCE(
        NULLIF(_generated_question->>'chapter', ''),
        _tm.chapter, _ps.chapter
      );
      _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _tm.chapter, _chapter);
      _concept_f := COALESCE(
        NULLIF(_generated_question->>'concept', ''),
        _tm.concept, _tm.chapter, _ps.chapter, _ps.subject
      );
      _sub_f := COALESCE(_tm.subconcept, _concept_f);
      _class := COALESCE(
        NULLIF(_m->>'class_level', '')::int,
        _tm.class, _ps.class_level, 12
      );
      _difficulty := COALESCE(
        NULLIF(_m->>'difficulty', ''),
        _tm.difficulty, _tm.template_data->>'difficulty', 'medium'
      );
    ELSE
      _subject := COALESCE(
        NULLIF(_generated_question->>'subject', ''),
        _ps.subject, 'General'
      );
      _chapter := COALESCE(
        NULLIF(_generated_question->>'chapter', ''),
        _ps.chapter
      );
      _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _chapter);
      _concept_f := COALESCE(
        NULLIF(_generated_question->>'concept', ''),
        _ps.chapter, _ps.subject
      );
      _sub_f := _concept_f;
      _class := COALESCE(
        NULLIF(_m->>'class_level', '')::int,
        _ps.class_level, 12
      );
      _difficulty := COALESCE(
        NULLIF(_m->>'difficulty', ''),
        'medium'
      );
    END IF;
    _resolved_correct := CASE
      WHEN COALESCE(_skipped, false) OR _timed_out THEN false
      ELSE COALESCE(_is_correct, false)
    END;
    _resolved_score := CASE WHEN _resolved_correct THEN COALESCE(_score, 1) ELSE 0 END;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
    _mistake_qid := _bank_id;
  END IF;

  IF COALESCE(_skipped, false) OR _timed_out THEN
    _resolved_correct := false;
    _resolved_score := 0;
    _skipped := true;
  END IF;

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, school_id, template_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, topic, concept, subconcept, difficulty,
    hint_used, solution_viewed, confidence, attempt_number, source, source_id,
    practice_mode, class_level, board, stream, timed_out, answered_at
  ) VALUES (
    _session_id, _sid, _uid, _school, _template_id, _bank_id,
    COALESCE(_generated_question, '{}'::jsonb),
    COALESCE(_selected_answer, '{}'::jsonb),
    _resolved_correct_answer,
    _resolved_score,
    _resolved_correct,
    _time_taken_ms,
    COALESCE(_skipped, false),
    _subject, _chapter, _topic, _concept_f, _sub_f, _difficulty,
    COALESCE(_hint_used, false),
    _solution_viewed,
    _confidence,
    _attempt_number,
    _src,
    _source_id,
    _practice_mode,
    _class,
    _board,
    _stream,
    _timed_out,
    _answered_at
  ) RETURNING id INTO _aid;

  IF _resolved_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1,
          score = score + COALESCE(_resolved_score, 1)
      WHERE id = _session_id AND user_id = _uid;
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, true, false
    );
    BEGIN
      PERFORM public.rpc_refresh_academic_brain();
    EXCEPTION WHEN others THEN
      NULL;
    END;
  ELSIF NOT COALESCE(_skipped, false) THEN
    _explanation := COALESCE(
      NULLIF(_explanation, ''),
      NULLIF(_generated_question->>'explanation', ''),
      ''
    );
    IF _explanation = '' AND _template_id IS NOT NULL THEN
      SELECT explanation_template INTO _explanation
      FROM public.question_templates WHERE id = _template_id LIMIT 1;
    END IF;
    _explanation := COALESCE(_explanation, '');
    -- §4.6: recovery may bump a row, never add one. Tiers 1-3 are
    -- generated variants the student has never seen, so recording them the
    -- ordinary way manufactured new mistakes out of the session built to fix
    -- the old ones — 6 open became 10, which is above the relearn boundary.
    -- Revision is not exempt: §5.5 gives it the opposite rule on purpose.
    --
    -- A VARIANT IS NOT ITS OWN MISTAKE. It is another way of asking the
    -- original, so a wrong answer to it belongs to the ORIGINAL's row.
    -- _mistake_qid resolves a variant to the question it was generated from
    -- (question_bank.source_question_id) and leaves every other question
    -- alone.
    --
    -- Two defects came out of not doing this, both measured 2026-09-22:
    --
    --   IN RECOVERY, the guard below looked for a mistake keyed on the
    --   VARIANT, never found one, and so recorded nothing at all — 20 wrong
    --   answers to variants vanished. "Never add one" was implemented as
    --   "never do anything", which lost the bump as well as the insert.
    --
    --   OUTSIDE RECOVERY, the ordinary path keyed the mistake on the variant
    --   itself: 10 such rows exist, fragmenting one weakness across a parent
    --   and its generated children so that neither shows the true
    --   times_wrong.
    --
    -- Resolving first fixes both: recovery bumps the original and still adds
    -- nothing, and ordinary practice bumps the original instead of minting a
    -- variant-keyed row.
    IF COALESCE(_practice_mode, '') <> 'recovery'
       OR EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid
            AND sm.source = 'practice'
            AND sm.question_id IS NOT DISTINCT FROM _mistake_qid
            AND _mistake_qid IS NOT NULL)
    THEN
    -- THE ROW RECORDS THE QUESTION IT NAMES. For a variant that is the
    -- original: its text, options, key, explanation and topic. The student
    -- did not answer the original this time, so the answer the row shows
    -- stays the one they last gave to IT. Passing the variant's text and
    -- answer here (2026-09-22 to 09-25) put a variant's option against the
    -- original's options: the Mistake Book showed "Providing equal wages…"
    -- as the answer to a question with no such choice.
    _mk_subject := _subject; _mk_chapter := _chapter; _mk_concept := _concept_f; _mk_subconcept := _sub_f;
    _mk_question := COALESCE(_generated_question->>'question', '');
    _mk_options := COALESCE(_generated_question->'options', '[]'::jsonb);
    _mk_answer := COALESCE(_selected_answer, '{}'::jsonb);
    _mk_correct := _resolved_correct_answer;
    _mk_explanation := _explanation;
    IF _mistake_qid IS DISTINCT FROM _bank_id THEN
      SELECT * INTO _origin FROM public._practice_grade_from_bank(_mistake_qid, '{}'::jsonb, NULL);
      IF FOUND THEN
        _mk_subject := COALESCE(_origin.subject, _subject);
        _mk_chapter := COALESCE(_origin.chapter, _chapter);
        _mk_concept := COALESCE(_origin.topic, _origin.chapter, _concept_f);
        _mk_subconcept := _mk_concept;
        _mk_question := _origin.question_text;
        _mk_options := _origin.options;
        _mk_correct := _origin.correct_answer;
        _mk_explanation := COALESCE(_origin.explanation, '');
        SELECT sm.student_answer INTO _mk_answer
          FROM public.student_mistakes sm
         WHERE sm.user_id = _uid AND sm.source = 'practice' AND sm.question_id = _mistake_qid;
        _mk_answer := COALESCE(_mk_answer, '{}'::jsonb);
      END IF;
    END IF;
    PERFORM public.rpc_record_concept_mistake(
      CASE WHEN _src = 'upload' THEN 'upload' ELSE 'practice' END,
      _session_id, _mistake_qid,
      _mk_subject, _mk_chapter, _mk_concept, _mk_subconcept, _class,
      _mk_question,
      _mk_options,
      _mk_answer,
      _mk_correct,
      _mk_explanation,
      NULLIF(_generated_question->>'chapter_id', '')::uuid,
      NULLIF(_generated_question->>'upload_question_id', '')::uuid
    );
    END IF;
  END IF;

  RETURN public._attempt_verdict(_aid);
END;
$function$;

-- ── Proof ───────────────────────────────────────────────────────────────────
-- As a real CUET account and a real school student. Everything it writes is
-- inside a block that ends by raising 'premium_proof_ok', which rolls the
-- block back; any other exception is a failure and aborts the migration.
DO $proof$
DECLARE
  _exam    uuid;
  _school  constant uuid := 'd1000003-0001-4000-8000-000000000001';  -- Class 10-A, the fixture school
  _d       jsonb;
  _i       int;
  _sid     uuid;
  _rev     uuid;
  _qs      uuid[];
  _refused boolean;
  _msg     text;
  _bad     text;
  _n       int;
BEGIN
  SELECT ea.account_id INTO _exam
    FROM public.exam_accounts ea
    JOIN public.competitive_exams ce ON ce.id = ea.exam_id
   WHERE ce.code = 'cuet'
   ORDER BY ea.created_at
   LIMIT 1;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'no CUET account to prove the plans with';
  END IF;
  SELECT array_agg(x.id ORDER BY x.id) INTO _qs FROM (
    SELECT qb.id
      FROM public.question_bank qb
      JOIN public.competitive_exams ce ON ce.id = qb.exam_id
     WHERE ce.code = 'cuet' AND qb.is_active AND qb.is_approved
     ORDER BY qb.id
     LIMIT 22) x;
  IF coalesce(array_length(_qs, 1), 0) < 22 THEN
    RAISE EXCEPTION 'not enough CUET questions to prove the practice gate';
  END IF;

  BEGIN
    -- 0. It ships switched off.
    IF (SELECT s.enforcement_enabled OR s.sales_enabled FROM public.premium_settings s) THEN
      RAISE EXCEPTION 'premium must ship with enforcement and sales off';
    END IF;

    -- 1. A higher plan never gives less: every feature a plan has, every
    --    higher plan has, and never a smaller allowance in the same period.
    SELECT string_agg(lo.tier_code || '<' || hi_t.code || ':' || lo.feature_code, ', ') INTO _bad
      FROM public.premium_limits lo
      JOIN public.premium_tiers lo_t ON lo_t.code = lo.tier_code
      JOIN public.premium_tiers hi_t ON hi_t.rank > lo_t.rank
      LEFT JOIN public.premium_limits hi ON hi.tier_code = hi_t.code AND hi.feature_code = lo.feature_code
     WHERE hi.tier_code IS NULL
        OR (hi.period = lo.period AND lo.max_uses IS NULL AND hi.max_uses IS NOT NULL)
        OR (hi.period = lo.period AND hi.max_uses < lo.max_uses);
    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION 'a higher plan gives less than a lower one: %', _bad;
    END IF;

    -- 2. While off, a free account past its limit is allowed — and counted.
    FOR _i IN 1..6 LOOP
      _d := public._premium_decide(_exam, 'nova.message');
    END LOOP;
    IF NOT (_d->>'ok')::boolean OR (_d->>'used')::int <> 6 OR _d->>'would_deny' IS DISTINCT FROM 'limit_reached' THEN
      RAISE EXCEPTION 'while off: expected allowed, 6 counted, would deny; got %', _d;
    END IF;

    -- 3. A school's student is never limited and never counted.
    _d := public._premium_decide(_school, 'nova.message');
    IF NOT (_d->>'ok')::boolean OR (_d->>'applies')::boolean
       OR EXISTS (SELECT 1 FROM public.premium_usage u WHERE u.account_id = _school) THEN
      RAISE EXCEPTION 'a school student was limited or counted: %', _d;
    END IF;

    -- 4. Enforced for this account, on Free: the limits bite.
    INSERT INTO public.premium_enforced_accounts (account_id, note)
    VALUES (_exam, 'migration 20261111000000 proof');
    DELETE FROM public.premium_usage u WHERE u.account_id = _exam;
    FOR _i IN 1..5 LOOP
      _d := public._premium_decide(_exam, 'nova.message');
      IF NOT (_d->>'ok')::boolean THEN
        RAISE EXCEPTION 'free: Nova message % refused: %', _i, _d;
      END IF;
    END LOOP;
    _d := public._premium_decide(_exam, 'nova.message');
    IF (_d->>'ok')::boolean OR _d->>'reason' IS DISTINCT FROM 'limit_reached' OR (_d->>'used')::int <> 5 THEN
      RAISE EXCEPTION 'free: the 6th Nova message was allowed, or counted: %', _d;
    END IF;
    _d := public._premium_decide(_exam, 'analysis.topic', 1, false);
    IF (_d->>'ok')::boolean OR _d->>'reason' IS DISTINCT FROM 'not_in_plan' THEN
      RAISE EXCEPTION 'free: topic analysis allowed: %', _d;
    END IF;
    IF (public._premium_decide(_exam, 'mistake.explain', 1, false)->>'ok')::boolean THEN
      RAISE EXCEPTION 'free: Explain my mistake allowed';
    END IF;
    IF NOT (public._premium_decide(_exam, 'mock_test.start')->>'ok')::boolean THEN
      RAISE EXCEPTION 'free: the sample mock test was refused';
    END IF;
    IF (public._premium_decide(_exam, 'mock_test.start')->>'ok')::boolean THEN
      RAISE EXCEPTION 'free: a second mock test was allowed';
    END IF;

    -- 5. The practice gate, as the student, through the real RPCs.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _exam, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _sid := public.rpc_start_practice_session('Accountancy', NULL, 25, 'subject', NULL, NULL);
    FOR _i IN 1..20 LOOP
      PERFORM public.rpc_record_question_attempt(NULL, '{}'::jsonb, false, '{}'::jsonb, _sid, 0, true,
                                                 NULL, NULL, _qs[_i], false, 'practice', '{}'::jsonb);
    END LOOP;
    -- The 20th again is a re-entry: never counted twice, never refused.
    PERFORM public.rpc_record_question_attempt(NULL, '{}'::jsonb, false, '{}'::jsonb, _sid, 0, true,
                                               NULL, NULL, _qs[20], false, 'practice', '{}'::jsonb);
    _refused := false;
    BEGIN
      PERFORM public.rpc_record_question_attempt(NULL, '{}'::jsonb, false, '{}'::jsonb, _sid, 0, true,
                                                 NULL, NULL, _qs[21], false, 'practice', '{}'::jsonb);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
      IF _msg <> 'plan_limit:practice.question' THEN
        RAISE;
      END IF;
      _refused := true;
    END;
    IF NOT _refused THEN
      RAISE EXCEPTION 'free: the 21st practice question was not refused';
    END IF;
    -- CONTROL: Revision is free even with the day's practice used up.
    _rev := public.rpc_start_practice_session('Accountancy', NULL, 5, 'revision', NULL, NULL);
    PERFORM public.rpc_record_question_attempt(NULL, '{}'::jsonb, false, '{}'::jsonb, _rev, 0, true,
                                               NULL, NULL, _qs[22], false, 'practice', '{}'::jsonb);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    SELECT u.used INTO _n FROM public.premium_usage u
     WHERE u.account_id = _exam AND u.feature_code = 'practice.question';
    IF _n IS DISTINCT FROM 20 THEN
      RAISE EXCEPTION 'practice counted % questions, expected 20', _n;
    END IF;
    IF (SELECT count(*) FROM public.question_attempts qa WHERE qa.session_id IN (_sid, _rev)) <> 21 THEN
      RAISE EXCEPTION 'expected 20 practice attempts and 1 revision attempt recorded';
    END IF;

    -- 6. Starter: practice unlimited, topic analysis and explain allowed, Nova to 20.
    PERFORM public.premium_grant(_exam, 'starter', 30, 'migration 20261111000000 proof');
    IF public._premium_tier(_exam) <> 'starter' THEN
      RAISE EXCEPTION 'the grant did not make the account starter';
    END IF;
    _d := public._premium_decide(_exam, 'practice.question');
    IF NOT (_d->>'ok')::boolean OR _d->'limit' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'starter: practice is not unlimited: %', _d;
    END IF;
    IF NOT (public._premium_decide(_exam, 'analysis.topic', 1, false)->>'ok')::boolean THEN
      RAISE EXCEPTION 'starter: topic analysis refused';
    END IF;
    IF NOT (public._premium_decide(_exam, 'mistake.explain', 1, false)->>'ok')::boolean THEN
      RAISE EXCEPTION 'starter: Explain my mistake refused';
    END IF;
    _d := public._premium_decide(_exam, 'nova.message');
    IF NOT (_d->>'ok')::boolean OR (_d->>'remaining')::int <> 14 THEN
      RAISE EXCEPTION 'starter: Nova should have 14 left after 6 today: %', _d;
    END IF;
    IF (public._premium_decide(_exam, 'screen_capture.mistake', 1, false)->>'ok')::boolean THEN
      RAISE EXCEPTION 'starter: screen capture allowed';
    END IF;

    -- 7. A release gives one use back, in the period it was counted in.
    _d := public._premium_decide(_exam, 'nova.message');
    PERFORM public._premium_release(_exam, 'nova.message', _d->>'period_key', 1);
    IF (public._premium_decide(_exam, 'nova.message', 1, false)->>'used')::int <> (_d->>'used')::int - 1 THEN
      RAISE EXCEPTION 'the release did not give the use back';
    END IF;

    -- 8. The app sees its own plan; a school student is told plans do not apply.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _exam, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _d := public.rpc_my_premium();
    RESET ROLE;
    IF _d->>'tier' IS DISTINCT FROM 'starter' OR NOT (_d->>'individual')::boolean
       OR jsonb_array_length(_d->'products') <> 3 OR jsonb_array_length(_d->'tiers') <> 4 THEN
      RAISE EXCEPTION 'rpc_my_premium for the exam account: %', _d;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _school, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _d := public.rpc_my_premium();
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF (_d->>'individual')::boolean THEN
      RAISE EXCEPTION 'a school student was told plans apply to them';
    END IF;

    -- 9. No client may count, check, release or grant, or write a plan row.
    IF has_function_privilege('authenticated', 'public.premium_consume(uuid,text,integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.premium_grant(uuid,text,integer,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.premium_release(uuid,text,text,integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public._premium_decide(uuid,text,integer,boolean)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.rpc_my_premium()', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.rpc_my_premium()', 'EXECUTE')
       OR has_table_privilege('authenticated', 'public.premium_entitlements', 'INSERT')
       OR has_table_privilege('authenticated', 'public.premium_usage', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.premium_settings', 'SELECT')
       OR has_table_privilege('anon', 'public.premium_entitlements', 'SELECT') THEN
      RAISE EXCEPTION 'a premium door is open to a client';
    END IF;

    RAISE EXCEPTION 'premium_proof_ok';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg <> 'premium_proof_ok' THEN
      RAISE;
    END IF;
  END;

  -- Nothing the proof wrote survived it.
  IF EXISTS (SELECT 1 FROM public.premium_usage)
     OR EXISTS (SELECT 1 FROM public.premium_entitlements)
     OR EXISTS (SELECT 1 FROM public.premium_enforced_accounts) THEN
    RAISE EXCEPTION 'the proof left rows behind';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261111000000_premium_plans_for_individual_accounts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
