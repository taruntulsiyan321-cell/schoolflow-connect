-- probe43: the homework journey, end to end, as each real caller.
--
-- "A teacher assigns homework to his class, the student attempts it and sends
-- it." That is the product in one sentence, and nothing had ever proved it
-- works as the actual signed-in people rather than as `postgres`.
--
-- The pieces all exist — 51 homework rows, 145 submissions, policies for
-- teacher-manage and student-own, triggers for late-marking and due-date
-- locking. What was missing is evidence that the chain HOLDS at every hop and
-- REFUSES at every boundary.
--
-- THE JOURNEY
--   1. a teacher assigns homework to a class they teach.       (POSITIVE CONTROL)
--   2. ...and CANNOT assign to a class they do not teach.              <- the fence
--   3. a student of that class SEES it.                        (POSITIVE CONTROL)
--   4. a student of another class does NOT.                            <- the fence
--   5. that student sends their own submission.                (POSITIVE CONTROL)
--   6. ...and CANNOT send one as a classmate.                          <- the guard
--   7. the teacher reads the submission that came back.        (POSITIVE CONTROL)
--   8. a classmate CANNOT read it.                                     <- the fence
--
-- The four positive controls are what make the four refusals mean anything: a
-- chain that inserts nothing and shows nothing satisfies every "cannot" here.
--
-- FIXTURES MUST HOLD AN ACTIVE MEMBERSHIP. `teacher_teaches_class` and
-- `is_my_student_record` both resolve through `active_membership_role()`, which
-- is NULL without one — and NULL denies. Only 12 of 52 students and 3 teachers
-- hold one, so selecting by `ORDER BY id` picks an unusable actor and every
-- refusal passes vacuously. probe42 learned this the hard way.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;

DO $probe$
DECLARE
  t_id uuid; t_uid uuid; t_class uuid; t_school uuid;
  other_class uuid;
  s_id uuid; s_uid uuid;
  mate_id uuid; mate_uid uuid;
  outsider_uid uuid;
  hw uuid; sub uuid;
  r text;
