-- probe39: a parent is told once, and no parent stopped being told (§10.15).
--
-- `_notify_student_parents` reached the parent down two paths and notified on
-- each: `students.parent_user_id` (legacy) and `parent_students` -> `parents`
-- (the join table that replaced it). A parent in both got every alert twice,
-- and `db:verify-integrity` asserts they are ALWAYS in both, so it was
-- guaranteed rather than occasional.
--
-- Measured before the fix: 933 of 2,867 rows surplus, and every duplicate since
-- 1 September went to one parent account — attendance, marks, results,
-- homework, exams, two copies each.
--
-- THE CLAIMS
--   1. a parent reachable BOTH ways is notified exactly once.      <- the fix
--   2. a parent reachable ONLY via the join table still gets one.  (POSITIVE)
--   3. a parent reachable ONLY via the legacy column still gets one.(POSITIVE)
--   4. a student is never notified as their own parent.            <- the guard
--   5. a student with no parent link notifies nobody.              <- no invention
--
-- 2 and 3 are the ones that matter. De-duplicating is easy to get wrong in the
-- direction of notifying NOBODY, and a silent stop is worse than a double —
-- a parent who gets two alerts complains, a parent who gets none does not know.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

DO $probe$
DECLARE
  sch      uuid;
  stu_both uuid;   -- parent reachable both ways
  stu_join uuid;   -- parent only in parent_students
  stu_leg  uuid;   -- parent only on students.parent_user_id
  stu_none uuid;   -- no parent at all
  p_both   uuid; p_join uuid; p_leg uuid;
  par_row  uuid;
  before_n int; after_n int;
  _probe_title text := 'probe39: told once';
