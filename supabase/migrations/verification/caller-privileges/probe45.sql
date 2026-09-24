-- probe45: practice stays with the student (§10.8), as each real caller.
--
-- Measured 2026-09-18, signed in through PostgREST: the principal, the admin,
-- a teacher, a parent and another student each read a Class 10 student's
-- practice sessions — every question, the answer he chose and whether it was
-- right — from school_activity_feed, and admin and principal read the same
-- from academic_events (20261042000000).
--
-- THE CLAIMS, AND WHAT MAKES EACH ONE MEAN SOMETHING
--   1. an old client's practice event, answer sheet and all, is routed...
--   2. ...and reaches no feed, while a school event still does.   (CONTROL)
--   3. no one else in the school reads a practice row in the feed...
--   4. ...while each of them reads the school event from 2.       (CONTROL)
--   5. admin and principal read no practice event...
--   6. ...while reading the school's other events.                (CONTROL)
--   7. the student still reads his own finished sessions.         (CONTROL)
--
-- Fixtures are chosen by ACTIVE membership: has_role() and
-- active_membership_role() resolve through it, and a fixture without one "is
-- nobody", which would make every refusal here pass vacuously.
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
  school uuid; s_uid uuid; s_id uuid;
  practice_entity uuid := gen_random_uuid();
  control_entity uuid := gen_random_uuid();
  ev uuid; st text; r text; n int;
  w record;
BEGIN
  SELECT s.school_id, s.user_id, s.id INTO school, s_uid, s_id
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role = 'student'
                    AND m.status = 'active' AND m.local_person_id = s.id)
     AND EXISTS (SELECT 1 FROM public.practice_sessions ps
                  WHERE ps.user_id = s.user_id AND ps.finished_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.academic_events e
                  WHERE e.student_id = s.id AND e.event_type LIKE 'practice.%')
   ORDER BY s.user_id = 'd1000003-0001-4000-8000-000000000001' DESC, s.id
   LIMIT 1;
  IF s_uid IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: a membership-holding student with finished practice and practice events','-',
       'found','NOT FOUND — this probe can assert nothing without it','FAIL');
    RETURN;
  END IF;

  -- 1/2. An old client's event, routed by the insert trigger as every event is.
  INSERT INTO public.academic_events (school_id, event_type, entity_type, entity_id, actor_user_id, student_id, payload)
  VALUES (school, 'practice.session.completed', 'practice', practice_entity, s_uid, s_id,
          jsonb_build_object('_attempts', jsonb_build_array(jsonb_build_object('question', 'probe45'))))
  RETURNING id INTO ev;
  SELECT status::text INTO st FROM public.academic_events WHERE id = ev;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an old client''s practice event is routed','router','processed', coalesce(st,'null'),
     CASE WHEN st = 'processed' THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.school_activity_feed WHERE entity_id = practice_entity;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and reaches no activity feed','router','0', n::text, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO public.academic_events (school_id, event_type, entity_type, entity_id, payload)
  VALUES (school, 'probe45.feed_control', 'probe', control_entity, '{}'::jsonb);
  SELECT count(*) INTO n FROM public.school_activity_feed WHERE entity_id = control_entity;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a school event still reaches the feed (positive control)','router','1', n::text,
     CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- 3/4. Everyone else in the school, signed in.
  FOR w IN
    SELECT DISTINCT ON (m.role) m.role::text AS label, m.account_id AS uid
      FROM public.memberships m
     WHERE m.school_id = school AND m.status = 'active' AND m.account_id <> s_uid
       AND m.role::text IN ('principal','admin','teacher','parent','student')
     ORDER BY m.role, m.account_id
  LOOP
    r := pg_temp.as_user(w.uid,
      $q$SELECT count(*)::text FROM public.school_activity_feed WHERE action LIKE 'practice.%'$q$);
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('reads no practice row in the activity feed', w.label, 'OK: 0', r,
       CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
    r := pg_temp.as_user(w.uid, format(
      $q$SELECT count(*)::text FROM public.school_activity_feed WHERE entity_id = %L$q$, control_entity));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...while reading the feed''s school event (positive control)', w.label, 'OK: 1', r,
       CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
  SELECT count(DISTINCT m.role) INTO n FROM public.memberships m
   WHERE m.school_id = school AND m.status = 'active' AND m.account_id <> s_uid
     AND m.role::text IN ('principal','admin','teacher','parent','student');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('every other kind of person in the school was asked','-','5 roles', n::text || ' roles',
     CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL' END);

  -- 5/6. The two roles that read academic_events.
  FOR w IN
    SELECT DISTINCT ON (m.role) m.role::text AS label, m.account_id AS uid
      FROM public.memberships m
     WHERE m.school_id = school AND m.status = 'active' AND m.role::text IN ('principal','admin')
     ORDER BY m.role, m.account_id
  LOOP
    r := pg_temp.as_user(w.uid, format(
      $q$SELECT count(*)::text FROM public.academic_events WHERE school_id = %L AND event_type LIKE 'practice.%%'$q$, school));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('reads no practice event', w.label, 'OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
    r := pg_temp.as_user(w.uid, format(
      $q$SELECT (count(*) > 0)::text FROM public.academic_events WHERE school_id = %L AND event_type NOT LIKE 'practice.%%'$q$, school));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...while reading the school''s other events (positive control)', w.label, 'OK: true', r,
       CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;

  -- 7. The student's own practice is still his.
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT (count(*) > 0)::text FROM public.practice_sessions WHERE user_id = %L AND finished_at IS NOT NULL$q$, s_uid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the student reads his own finished sessions (positive control)','student (owner)','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
