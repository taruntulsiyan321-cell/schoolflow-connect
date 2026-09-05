-- ═══════════════════════════════════════════════════════════════════════════
-- Rule 28 in the database: each has_role overload states the question it answers
--
-- The two forms are not a wide and a narrow version of one predicate. They ask
-- DIFFERENT QUESTIONS, and can disagree about the same person at the same
-- school on purpose:
--
--   has_role(user, role)              "is this caller ACTING in this role right
--                                     now" — keyed on active_membership_id()
--   has_role(user, role, school)      "does this account HOLD this role at this
--                                     named institution"
--
-- `memberships` is UNIQUE on (account_id, school_id, role), so one account can
-- hold several roles at one institution. Collapsing the two forms would blend
-- them regardless of which is active, which is why 20260905120000 kept both.
--
-- Measured 2026-09-06 on a teacher who also holds a parent membership at the
-- same school (probe13): `has_role/2` for parent is FALSE while she is acting
-- as a teacher, and `has_role/3` for parent at that school is TRUE. Both are
-- correct answers to different questions.
--
-- Comments only. No behaviour changes here, and nothing is granted or revoked.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

COMMENT ON FUNCTION public.has_role(uuid, app_role) IS
  'Is this caller ACTING in this role right now? Self branch is keyed on '
  'active_membership_id(), so only the active membership counts -- an account '
  'holding several roles at one school answers true for one of them at a time. '
  'Cross-account calls delegate to has_role(uuid, app_role, uuid) with '
  'get_my_school_id(); a caller with NO SESSION resolves NULL there and gets '
  'false, which is the correct answer to a question that named no institution. '
  'A service-role client is such a caller: use the three-argument form instead. '
  'Rule 28 -- choose by the question, not by argument count.';

COMMENT ON FUNCTION public.has_role(uuid, app_role, uuid) IS
  'Does this account HOLD this role at this named institution? Does not consult '
  'active_membership_id(), so it answers true for a role the account holds but '
  'is not currently acting in. This is the form for a caller that has no '
  'session and knows which institution it means -- an edge function on a '
  'service-role client. It is not a bypass: a NULL or wrong school is false, '
  'asserted by probe12. Rule 28 -- choose by the question, not by argument '
  'count.';

DO $verify$
BEGIN
  IF (SELECT obj_description(p.oid, 'pg_proc')
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'has_role' AND p.pronargs = 2) IS NULL THEN
    RAISE EXCEPTION 'ABORT: the two-argument has_role carries no comment';
  END IF;
  IF (SELECT obj_description(p.oid, 'pg_proc')
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'has_role' AND p.pronargs = 3) IS NULL THEN
    RAISE EXCEPTION 'ABORT: the three-argument has_role carries no comment';
  END IF;
  -- Both overloads must survive: a COMMENT ON against a dropped signature would
  -- have raised above, but say so rather than relying on that.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'has_role') <> 2 THEN
    RAISE EXCEPTION 'ABORT: has_role no longer has exactly two overloads';
  END IF;
END $verify$;

COMMIT;
