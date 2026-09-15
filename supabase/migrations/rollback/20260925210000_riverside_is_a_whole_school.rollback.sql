-- Rollback for 20260925210000_riverside_is_a_whole_school.
--
-- Returns Riverside Public School (00000000-0000-4000-8000-000000000003) to the roster
-- 20260925200000 made: 26 logins (the admin, the principal, teachers 01–12 and roll 1 of
-- each section), no parents, each section's first six curriculum subjects by name, and each
-- teacher on their own section's first subject and the next section's second. So it removes
-- what 20260925210000 added — 212 student logins, 216 parents with their logins and links,
-- teacher13 with their login, students' dates of birth, the 60 subject assignments — and
-- puts back what it replaced.
--
-- AND EVERYTHING WRITTEN INTO THE SCHOOL SINCE. What an end-to-end run writes cannot stand
-- without what 20260925210000 made — a test is set on a subject it gave a section, a parent
-- it linked is notified, a student it gave a login hands in — so every row of the school
-- outside its roster tables goes: homework and hand-ins, attendance, tests, exams and marks,
-- notifications, events, XP, battles. That is the state 20260925200000's own proof describes.
-- Files handed in stay in storage: `storage.objects` refuses a SQL delete.
--
-- NEVER ANOTHER SCHOOL: rows are chosen by this school's id, an account goes only when it
-- holds no membership in any other school, and the proof compares every other school's rows
-- before and after.
--
-- `npm run db:seed:e2e-school:remove` applies this, then 20260925200000's rollback.

-- Every other school's rows, to prove afterwards that none of them moved.
CREATE TEMP TABLE rps_rollback_others AS
SELECT c.table_name, 0::bigint AS n
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
 WHERE c.table_schema = 'public' AND c.column_name = 'school_id';

DO $count_others$
DECLARE _t record; _n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = '00000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'ABORT: Riverside Public School is not in this database, so there is nothing to roll back';
  END IF;
  FOR _t IN SELECT table_name FROM rps_rollback_others LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id IS DISTINCT FROM $1', _t.table_name)
      INTO _n USING '00000000-0000-4000-8000-000000000003'::uuid;
    UPDATE rps_rollback_others SET n = _n WHERE table_name = _t.table_name;
  END LOOP;
END
$count_others$;

DO $rollback$
DECLARE
  _school constant uuid := '00000000-0000-4000-8000-000000000003';
  -- The roster: what 20260925200000 wrote, and what this migration changed in it.
  _roster constant text[] := ARRAY['schools', 'academic_years', 'class_groups', 'classes', 'teachers', 'students',
    'student_enrolments', 'student_academic_profiles', 'section_subjects', 'teacher_classes', 'teacher_assignments',
    'parents', 'parent_students', 'memberships', 'profiles'];
  -- Teachers 01–12's departments as 20260925200000 made them, each teaching that one subject.
  _tdepts constant text[] := ARRAY['Mathematics', 'Science', 'English', 'Social Science', 'Hindi', 'Mathematics',
    'Science', 'English', 'Commerce', 'Commerce', 'Computer Science', 'Physical Education'];
  _keep uuid[];
  _uids uuid[];
  _t record;
  _n bigint;
  _pass int;
  _blocked int;
  _deleted bigint;
