-- ═══════════════════════════════════════════════════════════════════════════
-- The super admin reached a school's data with no grant and no log entry
--
-- ── THE RULE ─────────────────────────────────────────────────────────────
--
-- §10.20 (docs/locked-decisions.md:611-634) is unusually explicit, because it
-- describes "the single largest concentration of risk in the system":
--
--   · "Unrestricted access to academic data, for support."
--   · "Every access is logged, and the school is notified."
--   · "Access expires automatically: 60 minutes per grant, 8 hours per day."
--   · "THE ACCESS-LOG ROW IS THE GRANT. Unlogged super admin access is not
--      expressible in the schema -- THERE IS NO PATH TO DATA WITHOUT A LOG
--      ENTRY."
--
-- ── THE PATH THAT EXISTED ANYWAY ─────────────────────────────────────────
--
-- `my_accessible_school_ids()` is the tenancy choke point, and it is a UNION of
-- two branches: the caller's own school via `get_my_school_id()`, and schools
-- with a live grant. The grant branch is exactly right -- it joins
-- `super_admin_access_log`, requires `expires_at > now()`, and requires the
-- super admin not be revoked.
--
-- The other branch was the hole. `get_my_school_id()` ends in
--
--     (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
--
-- a last-resort fallback for accounts that hold no membership and no
-- student/teacher/parent row. A super admin is precisely such an account, and
-- the seeded one carries `profiles.school_id = 00000000-…-0001`. Measured:
--
--   | fact                                    | value                 |
--   |-----------------------------------------|-----------------------|
--   | memberships for superadmin@…            | 0                     |
--   | live access-log grants (expires_at>now) | 0                     |
--   | access-log rows, all time               | 0                     |
--   | profiles.school_id                      | school A              |
--
-- So the account reached school A's academic data through a column on its own
-- profile row, with no grant, nothing logged, nothing notified and no expiry.
-- That is the one thing §10.20 says is "not expressible in the schema".
--
-- ── THE FIX, AND WHY IT IS THIS BRANCH ONLY ──────────────────────────────
--
-- Only the profiles fallback is guarded. The earlier branches are left alone
-- deliberately:
--
--   · `active_membership_school_id()` -- `memberships` carries
--     CHECK (role <> 'super_admin'), but nothing stops the PERSON who is a
--     super admin from also holding, say, a teacher membership at one school.
--     Acting in that membership is ordinary school access and must keep
--     working; it is not platform access wearing a disguise.
--   · the students / teachers / parents branches resolve a LOCAL PERSON row.
--     A super admin has none, so the guard would be dead code there.
--
-- Guarding the whole function would therefore break a legitimate dual role
-- while fixing nothing extra. Guarding this branch closes the hole exactly.
--
-- NOT A REVOCATION OF ACCESS. `rpc_super_admin_open_access(school, what,
-- reason, minutes)` already exists and is granted to `authenticated`: a super
-- admin opens a grant, the row IS the log, and `my_accessible_school_ids()`
-- picks it up through the branch that was always correct. What changes is that
-- the grant becomes the ONLY way in, which is what the spec says it is.
--
-- The client half is separate and ships with this: `assertCanConsume` stops
-- refusing super_admin outright (§10.20 gives them read access to academic
-- data), while `assertCanOwn` keeps refusing them -- support is a read, and
-- §10.20's "Can do" list is platform-level, not authoring school records.
-- With no open grant that now yields ZERO ROWS rather than an error, which is
-- the correct answer to "show me a school I have not been granted".
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.active_membership_school_id(),
    (SELECT s.school_id FROM public.students s
      WHERE s.user_id = auth.uid() AND s.school_id IS NOT NULL LIMIT 1),
    (SELECT t.school_id FROM public.teachers t
      WHERE t.user_id = auth.uid() AND t.school_id IS NOT NULL LIMIT 1),
    (SELECT pa.school_id FROM public.parents pa
      WHERE pa.user_id = auth.uid() AND pa.school_id IS NOT NULL LIMIT 1),
    -- §10.20: a super admin's route to a school is the access-log grant and
    -- nothing else. This last-resort fallback exists for ordinary accounts that
    -- hold no membership and no local person row; for a super admin it was an
    -- unlogged, unexpiring path into a tenant, so it is closed to them here.
    -- `my_accessible_school_ids()` still returns every school they hold a live
    -- grant for, through its own branch.
    (SELECT p.school_id FROM public.profiles p
      WHERE p.id = auth.uid() AND NOT public.is_super_admin())
  )
$function$;

COMMENT ON FUNCTION public.get_my_school_id() IS
  'The caller''s own school. For a super admin the profiles.school_id fallback '
  'is deliberately NOT consulted (§10.20: "the access-log row is the grant"); '
  'their access arrives through my_accessible_school_ids()''s grant branch, '
  'which expires. A super admin who also holds an ordinary membership still '
  'resolves that membership''s school through the first branch.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres`, which bypasses RLS and has no auth.uid(), so it proves
-- NOTHING about who reaches which school (rule 6). It checks the shape. The
-- behavioural claims -- that a super admin with no grant resolves no school and
-- reads nothing, that opening a grant lets them in, and that ordinary accounts
-- are untouched -- are asserted as the caller in probe22 (rule 7).
--
-- Comments are stripped first: this file names both `is_super_admin` and
-- `profiles.school_id` throughout its own prose.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _fn    text;
  _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_my_school_id';

  IF _fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: get_my_school_id is missing';
  END IF;

  -- The guard must be on the profiles branch.
  IF _fn !~ 'is_super_admin' THEN
    RAISE EXCEPTION 'ABORT: the profiles fallback is not guarded against super admins';
  END IF;

  -- ...and every other branch must survive, or this closes far more than the hole.
  IF _fn !~ 'active_membership_school_id' THEN
    RAISE EXCEPTION 'ABORT: the membership branch was lost';
  END IF;
  IF _fn !~ 'FROM public\.students' OR _fn !~ 'FROM public\.teachers'
     OR _fn !~ 'FROM public\.parents' THEN
    RAISE EXCEPTION 'ABORT: a local-person branch was lost';
  END IF;
  IF _fn !~ 'FROM public\.profiles' THEN
    RAISE EXCEPTION 'ABORT: the profiles fallback was removed entirely, not guarded';
  END IF;

  -- The grant path must still be the way in.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'rpc_super_admin_open_access') <> 1 THEN
    RAISE EXCEPTION 'ABORT: rpc_super_admin_open_access is missing -- there would be no way to grant access';
  END IF;

  RAISE NOTICE 'the profiles fallback is closed to super admins; behaviour is in probe22.';
END $verify$;