BEGIN
  -- A teacher who holds an active teacher membership AND teaches a class that
  -- contains at least two students who hold active student memberships.
  SELECT t.id, t.user_id, tc.class_id, t.school_id
    INTO t_id, t_uid, t_class, t_school
    FROM public.teachers t
    JOIN public.teacher_classes tc ON tc.teacher_id = t.id
   WHERE EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = t.user_id AND m.role='teacher'
                    AND m.status='active' AND m.local_person_id = t.id)
     AND (SELECT count(*) FROM public.students s
           WHERE s.class_id = tc.class_id AND s.deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM public.memberships m2
                          WHERE m2.account_id = s.user_id AND m2.role='student'
                            AND m2.status='active' AND m2.local_person_id = s.id)) >= 2
   LIMIT 1;

  IF t_id IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: a membership-holding teacher with 2 membership-holding students','-',
       'found','NOT FOUND — this probe can assert nothing without it','FAIL');
    RETURN;
  END IF;

  SELECT s.id, s.user_id INTO s_id, s_uid
    FROM public.students s
   WHERE s.class_id = t_class AND s.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role='student'
                    AND m.status='active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  SELECT s.id, s.user_id INTO mate_id, mate_uid
    FROM public.students s
   WHERE s.class_id = t_class AND s.deleted_at IS NULL AND s.id <> s_id
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role='student'
                    AND m.status='active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  -- a class this teacher does NOT teach, in the same school
  -- Genuinely untaught: not in teacher_classes AND not their class_teacher_of.
  -- `teacher_teaches_class` honours both, so excluding only the first would
  -- hand this probe a class the teacher legitimately owns and the refusal
  -- below would read as a hole when it is not.
  SELECT c.id INTO other_class
    FROM public.classes c
   WHERE c.school_id = t_school AND c.id <> t_class
     AND NOT EXISTS (SELECT 1 FROM public.teacher_classes tc
                      WHERE tc.teacher_id = t_id AND tc.class_id = c.id)
     AND c.id IS DISTINCT FROM (SELECT class_teacher_of FROM public.teachers WHERE id = t_id)
   ORDER BY c.id LIMIT 1;

  -- State the actors. A probe that does not say who it tested cannot be
  -- re-checked, and the claim below turns on whether `other_class` is genuinely
  -- untaught — including via `teachers.class_teacher_of`, which
  -- `teacher_teaches_class` honours as a second path.
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('fixture: a genuinely UNTAUGHT class exists to test claim 2 against',
     'teacher ' || t_id::text,
     'an untaught class',
     'teaches=' || t_class::text
       || ' | class_teacher_of=' || COALESCE((SELECT class_teacher_of::text FROM public.teachers WHERE id=t_id),'null')
       || ' | untaught picked=' || COALESCE(other_class::text,'(none)'),
     CASE WHEN other_class IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- ── 1. the teacher assigns (POSITIVE CONTROL) ──────────────────────────
  r := pg_temp.as_user(t_uid, format(
    $q$WITH i AS (INSERT INTO public.homework (class_id, title, due_date, school_id, created_by, subject)
                  VALUES (%L, 'probe43 homework', current_date + 3, %L, %L, 'Mathematics')
                  RETURNING 1) SELECT count(*)::text FROM i$q$, t_class, t_school, t_uid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a teacher assigns homework to a class they teach (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO hw FROM public.homework WHERE title = 'probe43 homework' ORDER BY created_at DESC LIMIT 1;

  -- ── 2. ...but not to a class they do not teach ─────────────────────────
  IF other_class IS NOT NULL THEN
    r := pg_temp.as_user(t_uid, format(
      $q$WITH i AS (INSERT INTO public.homework (class_id, title, due_date, school_id, created_by, subject)
                    VALUES (%L, 'probe43 trespass', current_date + 3, %L, %L, 'Mathematics')
                    RETURNING 1) SELECT count(*)::text FROM i$q$, other_class, t_school, t_uid));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and NOT to a class they do not teach','teacher','OK: 0 or ERROR', r,
       CASE WHEN r = 'OK: 0' OR r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 3. the student sees it (POSITIVE CONTROL) ──────────────────────────
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT count(*)::text FROM public.homework WHERE id = %L$q$, hw));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student of that class sees the homework (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a student elsewhere does not ────────────────────────────────────
  SELECT s.user_id INTO outsider_uid
    FROM public.students s
   WHERE s.deleted_at IS NULL AND s.class_id IS DISTINCT FROM t_class
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role='student'
                    AND m.status='active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;
  IF outsider_uid IS NOT NULL THEN
    r := pg_temp.as_user(outsider_uid, format(
      $q$SELECT count(*)::text FROM public.homework WHERE id = %L$q$, hw));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('a student of another class does NOT see it','student (other class)','OK: 0', r,
       CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 5. the student sends it back (POSITIVE CONTROL) ────────────────────
  r := pg_temp.as_user(s_uid, format(
    $q$WITH i AS (INSERT INTO public.homework_submissions (homework_id, student_id, content, school_id)
                  VALUES (%L, %L, 'probe43 answer', %L) RETURNING 1)
       SELECT count(*)::text FROM i$q$, hw, s_id, t_school));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the student sends their own submission (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO sub FROM public.homework_submissions
   WHERE homework_id = hw AND student_id = s_id ORDER BY created_at DESC LIMIT 1;

  -- ── 6. ...but not on a classmate's behalf ──────────────────────────────
  IF mate_id IS NOT NULL THEN
    r := pg_temp.as_user(s_uid, format(
      $q$WITH i AS (INSERT INTO public.homework_submissions (homework_id, student_id, content, school_id)
                    VALUES (%L, %L, 'probe43 forged', %L) RETURNING 1)
         SELECT count(*)::text FROM i$q$, hw, mate_id, t_school));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and CANNOT send one as a classmate','student','OK: 0 or ERROR', r,
       CASE WHEN r = 'OK: 0' OR r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 7. the teacher reads what came back (POSITIVE CONTROL) ─────────────
  r := pg_temp.as_user(t_uid, format(
    $q$SELECT count(*)::text FROM public.homework_submissions WHERE id = %L$q$, sub));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher reads the submission (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. a classmate cannot ──────────────────────────────────────────────
  IF mate_uid IS NOT NULL THEN
    r := pg_temp.as_user(mate_uid, format(
      $q$SELECT count(*)::text FROM public.homework_submissions WHERE id = %L$q$, sub));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('a classmate cannot read that submission','student (classmate)','OK: 0', r,
       CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  END IF;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
