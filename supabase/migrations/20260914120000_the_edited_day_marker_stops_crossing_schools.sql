-- ═══════════════════════════════════════════════════════════════════════════
-- The edited-day marker stops crossing schools, and stops answering anon
-- (§10.19, §10.18)
--
-- `npm run db:verify-integrity` has been reporting this, and nothing had acted
-- on it:
--
--   FAIL  every view in public is security_invoker (inherits the caller's RLS,
--         not the owner's)  -- [{"relname":"attendance_day_edits"}]
--
-- It is the ONLY view in `public` without it — `attendance_current`,
-- `students_current` and `trash` are all `security_invoker=true`. So this view
-- runs as its owner (`postgres`), and RLS on `academic_audit` and
-- `attendance_submissions` does not apply to it at all.
--
-- ── MEASURED, NOT INFERRED FROM THE GRANT TABLE ──────────────────────────
--
-- Asked as each role, 2026-09-08:
--
--   anon (the key in the browser bundle) .... 20 rows, 1 school
--   a student ............................... 20 rows, 1 school
--   the owner (ground truth) ................ 20 rows, 1 school
--
-- Identical. A signed-out visitor sees exactly what the table owner sees. The
-- project currently holds 2 schools and only one of them has any edits, so
-- nothing is crossing schools TODAY — but nothing is stopping it either, and
-- `school_id` is one of the columns the view returns.
--
-- The app is not the hole: `AttendanceService` filters `.eq("school_id", …)`
-- one layer up. That is the same shape as KNOWN_ISSUES 6 — the scoping users
-- experience is applied by the client, and the database admits everything.
--
-- ── WHY IT IS NOT SIMPLY MADE security_invoker ───────────────────────────
--
-- Because that would break the marker for the people who need it. The view
-- reads `academic_audit`, and §10.18 (`locked-decisions.md:154`) makes the
-- audit log ADMIN ONLY — measured: admin 1295 rows, teacher 0, student 0. Flip
-- the flag and a teacher or principal looking at their own class's attendance
-- silently loses the "this day was edited" marker, with every gate still green.
-- That is the same trap as revoking a grant the legitimate role needed.
--
-- So the indirection is deliberate and is now RECORDED rather than implicit:
-- the view is the one surface that turns an admin-only audit trail into a
-- non-privileged fact — "this day changed after submission" — WITHOUT exposing
-- what changed. It returns counts, a submission id and a timestamp. It does not
-- return `previous_value` or `new_value`, which is what §10.18 is protecting.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
-- 1. A tenancy fence INSIDE the view, so running as the owner can no longer
--    mean running without one. `my_accessible_school_ids()` is the same
--    predicate the tenant fences on real tables use.
-- 2. anon loses SELECT. A signed-out visitor has no school, so the fence alone
--    would already empty the result — the grant goes too, because a surface
--    that returns nothing is still a surface that answers.
--
-- `last_edited_by` is kept: the marker is shown next to a figure that moved,
-- and "who" is what makes it actionable for the staff member reading it. It is
-- an account id, not the before/after values.
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
     -- THE FENCE. Everything above this line is the view as it was.
     AND s.school_id IN (SELECT public.my_accessible_school_ids())
   GROUP BY ((aa.metadata ->> 'submission_id'::text))::uuid, s.section_id, s.date, s.school_id;

REVOKE ALL ON public.attendance_day_edits FROM anon;

COMMENT ON VIEW public.attendance_day_edits IS
  'Whether a submitted attendance day was changed afterwards, and by whom -- '
  'counts and a timestamp, never the before/after values. Deliberately NOT '
  'security_invoker: it reads academic_audit, which §10.18 reserves to admin, '
  'so that a teacher or principal can still see that a figure moved without '
  'being given the audit log. Running as the owner means RLS does not apply, '
  'which is why the school fence is written into the view itself.';

-- ── verification: inside the transaction, so a failure rolls back ─────────
DO $verify$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_viewdef('public.attendance_day_edits'::regclass, true) INTO _def;

  IF _def NOT ILIKE '%my_accessible_school_ids%' THEN
    RAISE EXCEPTION 'ABORT: the view came back without its school fence';
  END IF;

  IF has_table_privilege('anon', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: anon can still read the edited-day marker';
  END IF;

  -- POSITIVE CONTROLS. A view that returns nothing to anybody would satisfy
  -- both checks above and would have removed the marker from every screen.
  IF NOT has_table_privilege('authenticated', 'public.attendance_day_edits', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: authenticated LOST the marker -- every attendance screen is affected';
  END IF;

  IF _def NOT ILIKE '%last_edited_by%' OR _def NOT ILIKE '%edit_count%' THEN
    RAISE EXCEPTION 'ABORT: the view lost a column the service reads';
  END IF;

  -- The base table must still be the consolidated audit table; if this view
  -- ever points somewhere else the fence above is fencing the wrong thing.
  IF _def NOT ILIKE '%academic_audit%' THEN
    RAISE EXCEPTION 'ABORT: the view no longer reads academic_audit';
  END IF;

  RAISE NOTICE 'the edited-day marker is school-fenced and anon is out. probe36 asserts it as the caller.';
END $verify$;

COMMIT;
