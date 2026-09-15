-- =============================================================================
-- E2E SCHOOL STRUCTURE — Riverside Public School
-- =============================================================================
-- Real organization for end-to-end testing of the whole app.
--
-- Applied as a MIGRATION by the owner's ruling of 2026-09-15 ("apply this SQL in a
-- migration in Supabase, because it will create a real organizational structure in
-- our app"). It was the fixture supabase/fixtures/E2E_SCHOOL_STRUCTURE.sql (main,
-- 34a7167); this file is now its one home and the fixture is gone, so the two
-- cannot drift. The SQL below is that fixture unchanged; what this file adds is the
-- proof at the end.
--
-- INTENTIONALLY EXCLUDES (no demo academic noise):
--   practice_sessions, question_attempts, student_xp, battles, mistakes,
--   recovery_assignments, revision_queue, homework, attendance, fees,
--   exams, marks, tests, report_cards, bookmarks, etc.
--
-- Roster only: school → academic year → 5 class groups → sections →
-- teachers → students → enrolments → section_subjects → memberships + logins.
--
-- Layout:
--   Class 8  — sections A,B     — 20+20 = 40 students
--   Class 9  — sections A,B     — 22+22 = 44 students
--   Class 10 — sections A,B,C   — 16+16+16 = 48 students
--   Class 11 — sections A,B     — 25+25 = 50 students
--   Class 12 — sections A,B,C   — 14+14+14 = 42 students
--   Total: 12 sections, 224 students, 12 teachers, 1 principal, 1 school admin
--
-- Logins (password for all: E2eSchool123!):
--   admin@rps.e2e.test
--   principal@rps.e2e.test
--   teacher01@rps.e2e.test … teacher12@rps.e2e.test  (class teachers)
--   student.<grade><section>.01@rps.e2e.test          (roll 1 of each section)
-- These are test accounts on the reserved .test domain, for the E2E suite
-- (e2e-evidence/zz-riverside-homework.spec.ts); the password is deliberately
-- shared and published, exactly as the fixture carried it.
--
-- Other students exist as person records with portal_email set (no auth yet).
-- No parent accounts: the organisation is roster-only.
--
-- School id: 00000000-0000-4000-8000-000000000003
-- Idempotent: md5 labels + ON CONFLICT. Safe to re-run.
-- Apply: npm run db:seed:e2e-school          (this migration, through apply-one-migration.mjs)
-- Remove: npm run db:seed:e2e-school:remove  (supabase/migrations/rollback/20260925200000_riverside_public_school_is_a_real_organisation.rollback.sql)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public._e2e_upsert_auth_user(
  _id uuid,
  _email text,
  _password text,
  _full_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $helper$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      _id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(_email),
      extensions.crypt(_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _full_name),
      now(), now(),
      '', '', '', ''
    );
  ELSE
    UPDATE auth.users SET
      email = lower(_email),
      encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = jsonb_build_object('full_name', _full_name),
      updated_at = now()
    WHERE id = _id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = _id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      _id, _id,
      jsonb_build_object('sub', _id::text, 'email', lower(_email)),
      'email', _id::text,
      now(), now(), now()
    );
  END IF;
END;
$helper$;

