-- ═══════════════════════════════════════════════════════════════════════════
-- THE SCHOOL'S ACTIVITY FEED IS FOR STAFF
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 61. activity_feed_select_family admitted any account holding
-- the student or parent role to EVERY school_activity_feed row of its school:
-- not their own family's rows, all of them. The feed copies each academic
-- event's payload — marks.published (marks obtained), attendance.* (each
-- day's status), homework decisions, test.attempt.completed (scores) — so any
-- student or parent, signed in, could read every classmate's marks and
-- attendance over PostgREST. Measured 2026-10-01: 10,690 rows.
--
-- RULED (the owner, 2026-10-01: "fix everything"; the most private reading,
-- and the one the product already lives by): the feed is the school's staff
-- view. No student or parent screen reads it — the admin dashboard is its one
-- reader — and every student and parent figure comes from its own table,
-- fenced to its own rows. The family policy is dropped; the staff policy
-- (admin, principal, teacher, a granted super admin) is unchanged.
--
-- The app stops subscribing students and parents to the feed's realtime
-- changes in the same change (AcademicLiveProvider): RLS now delivers them
-- none, and the subscription only ever bumped "all" — every table they need
-- has a subscription of its own.
--
-- ROLLBACK: rollback/20261134000000_the_school_feed_is_for_staff.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY activity_feed_select_family ON public.school_activity_feed;

-- ── THE PROOF, signed in as the demo school's real accounts ───────────────
--   1. the student and the parent read no feed row;
--   2. CONTROL — the teacher and the principal of the same school read rows;
--   3. CONTROL — the feed holds rows of that school, so 1 is not an empty table.
DO $proof$
DECLARE
  _school uuid := '00000000-0000-4000-8000-000000000001';
  _who record; _n bigint; _fail text := '';
BEGIN
  SELECT count(*) INTO _n FROM public.school_activity_feed WHERE school_id = _school;
  IF _n = 0 THEN RAISE EXCEPTION 'NO FIXTURE: the demo school has no feed rows'; END IF;

  FOR _who IN
    SELECT u.id, x.label, x.expect_rows
      FROM (VALUES ('arjun.mehta@wisdomcampus.com', 'student', false),
                   ('mehta.parent@wisdomcampus.com', 'parent', false),
                   ('priya.sharma@wisdomcampus.com', 'teacher', true),
                   ('principal@wisdomcampus.com', 'principal', true)) AS x(email, label, expect_rows)
      LEFT JOIN auth.users u ON u.email = x.email
  LOOP
    IF _who.id IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: the demo % is missing', _who.label; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _who.id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.school_activity_feed;
    RESET ROLE;
    IF _who.expect_rows AND _n = 0 THEN
      _fail := _fail || format('the %s reads no feed row (the control failed); ', _who.label);
    ELSIF NOT _who.expect_rows AND _n <> 0 THEN
      _fail := _fail || format('the %s still reads %s feed row(s); ', _who.label, _n);
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _fail <> '' THEN RAISE EXCEPTION 'school feed proof: %', _fail; END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261134000000_the_school_feed_is_for_staff')
ON CONFLICT (version) DO NOTHING;

COMMIT;
