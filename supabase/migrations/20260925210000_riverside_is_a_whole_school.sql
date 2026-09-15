-- =============================================================================
-- Riverside Public School is a whole school
-- =============================================================================
-- 20260925200000 made Riverside a roster: 12 sections, 224 students, 12 teachers and
-- 26 logins. Only 12 of its 224 students could sign in, no parent could, each
-- section's subjects were the first six of its curriculum by name (so class 9 had
-- Physics but no Science, and class 12 no Mathematics), and each teacher taught one
-- subject in two sections. The owner ruled (2026-09-15, "Then fix all these things by
-- yourself") that it must work like a real school, so that everything can be tested
-- on it. This migration makes it one:
--
--   EVERY STUDENT SIGNS IN — student.<class><section>.<roll>@rps.e2e.test, all 224.
--
--   EVERY STUDENT HAS A PARENT WHO SIGNS IN — parent.<class><section>.<roll>@rps.e2e.test,
--   named by their child's roll: 216 parents, because eight families have two children
--   in the school, and their parent is named by the younger child's roll:
--     8-A 02 & 11-A 10 (Verma)     8-A 10 & 9-B 08 (Mehta)     8-B 05 & 12-B 09 (Gupta)
--     8-B 15 & 12-C 05 (Kapoor)    9-A 07 & 12-A 05 (Iyer)     9-B 04 & 11-B 09 (Nair)
--     10-B 04 & 11-B 07 (Singh)    10-C 04 & 11-A 08 (Jain)
--   Each parent is a father or mother with a phone, linked to their children, and each
--   child's record names that parent.
--
--   EACH SECTION IS TAUGHT ITS STREAM'S FIVE SUBJECTS
--     Classes 8, 9, 10             English, Hindi, Mathematics, Science, Social Science
--     11-A, 12-B, 12-C (science)   English, Physics, Chemistry, Mathematics, Biology
--     11-B, 12-A (commerce)        English, Accountancy, Business Studies, Economics, Mathematics
--
--   EVERY SUBJECT OF EVERY SECTION HAS ONE TEACHER (60), and every class teacher teaches
--   in their own section. Teachers 11 and 12 teach Physics and Chemistry; teacher13
--   (Farah Siddiqui, Biology) joins. teacher_assignments carries the same 60.
--
-- Every login's password: E2eSchool123! — published test accounts on the reserved .test
-- domain, as 20260925200000's are.
--
-- Needs 20260925200000. Idempotent. Adds no academic data: the school is ready to be used.
-- Apply:  npm run db:seed:e2e-school          Remove: npm run db:seed:e2e-school:remove
-- Rollback alone: supabase/migrations/rollback/20260925210000_riverside_is_a_whole_school.rollback.sql
-- =============================================================================

DO $whole$
DECLARE
  _school  constant uuid := '00000000-0000-4000-8000-000000000003';
  -- One bcrypt of the shared password for all the new logins: hashing it 441 times over
  -- would cost seconds for test accounts whose password is published anyway.
  _hash    constant text := extensions.crypt('E2eSchool123!', extensions.gen_salt('bf'));
  _fathers constant text[] := ARRAY['Rakesh','Sanjay','Manoj','Anil','Vijay','Ramesh','Sunil','Ashok','Pradeep','Mahesh'];
  _mothers constant text[] := ARRAY['Rekha','Anjali','Seema','Poonam','Geeta','Shalini','Rashmi','Neelam','Lata','Madhu'];
  _n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = _school) THEN
    RAISE EXCEPTION 'Riverside Public School is not in this database: 20260925200000 comes first';
  END IF;

  ----------------------------------------------------------------------
  -- Who is in the school: the 224 students by the number 20260925200000 gave each
  -- (every id it wrote is md5 of that number), their families, and who teaches what.
  ----------------------------------------------------------------------
  CREATE TEMP TABLE rps_student (
    n int PRIMARY KEY, sid uuid NOT NULL, uid uuid NOT NULL, full_name text NOT NULL, grade int NOT NULL,
    section text NOT NULL, roll int NOT NULL, email text NOT NULL, surname text NOT NULL, family int NOT NULL, born date NOT NULL
  );
  INSERT INTO rps_student
  SELECT g.n, s.id, coalesce(s.user_id, md5('rps-auth-student-' || g.n)::uuid), s.full_name, c.name::int,
         c.section, e.roll_number::int, lower(s.portal_email), split_part(s.full_name, ' ', 2),
         coalesce(f.younger, g.n),
         -- Born in the year their class fits: class 8 in 2012 … class 12 in 2008.
         make_date(2020 - c.name::int, 1, 1) + (g.n * 37) % 365
    FROM generate_series(1, 224) g(n)
    JOIN public.students s ON s.id = md5('rps-student-' || g.n)::uuid AND s.school_id = _school
    JOIN public.classes c ON c.id = s.class_id
    JOIN public.student_enrolments e ON e.id = md5('rps-enrol-' || g.n)::uuid
    -- The eight families with two children here: the elder's family is the younger's.
    LEFT JOIN (VALUES (142, 2), (70, 10), (205, 25), (215, 35), (187, 47), (166, 66), (164, 104), (140, 120)) f(elder, younger)
      ON f.elder = g.n;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 224 THEN
    RAISE EXCEPTION 'Riverside holds % of the 224 students 20260925200000 made', _n;
  END IF;

  CREATE TEMP TABLE rps_parent (
    n int PRIMARY KEY, pid uuid NOT NULL, uid uuid NOT NULL, full_name text NOT NULL,
    relation text NOT NULL, email text NOT NULL, phone text NOT NULL
  );
  INSERT INTO rps_parent
  SELECT s.n, md5('rps-parent-' || s.n)::uuid, md5('rps-auth-parent-' || s.n)::uuid,
         CASE WHEN s.n % 2 = 1 THEN _fathers[(s.n - 1) % 10 + 1] ELSE _mothers[(s.n - 1) % 10 + 1] END || ' ' || s.surname,
         CASE WHEN s.n % 2 = 1 THEN 'father' ELSE 'mother' END,
         'parent.' || s.grade || lower(s.section) || '.' || lpad(s.roll::text, 2, '0') || '@rps.e2e.test',
         '98290' || lpad(s.n::text, 5, '0')
    FROM rps_student s
   WHERE s.family = s.n;

  -- Teacher, subject, the sections they teach it in.
  CREATE TEMP TABLE rps_teaching (
    t int NOT NULL, tid uuid NOT NULL, subject text NOT NULL, grade int NOT NULL, section text NOT NULL, sec uuid NOT NULL, cs uuid
  );
  INSERT INTO rps_teaching (t, tid, subject, grade, section, sec)
  SELECT p.t, md5('rps-teacher-' || p.t)::uuid, p.subject, split_part(x.sec, '-', 1)::int, split_part(x.sec, '-', 2),
         md5('rps-sec-' || x.sec)::uuid
    FROM (VALUES
      (1,  'Mathematics',      ARRAY['8-A','8-B','9-A','9-B','10-A','10-C']),
      (6,  'Mathematics',      ARRAY['10-B','11-A','11-B','12-A','12-B','12-C']),
      (2,  'Science',          ARRAY['8-A','8-B','9-A','9-B']),
      (7,  'Science',          ARRAY['10-A','10-B','10-C']),
      (3,  'English',          ARRAY['8-A','8-B','9-A','9-B','10-A','10-B']),
      (8,  'English',          ARRAY['10-C','11-A','11-B','12-A','12-B','12-C']),
      (4,  'Social Science',   ARRAY['8-A','8-B','9-A','9-B','10-A','10-B','10-C']),
      (5,  'Hindi',            ARRAY['8-A','8-B','9-A','9-B','10-A','10-B','10-C']),
      (9,  'Accountancy',      ARRAY['11-B','12-A']),
      (9,  'Business Studies', ARRAY['11-B']),
      (10, 'Business Studies', ARRAY['12-A']),
      (10, 'Economics',        ARRAY['11-B','12-A']),
      (11, 'Physics',          ARRAY['11-A','12-B','12-C']),
      (12, 'Chemistry',        ARRAY['11-A','12-B','12-C']),
      (13, 'Biology',          ARRAY['11-A','12-B','12-C'])
    ) p(t, subject, sections)
    CROSS JOIN LATERAL unnest(p.sections) x(sec);
  UPDATE rps_teaching r SET cs = s.id
    FROM public.classes c
    JOIN public.class_groups g ON g.id = c.class_group_id
    JOIN public.curriculum_subjects s ON s.curriculum_class_id = g.curriculum_class_id
   WHERE c.id = r.sec AND s.name = r.subject;
  IF EXISTS (SELECT 1 FROM rps_teaching WHERE cs IS NULL) THEN
    RAISE EXCEPTION 'the curriculum has no % for %', (SELECT subject FROM rps_teaching WHERE cs IS NULL LIMIT 1),
      (SELECT grade || '-' || section FROM rps_teaching WHERE cs IS NULL LIMIT 1);
  END IF;

  ----------------------------------------------------------------------
  -- 1. Logins: every student, every parent, teacher13 — an email login each, with its
  --    identity and a profile of this school. The auth.users triggers open the account
  --    (tg_auth_user_sync_account) and link a student to their record (handle_new_user).
  ----------------------------------------------------------------------
  CREATE TEMP TABLE rps_login AS
    SELECT uid, email, full_name FROM rps_student
    UNION ALL SELECT uid, email, full_name FROM rps_parent
    UNION ALL SELECT md5('rps-auth-teacher-13')::uuid, 'teacher13@rps.e2e.test', 'Farah Siddiqui';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  )
  SELECT l.uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', l.email, _hash, now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', l.full_name), now(), now(),
         '', '', '', ''
    FROM rps_login l
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.uid);

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT l.uid, l.uid, jsonb_build_object('sub', l.uid::text, 'email', l.email), 'email', l.uid::text, now(), now(), now()
    FROM rps_login l
   WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = l.uid AND i.provider = 'email');

  INSERT INTO public.profiles (id, full_name, email, school_id)
  SELECT uid, full_name, email, _school FROM rps_login
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, school_id = EXCLUDED.school_id;

  ----------------------------------------------------------------------
  -- 2. Students: each bound to their login, with a date of birth.
  ----------------------------------------------------------------------
  UPDATE public.students st SET user_id = s.uid, date_of_birth = s.born
    FROM rps_student s
   WHERE st.id = s.sid AND (st.user_id IS DISTINCT FROM s.uid OR st.date_of_birth IS DISTINCT FROM s.born);
  PERFORM public._grant_membership(s.uid, _school, 'student', s.sid) FROM rps_student s;

  ----------------------------------------------------------------------
  -- 3. Parents: the person, their link to each child, the child's record naming them,
  --    and their membership bound to the person (my_guardian_student_ids reads it).
  ----------------------------------------------------------------------
  INSERT INTO public.parents (id, school_id, user_id, full_name, email, phone, gender, status, portal_email, relation)
  SELECT p.pid, _school, p.uid, p.full_name, p.email, p.phone,
         (CASE p.relation WHEN 'father' THEN 'male' ELSE 'female' END)::public.gender_type, 'active', p.email, p.relation
    FROM rps_parent p
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
    gender = EXCLUDED.gender, status = 'active', portal_email = EXCLUDED.portal_email, relation = EXCLUDED.relation;

  INSERT INTO public.parent_students (id, school_id, parent_id, student_id, relationship, is_primary)
  SELECT md5('rps-guardian-' || s.n)::uuid, _school, p.pid, s.sid, initcap(p.relation), true
    FROM rps_student s
    JOIN rps_parent p ON p.n = s.family
  ON CONFLICT DO NOTHING;

  UPDATE public.students st
     SET parent_user_id = p.uid, parent_name = p.full_name, parent_mobile = p.phone, parent_portal_email = p.email
    FROM rps_student s
    JOIN rps_parent p ON p.n = s.family
   WHERE st.id = s.sid
     AND (st.parent_user_id, st.parent_name, st.parent_mobile, st.parent_portal_email)
         IS DISTINCT FROM (p.uid, p.full_name, p.phone, p.email);

  PERFORM public._grant_membership(p.uid, _school, 'parent', p.pid) FROM rps_parent p;

  ----------------------------------------------------------------------
  -- 4. Teachers: teacher13 joins; 11 and 12 teach Physics and Chemistry.
  ----------------------------------------------------------------------
  INSERT INTO public.teachers (
    id, school_id, user_id, full_name, email, employee_id, department, subject, subjects, status, joining_date, is_class_teacher
  ) VALUES (
    md5('rps-teacher-13')::uuid, _school, md5('rps-auth-teacher-13')::uuid, 'Farah Siddiqui', 'teacher13@rps.e2e.test',
    'RPS-T-013', 'Biology', 'Biology', ARRAY['Biology'], 'active', DATE '2021-06-01', false
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email, status = 'active';
  PERFORM public._grant_membership(md5('rps-auth-teacher-13')::uuid, _school, 'teacher', md5('rps-teacher-13')::uuid);

  UPDATE public.teachers SET department = 'Physics'   WHERE id = md5('rps-teacher-11')::uuid;
  UPDATE public.teachers SET department = 'Chemistry' WHERE id = md5('rps-teacher-12')::uuid;

  ----------------------------------------------------------------------
  -- 5. Subjects and who teaches them. A section carries exactly the subjects it is
  --    taught; a subject no one references goes (a test or exam on one refuses the
  --    delete, and so this migration, rather than lose it).
  ----------------------------------------------------------------------
  DELETE FROM public.section_subjects ss
   WHERE ss.school_id = _school
     AND NOT EXISTS (SELECT 1 FROM rps_teaching r WHERE r.sec = ss.section_id AND r.cs = ss.curriculum_subject_id);
  INSERT INTO public.section_subjects (id, school_id, section_id, curriculum_subject_id)
  SELECT DISTINCT md5('rps-ss-' || r.grade || '-' || r.section || '-' || r.subject)::uuid, _school, r.sec, r.cs
    FROM rps_teaching r
  ON CONFLICT DO NOTHING;

  DELETE FROM public.teacher_classes tc
   WHERE tc.teacher_id IN (SELECT id FROM public.teachers WHERE school_id = _school)
     AND NOT EXISTS (SELECT 1 FROM rps_teaching r WHERE r.tid = tc.teacher_id AND r.sec = tc.class_id AND r.subject = tc.subject);
  INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
  SELECT r.tid, r.sec, _school, r.subject FROM rps_teaching r
  ON CONFLICT DO NOTHING;

  DELETE FROM public.teacher_assignments ta
   WHERE ta.school_id = _school
     AND NOT EXISTS (SELECT 1 FROM rps_teaching r
                       JOIN public.section_subjects ss ON ss.section_id = r.sec AND ss.curriculum_subject_id = r.cs
                      WHERE ss.id = ta.section_subject_id AND r.tid = ta.teacher_id);
  INSERT INTO public.teacher_assignments (id, school_id, section_subject_id, teacher_id, is_primary, start_date)
  SELECT md5('rps-assignment-' || r.t || '-' || r.grade || '-' || r.section || '-' || r.subject)::uuid,
         _school, ss.id, r.tid, true, DATE '2025-04-01'
    FROM rps_teaching r
    JOIN public.section_subjects ss ON ss.section_id = r.sec AND ss.curriculum_subject_id = r.cs
  ON CONFLICT DO NOTHING;

  UPDATE public.teachers t SET subjects = x.subjects, subject = x.subjects[1]
    FROM (SELECT r.tid, array_agg(DISTINCT r.subject ORDER BY r.subject) AS subjects FROM rps_teaching r GROUP BY r.tid) x
   WHERE t.id = x.tid AND (t.subjects, t.subject) IS DISTINCT FROM (x.subjects, x.subjects[1]);

  DROP TABLE rps_login, rps_teaching, rps_parent, rps_student;

  RAISE NOTICE 'Riverside Public School is a whole school: 224 student logins, 216 parents, 60 subjects taught by 13 teachers';
END
$whole$;

-- =============================================================================
-- Proof
--
-- A whole school is one where each of its people can sign in as themself and reaches
-- what is theirs: every login against the password (and not another), every student
-- and parent bound to their record, every family's children, every section's subjects
-- by name and each with exactly one teacher — and five of its people reading the
-- database under their own row security.
-- =============================================================================

DO $verify$
DECLARE
  _school   constant uuid := '00000000-0000-4000-8000-000000000003';
  _junior   constant text[] := ARRAY['English','Hindi','Mathematics','Science','Social Science'];
  _science  constant text[] := ARRAY['Biology','Chemistry','English','Mathematics','Physics'];
  _commerce constant text[] := ARRAY['Accountancy','Business Studies','Economics','English','Mathematics'];
  _sections constant text[] := ARRAY['8-A','8-B','9-A','9-B','10-A','10-B','10-C','11-A','11-B','12-A','12-B','12-C'];
  _p text; _sec uuid; _want text[]; _got text[]; _role text;
  _n bigint; _m bigint; _k bigint; _j bigint;
BEGIN
  -- 0. Nothing of the build outlives it.
  IF to_regclass('pg_temp.rps_student') IS NOT NULL OR to_regclass('pg_temp.rps_parent') IS NOT NULL
     OR to_regclass('pg_temp.rps_teaching') IS NOT NULL OR to_regclass('pg_temp.rps_login') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the build''s working tables were left behind';
  END IF;

  -- 1. 455 logins — admin, principal, 13 teachers, 224 students, 216 parents — each opening with
  --    the E2E password and not with another, each with its identity and a profile of this school.
  SELECT count(*) INTO _n FROM auth.users u
   WHERE u.email LIKE '%@rps.e2e.test' AND u.email_confirmed_at IS NOT NULL
     AND u.encrypted_password = extensions.crypt('E2eSchool123!', u.encrypted_password);
  IF _n <> 455 THEN
    RAISE EXCEPTION 'ROLLED BACK: % Riverside logins accept the E2E password, expected 455', _n;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.email LIKE '%@rps.e2e.test'
               AND u.encrypted_password = extensions.crypt('not-the-password', u.encrypted_password)) THEN
    RAISE EXCEPTION 'ROLLED BACK: a wrong password opens a Riverside login';
  END IF;
  IF (SELECT count(*) FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
       WHERE u.email LIKE '%@rps.e2e.test' AND i.provider = 'email') <> 455
     OR (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id
          WHERE u.email LIKE '%@rps.e2e.test' AND p.school_id = _school) <> 455 THEN
    RAISE EXCEPTION 'ROLLED BACK: a Riverside login lacks its email identity or its profile of this school';
  END IF;

  -- 2. Every student signs in as themself: a login on their portal email, a student membership
  --    bound to their record — and was born in the year their class fits.
  SELECT count(*) INTO _n
    FROM public.students s
    JOIN auth.users u ON u.id = s.user_id AND u.email = lower(s.portal_email)
    JOIN public.memberships m ON m.account_id = s.user_id AND m.school_id = _school AND m.role = 'student'
                             AND m.status = 'active' AND m.local_person_id = s.id
    JOIN public.classes c ON c.id = s.class_id
   WHERE s.school_id = _school AND extract(year FROM s.date_of_birth) = 2020 - c.name::int;
  IF _n <> 224 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of Riverside''s 224 students sign in as themselves (their login, their bound membership, a date of birth that fits their class)', _n;
  END IF;

  -- 3. Every student has one parent, who signs in and is bound to their record; the student's
  --    record names that parent; eight families have two children, in different classes.
  SELECT count(*) INTO _n
    FROM public.parents p
    JOIN auth.users u ON u.id = p.user_id AND u.email = p.email AND u.email LIKE 'parent.%@rps.e2e.test'
    JOIN public.memberships m ON m.account_id = p.user_id AND m.school_id = _school AND m.role = 'parent'
                             AND m.status = 'active' AND m.local_person_id = p.id
   WHERE p.school_id = _school AND p.relation IN ('father', 'mother') AND p.phone IS NOT NULL;
  IF _n <> 216 OR (SELECT count(*) FROM public.parents WHERE school_id = _school) <> 216 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of Riverside''s parents sign in bound to their record (of %), expected 216 of 216',
      _n, (SELECT count(*) FROM public.parents WHERE school_id = _school);
  END IF;
  SELECT count(*), count(DISTINCT ps.student_id),
         count(*) FILTER (WHERE st.parent_user_id = p.user_id AND st.parent_name = p.full_name
                            AND st.parent_mobile = p.phone AND st.parent_portal_email = p.email
                            AND split_part(st.full_name, ' ', 2) = split_part(p.full_name, ' ', 2))
    INTO _n, _m, _k
    FROM public.parent_students ps
    JOIN public.parents p ON p.id = ps.parent_id AND p.school_id = _school
    JOIN public.students st ON st.id = ps.student_id AND st.school_id = _school
   WHERE ps.school_id = _school;
  IF (_n, _m, _k) IS DISTINCT FROM (224::bigint, 224::bigint, 224::bigint)
     OR (SELECT count(*) FROM public.parent_students WHERE school_id = _school) <> 224 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % parent link(s) for % student(s), % naming their parent on the student''s record; expected 224, 224, 224',
      _n, _m, _k;
  END IF;
  SELECT count(*) FILTER (WHERE kids = 1),
         count(*) FILTER (WHERE kids = 2 AND classes = 2 AND names = 2),
         count(*) FILTER (WHERE NOT (kids = 1 OR (kids = 2 AND classes = 2 AND names = 2)))
    INTO _n, _m, _k
    FROM (SELECT ps.parent_id, count(*) AS kids, count(DISTINCT st.class_id) AS classes, count(DISTINCT st.full_name) AS names
            FROM public.parent_students ps JOIN public.students st ON st.id = ps.student_id
           WHERE ps.school_id = _school GROUP BY ps.parent_id) f;
  IF (_n, _m, _k) IS DISTINCT FROM (208::bigint, 8::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside''s families are % with one child, % with two children in two classes, % otherwise; expected 208, 8, 0',
      _n, _m, _k;
  END IF;

  -- 4. Every section: exactly its stream's five subjects, of its own curriculum; each taught by
  --    exactly one teacher of this school, the same one in teacher_classes and teacher_assignments;
  --    and its class teacher among them.
  FOREACH _p IN ARRAY _sections LOOP
    _sec := md5('rps-sec-' || _p)::uuid;
    _want := CASE WHEN _p IN ('11-A', '12-B', '12-C') THEN _science
                  WHEN _p IN ('11-B', '12-A') THEN _commerce
                  ELSE _junior END;
    SELECT array_agg(cs.name ORDER BY cs.name) INTO _got
      FROM public.section_subjects ss
      JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
      JOIN public.classes c ON c.id = ss.section_id
      JOIN public.class_groups g ON g.id = c.class_group_id AND g.curriculum_class_id = cs.curriculum_class_id
     WHERE ss.section_id = _sec AND ss.school_id = _school;
    IF _got IS DISTINCT FROM _want OR (SELECT count(*) FROM public.section_subjects WHERE section_id = _sec) <> 5 THEN
      RAISE EXCEPTION 'ROLLED BACK: section % carries the subjects %; expected %', _p, _got, _want;
    END IF;
    SELECT count(*) FILTER (WHERE taught = 1 AND assigned = 1 AND same = 1), count(*) INTO _n, _m
      FROM (SELECT (SELECT count(*) FROM public.teacher_classes tc JOIN public.teachers t ON t.id = tc.teacher_id
                     WHERE tc.class_id = _sec AND tc.subject = cs.name AND t.school_id = _school AND t.status = 'active') AS taught,
                   (SELECT count(*) FROM public.teacher_assignments ta
                     WHERE ta.section_subject_id = ss.id AND ta.end_date IS NULL) AS assigned,
                   (SELECT count(*) FROM public.teacher_assignments ta
                      JOIN public.teacher_classes tc ON tc.teacher_id = ta.teacher_id AND tc.class_id = _sec AND tc.subject = cs.name
                     WHERE ta.section_subject_id = ss.id AND ta.end_date IS NULL) AS same
              FROM public.section_subjects ss JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
             WHERE ss.section_id = _sec) x;
    IF _n <> 5 OR _m <> 5 OR (SELECT count(*) FROM public.teacher_classes WHERE class_id = _sec) <> 5 THEN
      RAISE EXCEPTION 'ROLLED BACK: in section %, % of its % subjects have exactly one teacher (the same in teacher_classes and teacher_assignments), and it has % teacher_classes rows; expected 5, 5, 5',
        _p, _n, _m, (SELECT count(*) FROM public.teacher_classes WHERE class_id = _sec);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.teacher_classes tc JOIN public.classes c ON c.id = tc.class_id AND c.class_teacher_id = tc.teacher_id
                    WHERE tc.class_id = _sec) THEN
      RAISE EXCEPTION 'ROLLED BACK: the class teacher of % teaches no subject in it', _p;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.teacher_assignments WHERE school_id = _school) <> 60 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % teacher_assignments rows, expected the 60 subjects of its sections',
      (SELECT count(*) FROM public.teacher_assignments WHERE school_id = _school);
  END IF;
  -- Thirteen teachers, each signing in bound to their record, teaching, and listing what they teach.
  SELECT count(*) FILTER (WHERE t.subjects = (SELECT array_agg(DISTINCT tc.subject ORDER BY tc.subject)
                                                FROM public.teacher_classes tc WHERE tc.teacher_id = t.id)
                            AND t.subject = t.subjects[1]
                            AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = t.user_id AND m.school_id = _school
                                          AND m.role = 'teacher' AND m.status = 'active' AND m.local_person_id = t.id)),
         count(*)
    INTO _n, _m
    FROM public.teachers t WHERE t.school_id = _school AND t.status = 'active';
  IF _n <> 13 OR _m <> 13 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of Riverside''s % teachers sign in bound to their record and list the subjects they teach; expected 13 of 13', _n, _m;
  END IF;

  -- 5. Memberships: exactly these people, and no one else.
  SELECT count(*) FILTER (WHERE role = 'admin'), count(*) FILTER (WHERE role = 'principal'), count(*) FILTER (WHERE role = 'teacher'),
         count(*) FILTER (WHERE role = 'student'), count(*) FILTER (WHERE role = 'parent')
    INTO _n, _m, _k, _j, _p
    FROM public.memberships WHERE school_id = _school AND status = 'active';
  IF (_n, _m, _k, _j, _p::bigint) IS DISTINCT FROM (1::bigint, 1::bigint, 13::bigint, 224::bigint, 216::bigint)
     OR (SELECT count(*) FROM public.memberships WHERE school_id = _school) <> 455 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside memberships are % admin, % principal, % teacher, % student, % parent; expected 1, 1, 13, 224, 216',
      _n, _m, _k, _j, _p;
  END IF;

  -- 6. Five of its people, under their own row security. Inside a savepoint that always ends
  --    by raising P0999.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-parent-2')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE id IN (md5('rps-student-2')::uuid, md5('rps-student-142')::uuid)) INTO _n, _m FROM public.students;
    SELECT count(*) INTO _k FROM public.parents;
    SELECT count(*) INTO _j FROM public.parent_students;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'parent' OR _n <> 2 OR _m <> 2 OR _k <> 1 OR _j <> 2 THEN
      RAISE EXCEPTION 'ROLLED BACK: parent.8a.02@rps.e2e.test (mother of 8-A 02 and 11-A 10) acts as % and reads % student row(s), % of them their children, % parent row(s) and % link(s); expected parent, 2, 2, 1, 2',
        _role, _n, _m, _k, _j;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-parent-1')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE id = md5('rps-student-1')::uuid) INTO _n, _m FROM public.students;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'parent' OR _n <> 1 OR _m <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: parent.8a.01@rps.e2e.test acts as % and reads % student row(s), % of them their child; expected parent, 1, 1',
        _role, _n, _m;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-student-5')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE id = md5('rps-student-5')::uuid) INTO _n, _m FROM public.students;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'student' OR _n <> 1 OR _m <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: student.8a.05@rps.e2e.test, who could not sign in before, acts as % and reads % student row(s), % of them their own; expected student, 1, 1',
        _role, _n, _m;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-teacher-13')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE class_id = md5('rps-sec-8-A')::uuid) INTO _n, _m FROM public.students;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'teacher' OR _n <> 53 OR _m <> 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: teacher13@rps.e2e.test acts as % and reads % students (% of 8-A, which they do not teach); expected teacher, the 53 of 11-A, 12-B and 12-C, 0',
        _role, _n, _m;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-teacher-1')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*), count(*) FILTER (WHERE class_id = md5('rps-sec-10-B')::uuid) INTO _n, _m FROM public.students;
    RESET ROLE;
    IF _n <> 116 OR _m <> 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: teacher01@rps.e2e.test reads % students (% of 10-B, which they do not teach); expected the 116 of 8-A, 8-B, 9-A, 9-B, 10-A and 10-C, 0',
        _n, _m;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify probes rolled back';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;

  RAISE NOTICE 'verify OK: Riverside Public School is a whole school — 455 logins that open with the E2E password and not another; all 224 students bound to their login and born in their class''s year; 216 parents bound to their record, one link per student, the student''s record naming them, 208 families of one child and 8 of two; every section exactly its stream''s five subjects, each with one teacher in teacher_classes and teacher_assignments and the class teacher among them; 13 teachers listing what they teach; memberships 1/1/13/224/216; parent.8a.02 reads their two children, parent.8a.01 their one, student.8a.05 their own row, teacher13 their 53 students and teacher01 their 116';
END
$verify$;