DO $e2e$
DECLARE
  _school   uuid := '00000000-0000-4000-8000-000000000003';
  _ay       uuid := md5('rps-ay-2025-26')::uuid;
  _pw       text := 'E2eSchool123!';
  _yr       text := '2025-26';
  _board    uuid;
  _u_admin  uuid := md5('rps-auth-admin')::uuid;
  _u_prin   uuid := md5('rps-auth-principal')::uuid;
  _cg       uuid;
  _cc       uuid;
  _sec      uuid;
  _tid      uuid;
  _uid      uuid;
  _sid      uuid;
  _grade    int;
  _section  text;
  _nstud    int;
  _tidx     int := 0;
  _gidx     int;
  _r        int;
  _global   int := 0;
  _fname    text;
  _lname    text;
  _fullname text;
  _email    text;
  _subj     text;
  _subj_n   int;
  _firsts   text[] := ARRAY[
    'Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan',
    'Ananya','Diya','Aadhya','Pari','Myra','Anika','Sara','Ira','Navya','Kiara',
    'Kabir','Rudra','Atharv','Shaurya','Dhruv','Kartik','Rohan','Yash','Nikhil','Dev',
    'Meera','Isha','Nisha','Kavya','Riya','Sneha','Pooja','Neha','Tanvi','Aisha'
  ];
  _lasts    text[] := ARRAY[
    'Sharma','Verma','Patel','Singh','Gupta','Nair','Iyer','Reddy','Joshi','Mehta',
    'Khan','Das','Rao','Malhotra','Kapoor','Chopra','Bhat','Pillai','Desai','Jain'
  ];
  _tnames   text[] := ARRAY[
    'Priya Sharma','Rajesh Verma','Anita Desai','Suresh Nair','Meena Iyer',
    'Vikram Joshi','Kavita Reddy','Amit Patel','Sunita Gupta','Rohan Mehta',
    'Deepa Pillai','Nikhil Rao'
  ];
  _tdepts   text[] := ARRAY[
    'Mathematics','Science','English','Social Science','Hindi',
    'Mathematics','Science','English','Commerce','Commerce',
    'Computer Science','Physical Education'
  ];
  -- grade, section, student count
  _plan     int[][] := ARRAY[
    ARRAY[8, 1, 20],  -- 8-A
    ARRAY[8, 2, 20],  -- 8-B
    ARRAY[9, 1, 22],  -- 9-A
    ARRAY[9, 2, 22],  -- 9-B
    ARRAY[10, 1, 16], -- 10-A
    ARRAY[10, 2, 16], -- 10-B
    ARRAY[10, 3, 16], -- 10-C
    ARRAY[11, 1, 25], -- 11-A
    ARRAY[11, 2, 25], -- 11-B
    ARRAY[12, 1, 14], -- 12-A
    ARRAY[12, 2, 14], -- 12-B
    ARRAY[12, 3, 14]  -- 12-C
  ];
  _students_n bigint;
  _teachers_n bigint;
  _classes_n  bigint;