BEGIN
  -- The 26 logins 20260925200000 made stay.
  SELECT array_agg(k) INTO _keep
    FROM (SELECT md5('rps-auth-admin')::uuid AS k
          UNION ALL SELECT md5('rps-auth-principal')::uuid
          UNION ALL SELECT md5('rps-auth-teacher-' || i)::uuid FROM generate_series(1, 12) i
          UNION ALL SELECT md5('rps-auth-student-' || g.n)::uuid
                      FROM generate_series(1, 224) g(n)
                      JOIN public.student_enrolments e ON e.id = md5('rps-enrol-' || g.n)::uuid AND e.roll_number = '1') x;
  IF cardinality(_keep) <> 26 THEN
    RAISE EXCEPTION 'ABORT: 20260925200000''s 26 logins cannot be told apart (% found), so nothing is removed', cardinality(_keep);
  END IF;

  -- The accounts that go: every other Riverside login and member, and no one who belongs anywhere else.
  SELECT coalesce(array_agg(DISTINCT u.id), ARRAY[]::uuid[]) INTO _uids
    FROM (SELECT account_id AS id FROM public.memberships WHERE school_id = _school
          UNION
          SELECT id FROM auth.users WHERE email LIKE '%@rps.e2e.test') u
   WHERE u.id <> ALL (_keep)
     AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = u.id AND m.school_id <> _school);

  -- 1. Everything written into the school outside its roster, pass after pass: a foreign key
  --    between two of these tables only decides the order, and a delete that fires an event
  --    leaves a row the next pass collects. Done when a whole pass removes nothing and nothing refuses.
  FOR _pass IN 1..15 LOOP
    _blocked := 0;
    _deleted := 0;
    FOR _t IN
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'school_id' AND c.table_name <> ALL (_roster)
       ORDER BY c.table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE school_id = $1', _t.table_name) USING _school;
        GET DIAGNOSTICS _n = ROW_COUNT;
        _deleted := _deleted + _n;
      EXCEPTION WHEN foreign_key_violation THEN
        _blocked := _blocked + 1;
      END;
    END LOOP;
    EXIT WHEN _blocked = 0 AND _deleted = 0;
  END LOOP;

  -- 2. Parents, with their links; students back to roll 1's logins, with no parent or date of birth.
  DELETE FROM public.parent_students WHERE school_id = _school;
  DELETE FROM public.parents WHERE school_id = _school;
  UPDATE public.students
     SET user_id = CASE WHEN user_id = ANY (_keep) THEN user_id END,
         parent_user_id = NULL, parent_name = NULL, parent_mobile = NULL, parent_portal_email = NULL, date_of_birth = NULL
   WHERE school_id = _school
     AND (user_id <> ALL (_keep) OR parent_user_id IS NOT NULL OR parent_name IS NOT NULL OR parent_mobile IS NOT NULL
          OR parent_portal_email IS NOT NULL OR date_of_birth IS NOT NULL);

  -- 3. Teaching as 20260925200000 made it.
  DELETE FROM public.teacher_assignments WHERE school_id = _school;
  DELETE FROM public.teacher_classes
   WHERE school_id = _school OR teacher_id IN (SELECT id FROM public.teachers WHERE school_id = _school);

  -- Each section: the first six subjects of its curriculum by name, under the ids 20260925200000 gave them.
  DELETE FROM public.section_subjects ss
   WHERE ss.school_id = _school
     AND NOT EXISTS (SELECT 1
                       FROM public.classes c
                       JOIN public.class_groups g ON g.id = c.class_group_id
                       CROSS JOIN LATERAL (SELECT cs.id FROM public.curriculum_subjects cs
                                            WHERE cs.curriculum_class_id = g.curriculum_class_id
                                            ORDER BY cs.name LIMIT 6) s
                      WHERE c.id = ss.section_id AND s.id = ss.curriculum_subject_id);
  INSERT INTO public.section_subjects (id, school_id, section_id, curriculum_subject_id)
  SELECT md5('rps-ss-' || c.name || '-' || c.section || '-' || s.rn)::uuid, _school, c.id, s.id
    FROM public.classes c
    JOIN public.class_groups g ON g.id = c.class_group_id
    CROSS JOIN LATERAL (SELECT cs.id, row_number() OVER (ORDER BY cs.name) AS rn
                          FROM public.curriculum_subjects cs
                         WHERE cs.curriculum_class_id = g.curriculum_class_id
                         ORDER BY cs.name LIMIT 6) s
   WHERE c.school_id = _school
  ON CONFLICT DO NOTHING;

  -- Each class teacher: the first subject of their own section; each teacher: the second subject of the next section.
  INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
  SELECT c.class_teacher_id, c.id, _school,
         (SELECT cs.name FROM public.curriculum_subjects cs WHERE cs.curriculum_class_id = g.curriculum_class_id ORDER BY cs.name LIMIT 1)
    FROM public.classes c
    JOIN public.class_groups g ON g.id = c.class_group_id
   WHERE c.school_id = _school AND c.class_teacher_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
  SELECT md5('rps-teacher-' || t.i)::uuid, c.id, _school,
         (SELECT cs.name FROM public.curriculum_subjects cs WHERE cs.curriculum_class_id = g.curriculum_class_id ORDER BY cs.name OFFSET 1 LIMIT 1)
    FROM generate_series(1, 12) t(i)
    JOIN public.classes c
      ON c.id = md5('rps-sec-' || (ARRAY['8-B','8-A','9-B','9-A','10-B','10-C','10-A','11-B','11-A','12-B','12-C','12-A'])[t.i])::uuid
    JOIN public.class_groups g ON g.id = c.class_group_id
  ON CONFLICT DO NOTHING;

  -- Teacher13 goes; 01–12 teach their department again.
  DELETE FROM public.teachers
   WHERE school_id = _school AND id <> ALL (ARRAY(SELECT md5('rps-teacher-' || i)::uuid FROM generate_series(1, 12) i));
  UPDATE public.teachers t
     SET department = _tdepts[i], subject = _tdepts[i], subjects = ARRAY[_tdepts[i]]
    FROM generate_series(1, 12) i
   WHERE t.id = md5('rps-teacher-' || i)::uuid;

  -- 4. The accounts that go: their own rows that carry no school (sessions, identifiers, tokens,
  --    notifications written without one), their memberships, profiles and logins. user_roles is
  --    frozen read-only and never held a Riverside row.
  IF cardinality(_uids) > 0 THEN
    FOR _pass IN 1..8 LOOP
      _blocked := 0;
      _deleted := 0;
      FOR _t IN
        SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema = 'public' AND c.column_name IN ('user_id', 'account_id') AND c.data_type = 'uuid'
           AND c.table_name NOT IN ('accounts', 'user_roles') AND c.table_name <> ALL (_roster)
         ORDER BY c.table_name
      LOOP
        BEGIN
          EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)', _t.table_name, _t.column_name) USING _uids;
          GET DIAGNOSTICS _n = ROW_COUNT;
          _deleted := _deleted + _n;
        EXCEPTION WHEN foreign_key_violation THEN
          _blocked := _blocked + 1;
        END;
      END LOOP;
      EXIT WHEN _blocked = 0 AND _deleted = 0;
    END LOOP;

    DELETE FROM public.memberships WHERE account_id = ANY (_uids);
    DELETE FROM public.profiles WHERE id = ANY (_uids);
    DELETE FROM public.accounts WHERE id = ANY (_uids);
    DELETE FROM auth.identities WHERE user_id = ANY (_uids);
    DELETE FROM auth.users WHERE id = ANY (_uids);
  END IF;
  -- A Riverside membership of someone who also belongs elsewhere: the account stays, the membership does not.
  DELETE FROM public.memberships WHERE school_id = _school AND account_id <> ALL (_keep);

  RAISE NOTICE 'Riverside Public School returned to its roster (% account(s) removed)', cardinality(_uids);
