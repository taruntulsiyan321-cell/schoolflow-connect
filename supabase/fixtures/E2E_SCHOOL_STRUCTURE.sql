-- =============================================================================
-- E2E SCHOOL STRUCTURE — Riverside Public School
-- =============================================================================
-- Real organization for end-to-end testing of the whole app.
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
--
-- Other students exist as person records with portal_email set (no auth yet).
--
-- School id: 00000000-0000-4000-8000-000000000003
-- Idempotent: md5 labels + ON CONFLICT. Safe to re-run.
-- Apply: npm run db:seed:e2e-school
-- Remove: npm run db:seed:e2e-school:remove
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
