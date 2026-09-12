-- ═══════════════════════════════════════════════════════════════════════════
-- A classmate's mark is readable once you have sat the test (rule 13, G9)
--
-- ── MEASURED AS THE CALLER ────────────────────────────────────────────────
--
-- Signed in as a student of 10-A who had sat NEITHER of the two tests in her
-- own section, with nothing but her own session:
--
--     select count(*) from public.test_marks;      ->  6
--     select count(*) from public.test_attempts;   ->  0
--
-- Six rows: every classmate's mark on both tests, including the one she had not
-- opened yet. The attempts table refuses her correctly (`test_attempts_self` is
-- `user_id = auth.uid()`), so this is `test_marks_read` alone:
--
--     USING (test_id IN (SELECT my_readable_test_ids())
--         OR test_id IN (SELECT my_manageable_test_ids())
--         OR student_id IN (SELECT my_own_or_children_student_ids()))
--
-- `my_readable_test_ids()` returns every test of the caller's own section — it
-- is the enumerator behind "a student can see their class's tests", which is
-- right for the TEST and wrong for its MARKS. Combined with a policy keyed on
-- the test rather than on the student, it hands a student the whole class's
-- marks for a paper they have not written.
--
-- ── WHY THIS IS A DEFECT AND NOT JUST RULE 13 AT WORK ────────────────────
--
-- Rule 13, as corrected on 2026-09-11, does say marks are shared within the
-- class: "a rank is a position among classmates and cannot be shown without
-- comparing to them." This migration does not argue with that — the leaderboard
-- built in 20260920030000 shows exactly those marks, by name.
--
-- What that fence adds, and this policy lacked, is WHEN. A student reads the
-- board once they have handed their own paper in. Before that, the class's
-- marks tell them how hard the paper is, who has already sat it and what score
-- to expect — and 20260916020000 closed the same shape on the report for the
-- same reason. A rule that holds on one surface and not on the table under it
-- is not a rule.
--
-- ── ONE DEFINITION, RE-USED ──────────────────────────────────────────────
--
-- The new third branch is `can_read_test_leaderboard(test_id)` — the function
-- that already decides "may this caller see this class's marks for this test",
-- covering the teachers of the section, the principal (2026-09-12 ruling), and
-- a student who has submitted. Restating that predicate inside a policy would
-- be the same rule in two homes (G9); calling it means the day it changes, it
-- changes here too.
--
-- Every existing reader keeps what it had:
--
--   the student themselves     `my_own_or_children_student_ids()`   unchanged
--   a parent, for their child  same branch                          unchanged
--   the teachers of a section  `my_manageable_test_ids()`, and the
--                              leaderboard fence admits them again  unchanged
--   the test's author          `my_manageable_test_ids()`           unchanged
--   admin                      `my_manageable_test_ids()` (has_role admin)
--                                                                   unchanged
--   principal                  leaderboard fence                    unchanged
--   a classmate who has sat it leaderboard fence                    unchanged
--   a classmate who has NOT    ————                                 REMOVED
--
-- Rollback: supabase/migrations/rollback/
--           20260920060000_a_classmates_mark_is_readable_once_you_have_sat_the_test.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS test_marks_read ON public.test_marks;

CREATE POLICY test_marks_read ON public.test_marks
  FOR SELECT
  USING (
    -- the staff who own or teach it, and the office through has_role(admin)
    test_id IN (SELECT public.my_manageable_test_ids())
    -- the student themselves, and a parent of that child
    OR student_id IN (SELECT public.my_own_or_children_student_ids())
    -- everyone the leaderboard admits: the teachers of that section, the
    -- principal, and a classmate who has already handed their own paper in
    OR public.can_read_test_leaderboard(test_id)
  );

-- ── Proof, as the callers ─────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _section uuid; _teacher uuid; _principal uuid;
  _sitter uuid; _sitter_user uuid; _watcher uuid; _watcher_user uuid;
  _test uuid; _q uuid; _att uuid;
  _before int; _own_before int; _after int; _teacher_sees int; _principal_sees int;
BEGIN
  SELECT ss.school_id, ss.id, ss.section_id, t.user_id
    INTO _school, _ss, _section, _teacher
    FROM public.section_subjects ss
    JOIN public.teacher_classes tc ON tc.class_id = ss.section_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = ss.school_id
   WHERE (SELECT count(*) FROM public.students s
           WHERE s.class_id = ss.section_id AND s.user_id IS NOT NULL AND s.deleted_at IS NULL) >= 2
   LIMIT 1;
  SELECT m.account_id INTO _principal FROM public.memberships m
   WHERE m.role = 'principal' AND m.status = 'active' AND m.school_id = _school LIMIT 1;
  SELECT id, user_id INTO _sitter, _sitter_user FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id, user_id INTO _watcher, _watcher_user FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL AND id <> _sitter ORDER BY id LIMIT 1;

  IF _watcher IS NULL OR _principal IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need two signed-up students and an active principal (watcher=%, principal=%)', _watcher, _principal;
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, total_marks,
                            status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920060000] whose marks', 1, 1, 'published', 'class_test', 600, now())
  RETURNING id INTO _test;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
  VALUES (_test, _school, 0, 'mcq', 'verify: 9 + 1 ?', '["10","11"]', '{"indexes":[0]}', 1)
  RETURNING id INTO _q;

  -- One student sits it. The other does not.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _sitter_user, 'role','authenticated')::text, true);
  _att := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _q, 'response', '{"indexes":[0]}'::jsonb)));

  -- 1. The student who has NOT sat it reads none of this test's marks…
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _watcher_user, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _before FROM public.test_marks WHERE test_id = _test;
  --    …and still reads their OWN marks on other tests (the branch that must
  --    survive: without this, a policy refusing everything would pass claim 1).
  SELECT count(*) INTO _own_before FROM public.test_marks WHERE student_id = _watcher;
  RESET ROLE;

  IF _before <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: a student who has not sat the test read % mark row(s) of it', _before;
  END IF;

  -- 2. Once they sit it, they read the class's marks — the leaderboard rule.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _watcher_user, 'role','authenticated')::text, true);
  _att := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _q, 'response', '{"indexes":[1]}'::jsonb)));
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _after FROM public.test_marks WHERE test_id = _test;
  RESET ROLE;

  IF _after <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: after sitting it they read % mark row(s), expected both', _after;
  END IF;

  -- 3. The teacher and the principal are unaffected.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _teacher_sees FROM public.test_marks WHERE test_id = _test;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _principal, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _principal_sees FROM public.test_marks WHERE test_id = _test;
  RESET ROLE;

  IF _teacher_sees <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher of the section reads % of 2 mark rows', _teacher_sees;
  END IF;
  IF _principal_sees <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: the principal reads % of 2 mark rows', _principal_sees;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.student_mistakes WHERE source_id = _test;
  DELETE FROM public.test_marks WHERE test_id = _test;
  DELETE FROM public.test_answers WHERE attempt_id IN
    (SELECT id FROM public.test_attempts WHERE test_id = _test);
  DELETE FROM public.test_attempts WHERE test_id = _test;
  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: 0 marks before sitting (own rows still %), both after, teacher 2, principal 2',
    _own_before;
END
$verify$;