BEGIN
  SELECT id INTO _board FROM public.boards WHERE code = 'rbse' LIMIT 1;
  IF _board IS NULL THEN
    INSERT INTO public.boards (name, code) VALUES ('RBSE', 'rbse')
    ON CONFLICT (code) DO NOTHING
    RETURNING id INTO _board;
    SELECT id INTO _board FROM public.boards WHERE code = 'rbse' LIMIT 1;
  END IF;

  ----------------------------------------------------------------------
  -- Institution + year
  ----------------------------------------------------------------------
  INSERT INTO public.schools (
    id, name, slug, is_active, board, stream, status,
    session_start_date, session_end_date, academic_year,
    email, phone, principal_name, address
  ) VALUES (
    _school,
    'Riverside Public School',
    'riverside-public',
    true,
    'rbse',
    'science',
    'active',
    DATE '2025-04-01',
    DATE '2026-03-31',
    _yr,
    'office@rps.e2e.test',
    '01411234567',
    'Sunita Menon',
    'Sector 12, Educational City, Jaipur'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    is_active = true,
    board = EXCLUDED.board,
    stream = EXCLUDED.stream,
    status = 'active',
    principal_name = EXCLUDED.principal_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    session_start_date = EXCLUDED.session_start_date,
    session_end_date = EXCLUDED.session_end_date,
    academic_year = EXCLUDED.academic_year;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (_ay, _school, _yr, DATE '2025-04-01', DATE '2026-03-31', true)
  ON CONFLICT (id) DO UPDATE SET
    is_current = true,
    starts_on = EXCLUDED.starts_on,
    ends_on = EXCLUDED.ends_on;

  -- Ensure only this year is current for RPS
  UPDATE public.academic_years
     SET is_current = (id = _ay)
   WHERE school_id = _school;

  ----------------------------------------------------------------------
  -- Ensure curriculum classes exist for grades 8–12
  ----------------------------------------------------------------------
  FOR _grade IN 8..12 LOOP
    INSERT INTO public.curriculum_classes (board_id, label, level)
    VALUES (_board, 'Class ' || _grade, _grade)
    ON CONFLICT (board_id, level) DO NOTHING;
  END LOOP;

  ----------------------------------------------------------------------
  -- Admin + principal auth
  ----------------------------------------------------------------------
  PERFORM public._e2e_upsert_auth_user(_u_admin, 'admin@rps.e2e.test', _pw, 'Ravi Krishnan');
  PERFORM public._e2e_upsert_auth_user(_u_prin,  'principal@rps.e2e.test', _pw, 'Sunita Menon');

  INSERT INTO public.profiles (id, full_name, email, school_id) VALUES
    (_u_admin, 'Ravi Krishnan', 'admin@rps.e2e.test', _school),
    (_u_prin,  'Sunita Menon',  'principal@rps.e2e.test', _school)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    school_id = EXCLUDED.school_id;

  PERFORM public._grant_membership(_u_admin, _school, 'admin');
  PERFORM public._grant_membership(_u_prin,  _school, 'principal');

  ----------------------------------------------------------------------
  -- Teachers (12) — one class teacher per section
  ----------------------------------------------------------------------
  FOR _tidx IN 1..12 LOOP
    _tid := md5('rps-teacher-' || _tidx)::uuid;
    _uid := md5('rps-auth-teacher-' || _tidx)::uuid;
    _email := 'teacher' || lpad(_tidx::text, 2, '0') || '@rps.e2e.test';
    _fullname := _tnames[_tidx];

    PERFORM public._e2e_upsert_auth_user(_uid, _email, _pw, _fullname);

    INSERT INTO public.profiles (id, full_name, email, school_id)
    VALUES (_uid, _fullname, _email, _school)
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      school_id = EXCLUDED.school_id;

    INSERT INTO public.teachers (
      id, school_id, user_id, full_name, email, employee_id,
      department, subject, subjects, status, joining_date, is_class_teacher
    ) VALUES (
      _tid, _school, _uid, _fullname, _email,
      'RPS-T-' || lpad(_tidx::text, 3, '0'),
      _tdepts[_tidx],
      _tdepts[_tidx],
      ARRAY[_tdepts[_tidx]],
      'active',
      DATE '2020-06-01' + ((_tidx - 1) * 30),
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      department = EXCLUDED.department,
      subject = EXCLUDED.subject,
      subjects = EXCLUDED.subjects,
      status = 'active',
      is_class_teacher = true;

    PERFORM public._grant_membership(_uid, _school, 'teacher', _tid);
  END LOOP;

  ----------------------------------------------------------------------
  -- Class groups + sections + students
  ----------------------------------------------------------------------
  FOR _gidx IN 1..array_length(_plan, 1) LOOP
    _grade   := _plan[_gidx][1];
    _section := chr(64 + _plan[_gidx][2]); -- 1→A, 2→B, 3→C
    _nstud   := _plan[_gidx][3];
    _tidx    := _gidx;
    _tid     := md5('rps-teacher-' || _tidx)::uuid;
    _sec     := md5('rps-sec-' || _grade || '-' || _section)::uuid;
    _cg      := md5('rps-cg-' || _grade)::uuid;

    SELECT id INTO _cc
      FROM public.curriculum_classes
     WHERE board_id = _board AND level = _grade
     LIMIT 1;

    IF _cc IS NULL THEN
      RAISE EXCEPTION 'E2E_SCHOOL: missing curriculum_classes for Class %', _grade;
    END IF;

    INSERT INTO public.class_groups (id, school_id, academic_year_id, curriculum_class_id, label)
    VALUES (_cg, _school, _ay, _cc, 'Class ' || _grade)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.classes (
      id, school_id, name, section, academic_year, academic_year_id,
      class_group_id, class_teacher_id, is_active, kind, display_name, category, capacity
    ) VALUES (
      _sec, _school, _grade::text, _section, _yr, _ay,
      _cg, _tid, true, 'class',
      'Class ' || _grade || '-' || _section,
      CASE WHEN _grade >= 11 THEN 'Senior Secondary' ELSE 'Secondary' END,
      _nstud + 5
    )
    ON CONFLICT (id) DO UPDATE SET
      class_teacher_id = EXCLUDED.class_teacher_id,
      class_group_id = EXCLUDED.class_group_id,
      academic_year_id = EXCLUDED.academic_year_id,
      display_name = EXCLUDED.display_name,
      is_active = true,
      capacity = EXCLUDED.capacity;

    UPDATE public.teachers
       SET class_teacher_of = _sec, is_class_teacher = true
     WHERE id = _tid;

    -- Subjects for the section (up to 6 from curriculum)
    INSERT INTO public.section_subjects (id, school_id, section_id, curriculum_subject_id)
    SELECT md5('rps-ss-' || _grade || '-' || _section || '-' || s.rn)::uuid,
           _school, _sec, s.id
      FROM (
        SELECT id, row_number() OVER (ORDER BY name) AS rn
          FROM public.curriculum_subjects
         WHERE curriculum_class_id = _cc
         ORDER BY name
         LIMIT 6
      ) s
    ON CONFLICT (id) DO NOTHING;

    SELECT count(*) INTO _subj_n
      FROM public.section_subjects WHERE section_id = _sec;

    -- Class teacher teaches first subject; rotate remaining teachers onto subjects
    IF _subj_n > 0 THEN
      SELECT name INTO _subj
        FROM public.curriculum_subjects
       WHERE curriculum_class_id = _cc
       ORDER BY name
       LIMIT 1;

      INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
      VALUES (_tid, _sec, _school, _subj)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Students in this section
    FOR _r IN 1.._nstud LOOP
      _global := _global + 1;
      _sid := md5('rps-student-' || _global)::uuid;
      _fname := _firsts[((_global - 1) % array_length(_firsts, 1)) + 1];
      _lname := _lasts[((_global - 1) % array_length(_lasts, 1)) + 1];
      _fullname := _fname || ' ' || _lname;
      _email := 'student.' || _grade || lower(_section) || '.' || lpad(_r::text, 2, '0') || '@rps.e2e.test';

      INSERT INTO public.students (
        id, school_id, academic_year_id, full_name, admission_number,
        class_id, status, enrolment_date, portal_email, gender
      ) VALUES (
        _sid, _school, _ay, _fullname,
        'RPS-' || _grade || _section || '-' || lpad(_r::text, 3, '0'),
        _sec, 'active', DATE '2025-04-01', _email,
        CASE WHEN ((_global % 2) = 0) THEN 'female'::public.gender_type
             ELSE 'male'::public.gender_type END
      )
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        class_id = EXCLUDED.class_id,
        academic_year_id = EXCLUDED.academic_year_id,
        portal_email = EXCLUDED.portal_email,
        status = 'active';

      INSERT INTO public.student_enrolments (
        id, school_id, student_id, academic_year_id, section_id, roll_number, from_date
      ) VALUES (
        md5('rps-enrol-' || _global)::uuid,
        _school, _sid, _ay, _sec, _r::text, DATE '2025-04-01'
      )
      ON CONFLICT (id) DO NOTHING;

      -- Login only for roll 1 of each section (12 accounts) — enough for E2E,
      -- rest remain roster-only with portal_email for later linking.
      IF _r = 1 THEN
        _uid := md5('rps-auth-student-' || _global)::uuid;
        PERFORM public._e2e_upsert_auth_user(_uid, _email, _pw, _fullname);

        INSERT INTO public.profiles (id, full_name, email, school_id)
        VALUES (_uid, _fullname, _email, _school)
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          school_id = EXCLUDED.school_id;

        UPDATE public.students SET user_id = _uid WHERE id = _sid;
        PERFORM public._grant_membership(_uid, _school, 'student', _sid);
      END IF;
    END LOOP;
  END LOOP;

  -- Cross-assign: each teacher also covers one subject on the "next" section
  INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
  SELECT md5('rps-teacher-' || t.i)::uuid,
         md5('rps-sec-' || p.grade || '-' || p.section)::uuid,
         _school,
         (
           SELECT cs.name
             FROM public.curriculum_subjects cs
             JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id
            WHERE cc.board_id = _board AND cc.level = p.grade
            ORDER BY cs.name
            OFFSET 1 LIMIT 1
         )
    FROM generate_series(1, 12) t(i)
    JOIN LATERAL (
      SELECT
        (ARRAY[8,8,9,9,10,10,10,11,11,12,12,12])[t.i] AS grade,
        (ARRAY['B','A','B','A','B','C','A','B','A','B','C','A'])[t.i] AS section
    ) p ON true
   WHERE (
           SELECT cs.name
             FROM public.curriculum_subjects cs
             JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id
            WHERE cc.board_id = _board AND cc.level = p.grade
            ORDER BY cs.name
            OFFSET 1 LIMIT 1
         ) IS NOT NULL
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO _students_n FROM public.students WHERE school_id = _school;
  SELECT count(*) INTO _teachers_n FROM public.teachers WHERE school_id = _school;
  SELECT count(*) INTO _classes_n  FROM public.classes  WHERE school_id = _school;

  IF _students_n < 220 OR _teachers_n < 12 OR _classes_n < 12 THEN
    RAISE EXCEPTION
      'E2E_SCHOOL under-seeded: students=% (need ≥220), teachers=% (need 12), sections=% (need 12)',
      _students_n, _teachers_n, _classes_n;
  END IF;

  RAISE NOTICE
    'E2E SCHOOL OK: Riverside Public School — sections=% teachers=% students=% (logins: admin, principal, 12 teachers, 12 roll-1 students). Password=E2eSchool123!',
    _classes_n, _teachers_n, _students_n;
END
$e2e$;

DROP FUNCTION IF EXISTS public._e2e_upsert_auth_user(uuid, text, text, text);

-- =============================================================================
-- Proof
--
-- The fixture's own check ("at least 220 students, 12 teachers, 12 sections") would
-- pass with a section short, a class with no class teacher, a teacher who teaches
-- nothing, or not one login that works. What an E2E organisation is FOR is that
-- its people can sign in and do their jobs, so that is what is proven — every
-- section exactly, every login against the password, and three of its people
-- reading the database under their own row security.
-- =============================================================================

DO $verify$
DECLARE
  _school  constant uuid := '00000000-0000-4000-8000-000000000003';
  _ay      constant uuid := md5('rps-ay-2025-26')::uuid;
  _u_prin  constant uuid := md5('rps-auth-principal')::uuid;
  _u_t1    constant uuid := md5('rps-auth-teacher-1')::uuid;
  _u_s1    constant uuid := md5('rps-auth-student-1')::uuid;
  _s1      constant uuid := md5('rps-student-1')::uuid;
  _plan    constant text[] := ARRAY['8-A:20','8-B:20','9-A:22','9-B:22','10-A:16','10-B:16','10-C:16',
                                    '11-A:25','11-B:25','12-A:14','12-B:14','12-C:14'];
  _p text; _grade text; _section text; _expected int; _sec uuid;
  _n bigint; _m bigint; _k bigint; _role text; _t text;
BEGIN
  -- 0. The helper that wrote the logins does not outlive the migration.
  IF to_regprocedure('public._e2e_upsert_auth_user(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the login helper _e2e_upsert_auth_user was left behind';
  END IF;

  -- 1. The institution, its one current year, its five class groups.
  IF NOT EXISTS (SELECT 1 FROM public.schools
                  WHERE id = _school AND name = 'Riverside Public School' AND is_active AND status = 'active') THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside Public School is missing or inactive';
  END IF;
  IF (SELECT count(*) FROM public.academic_years WHERE school_id = _school AND is_current) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.academic_years WHERE id = _ay AND school_id = _school AND is_current) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside does not have exactly one current year, 2025-26';
  END IF;
  IF (SELECT count(*) FROM public.class_groups WHERE school_id = _school) <> 5 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % class groups, expected 5',
      (SELECT count(*) FROM public.class_groups WHERE school_id = _school);
  END IF;

  -- 2. Every section, exactly: its roll, its rolls numbered once each, its class
  --    teacher (who is class teacher of it, and teaches a subject in it), its subjects.
  FOREACH _p IN ARRAY _plan LOOP
    _grade := split_part(split_part(_p, ':', 1), '-', 1);
    _section := split_part(split_part(_p, ':', 1), '-', 2);
    _expected := split_part(_p, ':', 2)::int;
    _sec := md5('rps-sec-' || _grade || '-' || _section)::uuid;

    IF NOT EXISTS (SELECT 1 FROM public.classes c
                     JOIN public.teachers t ON t.id = c.class_teacher_id AND t.class_teacher_of = c.id
                    WHERE c.id = _sec AND c.school_id = _school AND c.name = _grade AND c.section = _section AND c.is_active) THEN
      RAISE EXCEPTION 'ROLLED BACK: section %-% is missing, inactive, or has no class teacher', _grade, _section;
    END IF;
    SELECT count(*) INTO _n FROM public.students WHERE class_id = _sec AND school_id = _school AND status = 'active';
    SELECT count(*), count(DISTINCT roll_number) INTO _m, _k
      FROM public.student_enrolments WHERE section_id = _sec AND academic_year_id = _ay AND to_date IS NULL;
    IF _n <> _expected OR _m <> _expected OR _k <> _expected THEN
      RAISE EXCEPTION 'ROLLED BACK: section %-% has % students and % enrolments (% distinct rolls); expected %',
        _grade, _section, _n, _m, _k, _expected;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.teacher_classes tc JOIN public.classes c ON c.id = tc.class_id
                    WHERE tc.class_id = _sec AND tc.teacher_id = c.class_teacher_id) THEN
      RAISE EXCEPTION 'ROLLED BACK: the class teacher of %-% teaches no subject in it, so could set no homework there', _grade, _section;
    END IF;
    IF (SELECT count(*) FROM public.section_subjects WHERE section_id = _sec)
       <> (SELECT least(6, count(*)) FROM public.curriculum_subjects cs
             JOIN public.class_groups g ON g.curriculum_class_id = cs.curriculum_class_id
             JOIN public.classes c ON c.class_group_id = g.id
            WHERE c.id = _sec)
       OR NOT EXISTS (SELECT 1 FROM public.section_subjects WHERE section_id = _sec) THEN
      RAISE EXCEPTION 'ROLLED BACK: section %-% does not carry its curriculum''s subjects (up to 6)', _grade, _section;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.classes WHERE school_id = _school) <> 12
     OR (SELECT count(*) FROM public.students WHERE school_id = _school) <> 224
     OR (SELECT count(*) FROM public.teachers WHERE school_id = _school AND status = 'active') <> 12 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside is not 12 sections, 224 students and 12 teachers';
  END IF;
  -- Each teacher: their own section's first subject and one subject in the next section.
  IF (SELECT count(*) FROM public.teacher_classes WHERE school_id = _school) <> 24
     OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.school_id = _school
                  AND (SELECT count(*) FROM public.teacher_classes tc WHERE tc.teacher_id = t.id) <> 2) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside''s teachers do not each teach two sections (% teacher_classes rows, expected 24)',
      (SELECT count(*) FROM public.teacher_classes WHERE school_id = _school);
  END IF;

  -- 3. The 26 logins: each signs in with the E2E password — and a wrong one opens none,
  --    or this comparison proves nothing — each with an identity, a profile of this
  --    school, and its role here.
  SELECT count(*) INTO _n FROM auth.users u
   WHERE u.email LIKE '%@rps.e2e.test' AND u.email_confirmed_at IS NOT NULL
     AND u.encrypted_password = extensions.crypt('E2eSchool123!', u.encrypted_password);
  IF _n <> 26 THEN
    RAISE EXCEPTION 'ROLLED BACK: % Riverside logins accept the E2E password, expected 26', _n;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.email LIKE '%@rps.e2e.test'
               AND u.encrypted_password = extensions.crypt('not-the-password', u.encrypted_password)) THEN
    RAISE EXCEPTION 'ROLLED BACK: a wrong password opens a Riverside login';
  END IF;
  IF (SELECT count(*) FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
       WHERE u.email LIKE '%@rps.e2e.test' AND i.provider = 'email') <> 26
     OR (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id
          WHERE u.email LIKE '%@rps.e2e.test' AND p.school_id = _school) <> 26 THEN
    RAISE EXCEPTION 'ROLLED BACK: a Riverside login lacks its email identity or its profile of this school';
  END IF;
  SELECT count(*) FILTER (WHERE m.role = 'admin'), count(*) FILTER (WHERE m.role = 'principal'),
         count(*) FILTER (WHERE m.role = 'teacher' AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = m.local_person_id AND t.user_id = m.account_id)),
         count(*) FILTER (WHERE m.role = 'student' AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = m.local_person_id AND s.user_id = m.account_id))
    INTO _n, _m, _k, _p
    FROM public.memberships m WHERE m.school_id = _school AND m.status = 'active';
  IF (_n, _m, _k, _p::bigint) IS DISTINCT FROM (1::bigint, 1::bigint, 12::bigint, 12::bigint)
     OR (SELECT count(*) FROM public.memberships WHERE school_id = _school) <> 26 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside memberships are % admin, % principal, % teacher, % student (bound to their person); expected 1, 1, 12, 12',
      _n, _m, _k, _p;
  END IF;

  -- 4. No academic data: the organisation is a roster.
  FOREACH _t IN ARRAY ARRAY['homework', 'homework_submissions', 'attendance', 'marks', 'exams', 'tests', 'fees'] LOOP
    IF to_regclass('public.' || _t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', _t) INTO _n USING _school;
      IF _n <> 0 THEN
        RAISE EXCEPTION 'ROLLED BACK: Riverside already holds % row(s) of %', _n, _t;
      END IF;
    END IF;
  END LOOP;

  -- 5. Three of its people, under their own row security. Inside a savepoint that
  --    always ends by raising P0999.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u_prin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE school_id <> _school) INTO _n, _m FROM public.classes;
    SELECT count(*) INTO _k FROM public.students;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'principal' OR _n <> 12 OR _m <> 0 OR _k <> 224 THEN
      RAISE EXCEPTION 'ROLLED BACK: principal@rps.e2e.test acts as % and reads % sections (% of another school) and % students; expected principal, 12, 0, 224',
        _role, _n, _m, _k;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u_t1, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*) INTO _n FROM public.students;
    SELECT count(*) INTO _m FROM public.students WHERE class_id = md5('rps-sec-12-C')::uuid;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'teacher' OR _n <> 40 OR _m <> 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: teacher01@rps.e2e.test acts as % and reads % students (% of 12-C, which they do not teach); expected teacher, the 40 of 8-A and 8-B, 0',
        _role, _n, _m;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _u_s1, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE id = _s1) INTO _n, _m FROM public.students;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'student' OR _n <> 1 OR _m <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: student.8a.01@rps.e2e.test acts as % and reads % student row(s), % of them their own; expected student, 1, 1',
        _role, _n, _m;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify probes rolled back';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;

  RAISE NOTICE 'verify OK: Riverside Public School — 12 sections exactly as planned (224 students, each roll numbered once, each section with its class teacher teaching in it and its subjects), 12 teachers each teaching two sections, 26 logins that open with the E2E password and not with another, memberships 1 admin / 1 principal / 12 teachers / 12 students bound to their people, no academic data; the principal reads the school and nothing else, teacher01 the 40 students they teach, student 8A-01 their own row';
END
$verify$;
