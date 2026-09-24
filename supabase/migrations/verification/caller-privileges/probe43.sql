-- probe43: the homework journey, end to end, as each real caller.
--
-- docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13": the teacher sets
-- homework for a class they teach; a student of that class hands in ONE image
-- or PDF through `rpc_homework_submit` (no session writes a submission row);
-- the teacher accepts or rejects it through `rpc_homework_decide`. Rewritten
-- for 20260925110000 — the journey this probe used to walk (a typed `content`
-- inserted straight into homework_submissions) no longer exists.
--
-- THE JOURNEY
--   1. a teacher sets homework for a class they teach.         (POSITIVE CONTROL)
--   2. ...and CANNOT set it for a class they do not teach.             <- the fence
--   3. a student of that class SEES it.                        (POSITIVE CONTROL)
--   4. a student of another class does NOT.                            <- the fence
--   5. that student hands in one PDF of their own.             (POSITIVE CONTROL)
--   6. ...and CANNOT write a submission row directly, for anyone.      <- the guard
--   7. ...nor hand in a classmate's file.                              <- the guard
--   8. the teacher reads the hand-in that came back.           (POSITIVE CONTROL)
--   9. a classmate CANNOT read it.                                     <- the fence
--  10. the teacher accepts it.                                 (POSITIVE CONTROL)
--  11. the student CANNOT decide on their own hand-in.                 <- the fence
--
-- The positive controls are what make the refusals mean anything: a chain that
-- inserts nothing and shows nothing satisfies every "cannot" here.
--
-- FIXTURES MUST HOLD AN ACTIVE MEMBERSHIP. `teacher_teaches_class` and
-- `is_my_student_record` both resolve through `active_membership_role()`, which
-- is NULL without one — and NULL denies. Selecting by `ORDER BY id` alone picks
-- an unusable actor and every refusal passes vacuously. probe42 learned this.
--
-- Every write is rolled back — the storage row for the hand-in included.
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
  own_file text; mate_file text;
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

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('fixture: a genuinely UNTAUGHT class exists to test claim 2 against',
     'teacher ' || t_id::text,
     'an untaught class',
     'teaches=' || t_class::text
       || ' | class_teacher_of=' || COALESCE((SELECT class_teacher_of::text FROM public.teachers WHERE id=t_id),'null')
       || ' | untaught picked=' || COALESCE(other_class::text,'(none)'),
     CASE WHEN other_class IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- ── 1. the teacher sets homework (POSITIVE CONTROL) ────────────────────
  r := pg_temp.as_user(t_uid, format(
    $q$WITH i AS (INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
                  VALUES (%L, %L, 'Mathematics', 'probe43 homework', 'Solve Ex 1.1', now() + interval '3 days', 'published')
                  RETURNING 1) SELECT count(*)::text FROM i$q$, t_school, t_class));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a teacher sets homework for a class they teach (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO hw FROM public.homework WHERE title = 'probe43 homework' ORDER BY created_at DESC LIMIT 1;

  -- ── 2. ...but not for a class they do not teach ────────────────────────
  IF other_class IS NOT NULL THEN
    r := pg_temp.as_user(t_uid, format(
      $q$WITH i AS (INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
                    VALUES (%L, %L, 'Mathematics', 'probe43 trespass', 'q', now() + interval '3 days', 'published')
                    RETURNING 1) SELECT count(*)::text FROM i$q$, t_school, other_class));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and NOT for a class they do not teach','teacher','OK: 0 or ERROR', r,
       CASE WHEN r = 'OK: 0' OR r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 3. the student sees it (POSITIVE CONTROL) ──────────────────────────
  r := pg_temp.as_user(s_uid, format($q$SELECT count(*)::text FROM public.homework WHERE id = %L$q$, hw));
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
    r := pg_temp.as_user(outsider_uid, format($q$SELECT count(*)::text FROM public.homework WHERE id = %L$q$, hw));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('a student of another class does NOT see it','student (other class)','OK: 0', r,
       CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 5. the student hands in one PDF (POSITIVE CONTROL) ─────────────────
  -- The upload itself is the Storage API's; the row it leaves is written here,
  -- under each student's own folder, as the bucket's INSERT policy requires.
  own_file  := s_uid::text || '/probe43-hand-in.pdf';
  mate_file := mate_uid::text || '/probe43-hand-in.pdf';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('academic-files', own_file), ('academic-files', mate_file);

  r := pg_temp.as_user(s_uid, format(
    $q$SELECT (public.rpc_homework_submit(%L, %L::jsonb))->>'status'$q$,
    hw, json_build_object('path', own_file, 'name', 'hand-in.pdf', 'mime', 'application/pdf')::text));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the student hands in one PDF of their own (positive control)','student','OK: submitted', r,
     CASE WHEN r = 'OK: submitted' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO sub FROM public.homework_submissions WHERE homework_id = hw AND student_id = s_id;

  -- ── 6. no submission row is written directly, for anyone ───────────────
  IF mate_id IS NOT NULL THEN
    r := pg_temp.as_user(s_uid, format(
      $q$WITH i AS (INSERT INTO public.homework_submissions (homework_id, student_id, school_id, status, file, submitted_at)
                    VALUES (%L, %L, %L, 'submitted', %L::jsonb, now()) RETURNING 1)
         SELECT count(*)::text FROM i$q$,
      hw, mate_id, t_school, json_build_object('path', own_file, 'name', 'x.pdf', 'mime', 'application/pdf')::text));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and CANNOT write a submission row directly (here, as a classmate)','student','ERROR', r,
       CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. ...nor hand in a classmate's file ───────────────────────────────
    r := pg_temp.as_user(s_uid, format(
      $q$SELECT (public.rpc_homework_submit(%L, %L::jsonb))->>'status'$q$,
      hw, json_build_object('path', mate_file, 'name', 'theirs.pdf', 'mime', 'application/pdf')::text));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...nor hand in a classmate''s file','student','ERROR must be one you uploaded', r,
       CASE WHEN r LIKE 'ERROR:%one you uploaded%' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 8. the teacher reads what came back (POSITIVE CONTROL) ─────────────
  r := pg_temp.as_user(t_uid, format(
    $q$SELECT count(*)::text FROM public.homework_submissions WHERE id = %L AND file->>'path' = %L$q$, sub, own_file));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher reads the hand-in and its file (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. a classmate cannot ──────────────────────────────────────────────
  IF mate_uid IS NOT NULL THEN
    r := pg_temp.as_user(mate_uid, format($q$SELECT count(*)::text FROM public.homework_submissions WHERE id = %L$q$, sub));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('a classmate cannot read that hand-in','student (classmate)','OK: 0', r,
       CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 10/11. the teacher decides; the student cannot ─────────────────────
  r := pg_temp.as_user(s_uid, format($q$SELECT (public.rpc_homework_decide(%L, 'accepted'))->>'status'$q$, sub));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the student CANNOT decide on their own hand-in','student','ERROR', r,
     CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(t_uid, format($q$SELECT (public.rpc_homework_decide(%L, 'accepted'))->>'status'$q$, sub));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher accepts the hand-in (positive control)','teacher','OK: accepted', r,
     CASE WHEN r = 'OK: accepted' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