END
$rollback$;

DO $verify$
DECLARE
  _school constant uuid := '00000000-0000-4000-8000-000000000003';
  _roster constant text[] := ARRAY['schools', 'academic_years', 'class_groups', 'classes', 'teachers', 'students',
    'student_enrolments', 'student_academic_profiles', 'section_subjects', 'teacher_classes', 'teacher_assignments',
    'parents', 'parent_students', 'memberships', 'profiles'];
  _tdepts constant text[] := ARRAY['Mathematics', 'Science', 'English', 'Social Science', 'Hindi', 'Mathematics',
    'Science', 'English', 'Commerce', 'Commerce', 'Computer Science', 'Physical Education'];
  _t record;
  _n bigint; _m bigint; _k bigint; _j bigint;
  _left text := '';
  _moved text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = _school) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside Public School is gone; this rollback returns it to its roster';
  END IF;

  -- 1. The 26 logins of 20260925200000 and no other; its memberships, bound to their people.
  IF (SELECT count(*) FROM auth.users WHERE email LIKE '%@rps.e2e.test') <> 26
     OR (SELECT count(*) FROM public.profiles WHERE email LIKE '%@rps.e2e.test') <> 26 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % login(s) and % profile(s); expected the 26 of 20260925200000',
      (SELECT count(*) FROM auth.users WHERE email LIKE '%@rps.e2e.test'),
      (SELECT count(*) FROM public.profiles WHERE email LIKE '%@rps.e2e.test');
  END IF;
  SELECT count(*) FILTER (WHERE m.role = 'admin'), count(*) FILTER (WHERE m.role = 'principal'),
         count(*) FILTER (WHERE m.role = 'teacher' AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = m.local_person_id AND t.user_id = m.account_id)),
         count(*) FILTER (WHERE m.role = 'student' AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = m.local_person_id AND s.user_id = m.account_id))
    INTO _n, _m, _k, _j
    FROM public.memberships m WHERE m.school_id = _school AND m.status = 'active';
  IF (_n, _m, _k, _j) IS DISTINCT FROM (1::bigint, 1::bigint, 12::bigint, 12::bigint)
     OR (SELECT count(*) FROM public.memberships WHERE school_id = _school) <> 26 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside memberships are % admin, % principal, % teacher, % student (bound to their person) of %; expected 1, 1, 12, 12 of 26',
      _n, _m, _k, _j, (SELECT count(*) FROM public.memberships WHERE school_id = _school);
  END IF;

  -- 2. No parents; 224 students, 12 of them signing in, none naming a parent or a date of birth.
  SELECT count(*), count(*) FILTER (WHERE s.user_id IS NOT NULL AND e.roll_number = '1'), count(*) FILTER (WHERE s.user_id IS NOT NULL),
         count(*) FILTER (WHERE s.parent_user_id IS NOT NULL OR s.parent_name IS NOT NULL OR s.parent_mobile IS NOT NULL
                            OR s.parent_portal_email IS NOT NULL OR s.date_of_birth IS NOT NULL)
    INTO _n, _m, _k, _j
    FROM public.students s
    LEFT JOIN public.student_enrolments e ON e.student_id = s.id AND e.to_date IS NULL
   WHERE s.school_id = _school;
  IF (_n, _m, _k, _j) IS DISTINCT FROM (224::bigint, 12::bigint, 12::bigint, 0::bigint)
     OR EXISTS (SELECT 1 FROM public.parents WHERE school_id = _school)
     OR EXISTS (SELECT 1 FROM public.parent_students WHERE school_id = _school) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % students, % roll-1 logins of % logins, % naming a parent or birth date, % parents; expected 224, 12 of 12, 0, 0',
      _n, _m, _k, _j, (SELECT count(*) FROM public.parents WHERE school_id = _school);
  END IF;

  -- 3. Teachers 01–12 in their departments; each on two sections; no assignments.
  IF (SELECT count(*) FROM public.teachers t JOIN generate_series(1, 12) i ON t.id = md5('rps-teacher-' || i)::uuid
       WHERE t.school_id = _school AND t.department = _tdepts[i] AND t.subject = _tdepts[i] AND t.subjects = ARRAY[_tdepts[i]]) <> 12
     OR (SELECT count(*) FROM public.teachers WHERE school_id = _school) <> 12 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside''s teachers are not teachers 01–12 in the departments 20260925200000 gave them';
  END IF;
  IF (SELECT count(*) FROM public.teacher_classes WHERE school_id = _school) <> 24
     OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.school_id = _school
                  AND (SELECT count(*) FROM public.teacher_classes tc WHERE tc.teacher_id = t.id) <> 2)
     OR EXISTS (SELECT 1 FROM public.teacher_assignments WHERE school_id = _school) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside''s teaching is % teacher_classes row(s) and % assignment(s); expected 24 (two per teacher) and 0',
      (SELECT count(*) FROM public.teacher_classes WHERE school_id = _school),
      (SELECT count(*) FROM public.teacher_assignments WHERE school_id = _school);
  END IF;

  -- 4. Each section: exactly the first six subjects of its curriculum by name.
  SELECT count(*) INTO _n
    FROM public.classes c
    JOIN public.class_groups g ON g.id = c.class_group_id
    CROSS JOIN LATERAL (SELECT cs.id FROM public.curriculum_subjects cs WHERE cs.curriculum_class_id = g.curriculum_class_id
                         ORDER BY cs.name LIMIT 6) s
   WHERE c.school_id = _school;
  SELECT count(*) INTO _m FROM public.section_subjects WHERE school_id = _school;
  SELECT count(*) INTO _k
    FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id
    JOIN public.class_groups g ON g.id = c.class_group_id
    CROSS JOIN LATERAL (SELECT cs.id, row_number() OVER (ORDER BY cs.name) AS rn FROM public.curriculum_subjects cs
                         WHERE cs.curriculum_class_id = g.curriculum_class_id ORDER BY cs.name LIMIT 6) s
   WHERE ss.school_id = _school AND s.id = ss.curriculum_subject_id
     AND ss.id = md5('rps-ss-' || c.name || '-' || c.section || '-' || s.rn)::uuid;
  IF _m <> _n OR _k <> _n THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside''s sections carry % subject row(s), % of them its curriculum''s first six under 20260925200000''s ids; expected % and %',
      _m, _k, _n, _n;
  END IF;

  -- 5. Nothing of the school outside its roster; no other school's row moved.
  FOR _t IN SELECT table_name, n FROM rps_rollback_others ORDER BY table_name LOOP
    IF _t.table_name <> ALL (_roster) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', _t.table_name) INTO _n USING _school;
      IF _n > 0 THEN _left := _left || format(' %s=%s', _t.table_name, _n); END IF;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id IS DISTINCT FROM $1', _t.table_name) INTO _n USING _school;
    IF _n <> _t.n THEN _moved := _moved || format(' %s %s→%s', _t.table_name, _t.n, _n); END IF;
  END LOOP;
  IF _left <> '' THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside rows remain outside its roster:%', _left;
  END IF;
  IF _moved <> '' THEN
    RAISE EXCEPTION 'ROLLED BACK: rows of another school changed:%', _moved;
  END IF;

  RAISE NOTICE 'rollback OK: Riverside Public School is its roster again — the 26 logins of 20260925200000 with their memberships, 224 students of whom roll 1 sign in and none names a parent, teachers 01–12 in their departments on two sections each, each section its curriculum''s first six subjects, nothing written into the school outside that; no other school''s row changed';
END
$verify$;

DROP TABLE rps_rollback_others;
