-- ═══════════════════════════════════════════════════════════════════════════
-- A parent is told once (§10.15, v2 redesign Screen 11)
--
-- The design document reported one notification appearing twice and asked
-- whether it was duplicate EMISSION or duplicate RENDERING, noting that
-- emission "would also affect push notifications and the parent weekly digest —
-- a parent receiving every alert twice is a much larger problem".
--
-- It is emission, and it is live.
--
-- MEASURED 2026-09-10
--
--   933 of 2,867 notification rows are surplus copies (33%).
--   The newest duplicate IS the newest notification in the table.
--   Every duplicate since 1 September goes to ONE account — a parent — and
--   every one is exactly two copies:
--
--     Attendance corrected · Results published · Marks published ·
--     New homework · Exam scheduled
--
--   Two rows, two ids, the same created_at to the microsecond — so one
--   statement wrote both.
--
-- THE CAUSE
--
-- `_notify_student_parents` reaches the parent down TWO paths and notifies on
-- each:
--
--   1. `students.parent_user_id`            — the legacy single-parent column
--   2. `parent_students` -> `parents.user_id` — the join table that replaced it
--
-- A parent present in both is notified twice. And they are always in both:
-- `db:verify-integrity` asserts "every legacy students.parent_user_id link is
-- represented in parent_students", so the overlap is GUARANTEED, not
-- occasional. Measured: both students carrying a legacy link have that same
-- parent in the join table.
--
-- This is the two-homes defect (G9) emitting instead of displaying. The fix is
-- not to pick a path — both are real — but to collect the recipients first and
-- notify each DISTINCT one once.
--
-- WHAT THIS DOES NOT DO. It does not delete the 933 rows already sent. They are
-- what a parent has already seen; rewriting a person's notification history to
-- make a count look better is not a fix. New alerts stop doubling from here.
--
-- Rollback: supabase/migrations/rollback/20260918000000_a_parent_is_told_once.rollback.sql
-- Assertion: verification/caller-privileges/probe39.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_student_parents(
  _student_id uuid, _type text, _title text,
  _body text DEFAULT NULL, _icon text DEFAULT NULL, _link text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _student_user uuid;
  _parent uuid;
BEGIN
  SELECT user_id INTO _student_user FROM public.students WHERE id = _student_id;

  -- Both paths are collected FIRST, then de-duplicated, then notified. A
  -- parent reachable down both used to be told twice.
  FOR _parent IN
    SELECT DISTINCT u.user_id
      FROM (
        SELECT s.parent_user_id AS user_id
          FROM public.students s
         WHERE s.id = _student_id AND s.parent_user_id IS NOT NULL
        UNION
        SELECT p.user_id
          FROM public.parent_students ps
          JOIN public.parents p ON p.id = ps.parent_id
         WHERE ps.student_id = _student_id AND p.user_id IS NOT NULL
      ) u
     WHERE u.user_id IS NOT NULL
       AND u.user_id IS DISTINCT FROM _student_user
  LOOP
    PERFORM public._notify(_parent, _type, _title, _body, _icon, _link);
  END LOOP;
END;
$function$;

DO $verify$
DECLARE _def text; _student uuid; _before int; _after int; _parent uuid;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='_notify_student_parents';
  IF _def NOT LIKE '%SELECT DISTINCT%' THEN
    RAISE EXCEPTION 'ROLLED BACK: the recipient set is not de-duplicated';
  END IF;

  -- A student whose parent IS reachable both ways — the exact case that doubled.
  SELECT s.id, s.parent_user_id INTO _student, _parent
    FROM public.students s
   WHERE s.parent_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.parent_students ps
                   JOIN public.parents p ON p.id = ps.parent_id
                  WHERE ps.student_id = s.id AND p.user_id = s.parent_user_id)
   LIMIT 1;

  IF _student IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no double-linked student to prove this on — '
                    'a check that cannot run is not a check that passed';
  END IF;

  SELECT count(*) INTO _before FROM public.notifications
   WHERE user_id = _parent AND title = 'probe: told once';

  PERFORM public._notify_student_parents(_student, 'test', 'probe: told once');

  SELECT count(*) INTO _after FROM public.notifications
   WHERE user_id = _parent AND title = 'probe: told once';

  -- Clean up the probe rows whatever the outcome.
  DELETE FROM public.notifications WHERE title = 'probe: told once';

  IF _after - _before <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: a double-linked parent got % notification(s), not 1', _after - _before;
  END IF;

  RAISE NOTICE 'a parent reachable down both paths is now notified exactly once.';
END $verify$;
