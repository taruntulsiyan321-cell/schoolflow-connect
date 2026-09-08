-- ═══════════════════════════════════════════════════════════════════════════
-- The database agrees with the service: the edited-day marker is staff-only
-- (§10.18)
--
-- `20260914120000` stopped the marker crossing schools and stopped anon
-- reading it. This closes the half that was left: WHICH ROLES may see it.
--
-- ── TWO HOMES, DISAGREEING (G9) ──────────────────────────────────────────
--
-- The only reader of this view is `AttendanceService.summarizeSchoolDate`, and
-- it opens by refusing everyone else:
--
--     if (!canReadSchoolWide(ctx.role)) {
--       throw new ForbiddenError("School attendance summary is admin/principal-only");
--     }
--
-- `canReadSchoolWide` (services/context.ts:103) is admin, principal or
-- super_admin, and every caller is an admin or principal screen —
-- gurukul-admin/{Dashboard,Classes,Reports} and
-- gurukul-principal/{AttendanceHero,PrincipalLiveAcademic}.
--
-- The database said something else. Measured after 20260914120000:
--
--     anon ....... permission denied          (fixed there)
--     a student .. 20 rows, their own school   <- still reachable
--
-- A student holds a real token and can query the view through PostgREST
-- directly; nothing in the app leads there, which is exactly why it went
-- unnoticed. The service's rule was the only thing enforcing a rule the
-- service describes as absolute.
--
-- ── WHY IN THE VIEW AND NOT IN A POLICY ──────────────────────────────────
--
-- The view is deliberately not `security_invoker` (see 20260914120000: it
-- turns an admin-only audit trail into a non-privileged fact for staff), so
-- RLS never runs for it. A predicate in the view body is the only place this
-- can live, which is the same reason the school fence went there.
--
-- ── NOT A NARROWING OF WHAT STAFF SEE ────────────────────────────────────
--
-- super_admin is included because `canReadSchoolWide` includes it, and the
-- school fence from 20260914120000 still applies on top — a super admin sees
-- only schools `my_accessible_school_ids()` grants them, which §10.20 ties to
-- an audited grant rather than to the role itself.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE VIEW public.attendance_day_edits AS
  SELECT ((aa.metadata ->> 'submission_id'::text))::uuid AS submission_id,
         s.section_id,
         s.date,
         s.school_id,
         count(*) AS edit_count,
         count(DISTINCT ((aa.metadata ->> 'student_id'::text))::uuid) AS students_changed,
         max(aa.created_at) AS last_edited_at,
         (array_agg(aa.actor_user_id ORDER BY aa.created_at DESC))[1] AS last_edited_by
    FROM public.academic_audit aa
    JOIN public.attendance_submissions s
      ON s.id = ((aa.metadata ->> 'submission_id'::text))::uuid
   WHERE aa.entity_type = 'attendance'
     AND aa.metadata ? 'submission_id'
     -- The school fence, from 20260914120000.
     AND s.school_id IN (SELECT public.my_accessible_school_ids())
     -- The role fence: the same set canReadSchoolWide() names.
     AND (public.is_principal_or_admin(auth.uid()) OR (SELECT public.is_super_admin()))
   GROUP BY ((aa.metadata ->> 'submission_id'::text))::uuid, s.section_id, s.date, s.school_id;

COMMENT ON VIEW public.attendance_day_edits IS
  'Whether a submitted attendance day was changed afterwards, and by whom -- '
  'counts and a timestamp, never the before/after values. Deliberately NOT '
  'security_invoker: it reads academic_audit, which §10.18 reserves to admin, '
  'so that a principal can still see that a figure moved without being given '
  'the audit log. Because RLS therefore never runs, BOTH fences live in the '
  'view body: the school (my_accessible_school_ids) and the role (the set '
  'AttendanceService.summarizeSchoolDate already refuses everyone outside).';

-- ── verification ─────────────────────────────────────────────────────────
DO $verify$
DECLARE _def text;
BEGIN
  SELECT pg_get_viewdef('public.attendance_day_edits'::regclass, true) INTO _def;

  IF _def NOT ILIKE '%is_principal_or_admin%' THEN
    RAISE EXCEPTION 'ABORT: the role fence is missing';
  END IF;

  -- The previous migration's fence must survive this one. A view rewrite is
  -- the easiest possible way to drop a predicate nobody was looking at.
  IF _def NOT ILIKE '%my_accessible_school_ids%' THEN
    RAISE EXCEPTION 'ABORT: the school fence from 20260914120000 was lost';
  END IF;

  IF has_table_privilege('anon', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: anon regained the marker';
  END IF;

  -- POSITIVE CONTROLS: the columns the service reads must all still be here,
  -- or the admin dashboard loses the marker and every check above still passes.
  IF _def NOT ILIKE '%last_edited_by%' OR _def NOT ILIKE '%edit_count%'
     OR _def NOT ILIKE '%students_changed%' OR _def NOT ILIKE '%section_id%' THEN
    RAISE EXCEPTION 'ABORT: the view lost a column the service reads';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: authenticated lost SELECT -- staff cannot reach it either now';
  END IF;

  RAISE NOTICE 'the marker is school- AND role-fenced. probe36 asserts both as the caller.';
END $verify$;

COMMIT;