BEGIN
  SELECT id INTO sch FROM public.schools ORDER BY created_at LIMIT 1;

  -- ── 1. the real case: reachable down both paths ───────────────────────
  SELECT s.id, s.parent_user_id INTO stu_both, p_both
    FROM public.students s
   WHERE s.parent_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.parent_students ps
                   JOIN public.parents p ON p.id = ps.parent_id
                  WHERE ps.student_id = s.id AND p.user_id = s.parent_user_id)
   LIMIT 1;
  IF stu_both IS NULL THEN
    RAISE EXCEPTION 'probe39: no double-linked student — a skipped check is not a passing check';
  END IF;

  SELECT count(*) INTO before_n FROM public.notifications WHERE user_id = p_both AND title = _probe_title;
  PERFORM public._notify_student_parents(stu_both, 'test', _probe_title);
  SELECT count(*) INTO after_n FROM public.notifications WHERE user_id = p_both AND title = _probe_title;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('parent reachable BOTH ways is notified','parent of a double-linked student','1 notification',
     (after_n - before_n)::text || ' notification(s)',
     CASE WHEN after_n - before_n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. join table only (POSITIVE CONTROL) ────────────────────────────
  SELECT s.id INTO stu_join
    FROM public.students s
   WHERE s.parent_user_id IS NULL
     AND EXISTS (SELECT 1 FROM public.parent_students ps
                   JOIN public.parents p ON p.id = ps.parent_id
                  WHERE ps.student_id = s.id AND p.user_id IS NOT NULL)
   LIMIT 1;
  IF stu_join IS NULL THEN
    -- Build one rather than skip: a de-dup that dropped this path would pass
    -- every other claim here.
    SELECT s.id INTO stu_join FROM public.students s WHERE s.parent_user_id IS NULL LIMIT 1;
    SELECT p.id, p.user_id INTO par_row, p_join FROM public.parents p WHERE p.user_id IS NOT NULL LIMIT 1;
    IF stu_join IS NULL OR par_row IS NULL THEN
      RAISE EXCEPTION 'probe39: cannot build a join-only fixture';
    END IF;
    INSERT INTO public.parent_students(parent_id, student_id, school_id)
    VALUES (par_row, stu_join, sch) ON CONFLICT DO NOTHING;
  ELSE
    SELECT p.user_id INTO p_join FROM public.parent_students ps
      JOIN public.parents p ON p.id = ps.parent_id
     WHERE ps.student_id = stu_join AND p.user_id IS NOT NULL LIMIT 1;
  END IF;

  SELECT count(*) INTO before_n FROM public.notifications WHERE user_id = p_join AND title = _probe_title;
  PERFORM public._notify_student_parents(stu_join, 'test', _probe_title);
  SELECT count(*) INTO after_n FROM public.notifications WHERE user_id = p_join AND title = _probe_title;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('parent reachable ONLY via parent_students still notified (positive control)','parent via join table','1 notification',
     (after_n - before_n)::text || ' notification(s)',
     CASE WHEN after_n - before_n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. legacy column only (POSITIVE CONTROL) ─────────────────────────
  SELECT s.id, s.parent_user_id INTO stu_leg, p_leg
    FROM public.students s
   WHERE s.parent_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.parent_students ps
                       JOIN public.parents p ON p.id = ps.parent_id
                      WHERE ps.student_id = s.id AND p.user_id = s.parent_user_id)
   LIMIT 1;
  IF stu_leg IS NULL THEN
    -- Every legacy link is mirrored today, so make one that is not.
    SELECT s.id INTO stu_leg FROM public.students s WHERE s.parent_user_id IS NULL LIMIT 1;
    SELECT p.user_id INTO p_leg FROM public.parents p WHERE p.user_id IS NOT NULL LIMIT 1;
    UPDATE public.students SET parent_user_id = p_leg WHERE id = stu_leg;
    DELETE FROM public.parent_students ps
     WHERE ps.student_id = stu_leg
       AND ps.parent_id IN (SELECT id FROM public.parents WHERE user_id = p_leg);
  END IF;

  SELECT count(*) INTO before_n FROM public.notifications WHERE user_id = p_leg AND title = _probe_title;
  PERFORM public._notify_student_parents(stu_leg, 'test', _probe_title);
  SELECT count(*) INTO after_n FROM public.notifications WHERE user_id = p_leg AND title = _probe_title;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('parent reachable ONLY via students.parent_user_id still notified (positive control)','parent via legacy column','1 notification',
     (after_n - before_n)::text || ' notification(s)',
     CASE WHEN after_n - before_n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a student is not their own parent ─────────────────────────────
  UPDATE public.students SET parent_user_id = user_id
   WHERE id = stu_both AND user_id IS NOT NULL;
  SELECT count(*) INTO before_n FROM public.notifications n
    JOIN public.students s ON s.user_id = n.user_id
   WHERE s.id = stu_both AND n.title = _probe_title;
  PERFORM public._notify_student_parents(stu_both, 'test', _probe_title);
  SELECT count(*) INTO after_n FROM public.notifications n
    JOIN public.students s ON s.user_id = n.user_id
   WHERE s.id = stu_both AND n.title = _probe_title;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student listed as their own parent is NOT notified','student','0 notifications',
     (after_n - before_n)::text || ' notification(s)',
     CASE WHEN after_n - before_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. no link, no invention ─────────────────────────────────────────
  SELECT s.id INTO stu_none
    FROM public.students s
   WHERE s.parent_user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.parent_students ps WHERE ps.student_id = s.id)
   LIMIT 1;
  IF stu_none IS NOT NULL THEN
    SELECT count(*) INTO before_n FROM public.notifications WHERE title = _probe_title;
    PERFORM public._notify_student_parents(stu_none, 'test', _probe_title);
    SELECT count(*) INTO after_n FROM public.notifications WHERE title = _probe_title;
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('a student with no parent link notifies nobody','-','0 notifications',
       (after_n - before_n)::text || ' notification(s)',
       CASE WHEN after_n - before_n = 0 THEN 'PASS' ELSE 'FAIL' END);
  END IF;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
