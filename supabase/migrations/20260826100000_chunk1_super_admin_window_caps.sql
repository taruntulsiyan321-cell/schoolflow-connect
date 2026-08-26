-- =====================================================================
-- CHUNK 1 (correction) — SUPER ADMIN ACCESS WINDOW CAPS
--
-- locked-decisions.md 10.20 now states the rule explicitly:
--
--   "Access expires automatically: 60 minutes per grant, 8 hours per day
--    maximum. Re-requesting is allowed and is itself logged."
--
-- The previous migration allowed a caller-chosen window of up to 480 minutes
-- in ONE grant and had no daily ceiling at all. That was my invented number,
-- flagged as such at the time; the decision has now been made and this brings
-- the schema in line with it.
--
-- Two things change:
--   1. 60 minutes is now a hard per-grant maximum, enforced by a CHECK
--      constraint on the table as well as by the RPC — so it holds even for a
--      direct insert by a future code path that forgets to go through the RPC.
--   2. A rolling 8-hour-per-24-hours ceiling per super admin, across all
--      institutions.
--
-- INTERPRETATION, flagged: the decision says "per day" without defining the
-- window. This uses a ROLLING 24 hours rather than a calendar day, because a
-- calendar day resets at midnight and lets 16 hours of access run from 16:00
-- to 08:00 unbroken. The rolling window is the stricter reading. It is also
-- applied per super admin across all institutions, not per institution.
-- Say the word if either reading should be the looser one.
-- =====================================================================

ALTER TABLE public.super_admin_access_log
  DROP CONSTRAINT IF EXISTS super_admin_access_log_window;

ALTER TABLE public.super_admin_access_log
  ADD CONSTRAINT super_admin_access_log_window
  CHECK (
    expires_at > accessed_at
    AND expires_at <= accessed_at + interval '60 minutes'
  );

COMMENT ON CONSTRAINT super_admin_access_log_window ON public.super_admin_access_log IS
  'locked-decisions 10.20: 60 minutes per grant, enforced at the table so no insert path can exceed it.';


CREATE OR REPLACE FUNCTION public.rpc_super_admin_open_access(
  _school_id         uuid,
  _what_was_accessed text,
  _reason            text,
  _minutes           int DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sa       uuid;
  _log      uuid;
  _min      int := COALESCE(_minutes, 60);
  _used_min numeric;
BEGIN
  SELECT sa.id INTO _sa
    FROM public.super_admins sa
   WHERE sa.account_id = auth.uid() AND sa.revoked_at IS NULL;
  IF _sa IS NULL THEN
    RAISE EXCEPTION 'not a super admin';
  END IF;

  -- 60 minutes per grant (locked-decisions 10.20).
  IF _min < 1 OR _min > 60 THEN
    RAISE EXCEPTION 'an access window is 1 to 60 minutes; requested %', _min;
  END IF;

  IF btrim(COALESCE(_reason, '')) = '' OR btrim(COALESCE(_what_was_accessed, '')) = '' THEN
    RAISE EXCEPTION 'a reason and a statement of what is being accessed are both required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = _school_id) THEN
    RAISE EXCEPTION 'institution % does not exist', _school_id;
  END IF;

  -- 8 hours per rolling 24 hours, per super admin, across all institutions.
  -- Counts the granted window of every log row opened in the last 24 hours,
  -- clipped to that window so a grant straddling the boundary is not
  -- double-counted.
  SELECT COALESCE(SUM(
           EXTRACT(epoch FROM (l.expires_at - GREATEST(l.accessed_at, now() - interval '24 hours')))
         ) / 60.0, 0)
    INTO _used_min
    FROM public.super_admin_access_log l
   WHERE l.super_admin_id = _sa
     AND l.expires_at > now() - interval '24 hours';

  IF _used_min + _min > 480 THEN
    RAISE EXCEPTION
      'daily super-admin access ceiling reached: % minute(s) already granted in the last 24 hours, % more requested, limit is 480',
      round(_used_min), _min;
  END IF;

  INSERT INTO public.super_admin_access_log
    (super_admin_id, school_id, expires_at, what_was_accessed, reason, school_notified_at)
  VALUES (_sa, _school_id, now() + make_interval(mins => _min),
          _what_was_accessed, _reason, now())
  RETURNING id INTO _log;

  -- "Every access is logged, AND the school is notified" (10.20).
  INSERT INTO public.notifications (user_id, type, title, body, school_id)
  SELECT m.account_id,
         'super_admin_access',
         'Support access to your school data',
         'A platform super admin opened access to ' || _what_was_accessed
           || '. Reason given: ' || _reason,
         _school_id
    FROM public.memberships m
   WHERE m.school_id = _school_id
     AND m.status = 'active'
     AND m.role IN ('admin', 'principal');

  RETURN _log;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_super_admin_open_access(uuid, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_super_admin_open_access(uuid, text, text, int) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.super_admin_access_log'::regclass
       AND conname = 'super_admin_access_log_window'
  ) THEN
    RAISE EXCEPTION 'per-grant window constraint missing';
  END IF;

  IF (SELECT count(*) FROM public.super_admin_access_log
       WHERE expires_at > accessed_at + interval '60 minutes') > 0 THEN
    RAISE EXCEPTION 'existing access-log rows exceed the 60 minute per-grant cap';
  END IF;
END $$;
