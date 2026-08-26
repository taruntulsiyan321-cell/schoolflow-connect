-- ============================================================================
-- SEED_CLASS12_DEMO.sql — Class 12-A (Commerce) demo cohort + richer demo data
-- ----------------------------------------------------------------------------
-- Additive and IDEMPOTENT. Safe to run repeatedly. Does not delete anything and
-- does not touch the existing Class 10-A / 9-A cohort.
--
-- Run it one of these ways:
--   • Supabase Dashboard → SQL Editor → paste → Run
--   • psql "$DATABASE_URL" -f supabase/SEED_CLASS12_DEMO.sql
--
-- WHY THIS FILE EXISTS
-- The Class 12 student login could not be created from the assistant session:
-- creating auth users requires either the service_role key or a write into the
-- `auth` schema, both of which were blocked there. Everything that did NOT need
-- a person record (subjects catalog, calendar, exam publication, homework) was
-- applied directly to the live DB already; this file is idempotent so re-running
-- it simply confirms that state and adds the parts that were blocked.
--
-- WHAT YOU GET
--   Class 12-A (Commerce, RBSE) wired so Practice resolves to the 671-question
--   Class 12 Mathematics bank (15 chapters, 488 topics) that already exists.
--
--   Student  aarav.sharma@wisdomcampus.com   / DemoPass123!   (Class 12-A)
--   Parent   sharma.parent@wisdomcampus.com  / DemoPass123!   (linked to Aarav)
--
-- HOW THE CONTENT RESOLVES (so this keeps working if you add more students)
--   schools.board  = 'rbse'      → question_bank.board filter
--   schools.stream = 'commerce'  → subject allowlist, applied at class ≥ 11 only
--   classes.name   = '12'        → parseClassLevel() → class_level = 12
--   Mathematics is in COMMERCE_SUBJECT_ALLOWLIST, so a Class 12 commerce student
--   correctly gets Maths, Accountancy, Business Studies, Economics, English, Hindi.
-- ============================================================================

BEGIN;

-- ── Demo auth-user helper (same contract as SEED_DEMO_DATA.sql) ──────────────
CREATE OR REPLACE FUNCTION public._demo_upsert_auth_user(
  _id uuid, _email text, _password text, _full_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      _id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      lower(_email), extensions.crypt(_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _full_name),
      now(), now(), '', '', '', ''
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

  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = _id AND provider = 'email') THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      _id, _id, jsonb_build_object('sub', _id::text, 'email', lower(_email)),
      'email', _id::text, now(), now(), now()
    );
  END IF;
END $$;

DO $seed$
DECLARE
  _school    uuid := '00000000-0000-4000-8000-000000000001';
  _class12   uuid := 'd2000001-0012-4000-8000-000000000012';
  _stu_user  uuid := 'd1000003-0012-4000-8000-000000000012';
  _stu       uuid := 'd3000012-0001-4000-8000-000000000012';
  _par_user  uuid := 'd1000004-0012-4000-8000-000000000012';
  _par       uuid := 'd4000012-0001-4000-8000-000000000012';
  _teacher   uuid;
  _exam12    uuid := 'd8000012-0001-4000-8000-000000000012';
  _d         date;
  _i         int;
BEGIN
  -- ── Class 12-A ────────────────────────────────────────────────────────────
  -- category 'Commerce' also lets stream resolve from the class when a school
  -- is not stream-tagged, so this class stays correct on its own.
  INSERT INTO public.classes (id, name, section, academic_year, kind, display_name,
                              category, school_id, is_active)
  VALUES (_class12, '12', 'A', '2025-26', 'class', 'Class 12-A', 'Commerce', _school, true)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, section = EXCLUDED.section,
    display_name = EXCLUDED.display_name, category = EXCLUDED.category, is_active = true;

  -- ── Student: Aarav Sharma ─────────────────────────────────────────────────
  PERFORM public._demo_upsert_auth_user(
    _stu_user, 'aarav.sharma@wisdomcampus.com', 'DemoPass123!', 'Aarav Sharma');

  INSERT INTO public.profiles (id, full_name, email, school_id, is_active)
  VALUES (_stu_user, 'Aarav Sharma', 'aarav.sharma@wisdomcampus.com', _school, true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    school_id = EXCLUDED.school_id, is_active = true;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_stu_user, 'student')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.students (
    id, user_id, full_name, admission_number, roll_number, class_id, school_id,
    portal_email, email, status, gender
  ) VALUES (
    _stu, _stu_user, 'Aarav Sharma', 'WC12A001', '1', _class12, _school,
    'aarav.sharma@wisdomcampus.com', 'aarav.sharma@wisdomcampus.com', 'active'::person_status, 'male'
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, class_id = EXCLUDED.class_id,
    portal_email = EXCLUDED.portal_email, email = EXCLUDED.email,
    full_name = EXCLUDED.full_name, status = 'active';

  -- ── Parent: linked via the parents → parent_students join table ───────────
  -- This is the linkage the real admin UI writes. students.parent_user_id is the
  -- legacy path and is deliberately NOT used here, so the parent panel is tested
  -- through the same mechanism a real school would produce.
  PERFORM public._demo_upsert_auth_user(
    _par_user, 'sharma.parent@wisdomcampus.com', 'DemoPass123!', 'Rakesh Sharma');

  INSERT INTO public.profiles (id, full_name, email, school_id, is_active)
  VALUES (_par_user, 'Rakesh Sharma', 'sharma.parent@wisdomcampus.com', _school, true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name, email = EXCLUDED.email, is_active = true;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_par_user, 'parent')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.parents (id, school_id, user_id, full_name, email, phone,
                              occupation, status, portal_email)
  VALUES (_par, _school, _par_user, 'Rakesh Sharma', 'sharma.parent@wisdomcampus.com',
          '+91 98290 11223', 'Chartered Accountant', 'active'::person_status,
          'sharma.parent@wisdomcampus.com')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name,
    email = EXCLUDED.email, portal_email = EXCLUDED.portal_email;

  INSERT INTO public.parent_students (school_id, parent_id, student_id, relationship, is_primary)
  SELECT _school, _par, _stu, 'father', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.parent_students WHERE parent_id = _par AND student_id = _stu
  );

  -- ── Teach Class 12-A with the existing demo teacher ───────────────────────
  SELECT id INTO _teacher FROM public.teachers
   WHERE school_id = _school ORDER BY created_at LIMIT 1;

  IF _teacher IS NOT NULL THEN
    INSERT INTO public.teacher_classes (teacher_id, class_id, subject, school_id)
    SELECT _teacher, _class12, s, _school
    FROM unnest(ARRAY['Mathematics','Accountancy','Business Studies','Economics']) AS s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.teacher_classes tc
       WHERE tc.teacher_id = _teacher AND tc.class_id = _class12 AND tc.subject = s
    );

    UPDATE public.classes SET class_teacher_id = _teacher
     WHERE id = _class12 AND class_teacher_id IS NULL;
  END IF;

  -- ── Class 12-A timetable ──────────────────────────────────────────────────
  INSERT INTO public.class_timetables (class_id, school_id, grid)
  VALUES (_class12, _school, jsonb_build_object(
    'Mon-1','Mathematics','Mon-2','Accountancy','Mon-3','Business Studies','Mon-4','English',
    'Mon-5','Economics','Mon-6','Mathematics','Mon-7','Library',
    'Tue-1','Accountancy','Tue-2','Mathematics','Tue-3','Economics','Tue-4','Hindi',
    'Tue-5','Business Studies','Tue-6','English','Tue-7','Sports',
    'Wed-1','Business Studies','Wed-2','Economics','Wed-3','Mathematics','Wed-4','Accountancy',
    'Wed-5','English','Wed-6','Hindi','Wed-7','Mathematics',
    'Thu-1','Mathematics','Thu-2','English','Thu-3','Accountancy','Thu-4','Economics',
    'Thu-5','Business Studies','Thu-6','Library','Thu-7','Hindi',
    'Fri-1','Assembly','Fri-2','Mathematics','Fri-3','Business Studies','Fri-4','Accountancy',
    'Fri-5','Economics','Fri-6','English','Fri-7','Sports'
  ))
  ON CONFLICT (class_id) DO UPDATE SET grid = EXCLUDED.grid;

  -- ── Attendance: last 20 weekdays, mostly present ─────────────────────────
  FOR _i IN 0..27 LOOP
    _d := (now()::date - _i);
    CONTINUE WHEN extract(isodow from _d) > 5;          -- weekdays only
    INSERT INTO public.attendance (student_id, class_id, date, status, school_id)
    SELECT _stu, _class12, _d,
           CASE WHEN _i % 11 = 3 THEN 'absent'
                WHEN _i % 7  = 5 THEN 'late'
                ELSE 'present' END::attendance_status,
           _school
    WHERE NOT EXISTS (
      SELECT 1 FROM public.attendance a WHERE a.student_id = _stu AND a.date = _d
    );
  END LOOP;

  -- ── A published Class 12 Maths exam with marks ───────────────────────────
  INSERT INTO public.exams (id, name, exam_type, class_id, subject, max_marks,
                            exam_date, school_id, status, marks_locked,
                            results_published_at, passing_marks)
  VALUES (_exam12, 'Unit Test 1 — Relations & Functions', 'unit_test', _class12,
          'Mathematics', 25, now()::date - 6, _school, 'completed', true, now(), 8)
  ON CONFLICT (id) DO UPDATE SET
    results_published_at = COALESCE(public.exams.results_published_at, now()),
    status = 'completed', marks_locked = true;

  INSERT INTO public.marks (exam_id, student_id, marks_obtained, remarks, school_id)
  SELECT _exam12, _stu, 21, 'Strong on composition of functions. Revise one-one/onto proofs.', _school
  WHERE NOT EXISTS (
    SELECT 1 FROM public.marks m WHERE m.exam_id = _exam12 AND m.student_id = _stu
  );

  -- ── Fees: one paid, one partial, one due ─────────────────────────────────
  INSERT INTO public.fees (student_id, month, amount, paid_amount, due_date, status, school_id, fee_type)
  SELECT _stu, m.month, m.amount, m.paid, m.due::date, m.status::fee_status, _school, 'tuition'
  FROM (VALUES
      (to_char(now() - interval '2 month', 'YYYY-MM'), 4500::numeric, 4500::numeric, (now()::date - 55), 'paid'),
      (to_char(now() - interval '1 month', 'YYYY-MM'), 4500::numeric, 2000::numeric, (now()::date - 25), 'partial'),
      (to_char(now(),                      'YYYY-MM'), 4500::numeric,    0::numeric, (now()::date + 8),  'unpaid')
  ) AS m(month, amount, paid, due, status)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fees f WHERE f.student_id = _stu AND f.month = m.month
  );

  -- ── Notices ──────────────────────────────────────────────────────────────
  INSERT INTO public.notices (title, body, audience, class_id, school_id, status, published_at, pinned)
  SELECT n.title, n.body, n.audience::notice_audience, n.class_id, _school, 'published', now(), n.pinned
  FROM (VALUES
      ('Half Yearly Datesheet Released',
       'The Class 12 half-yearly datesheet is now on the notice board. Practicals begin a week earlier.',
       'all', NULL::uuid, true),
      ('Commerce Stream — Accountancy Project',
       'Project files must be submitted with the partnership case study attached. Late submissions lose 5 marks.',
       'class', 'd2000001-0012-4000-8000-000000000012'::uuid, false),
      ('Parent-Teacher Meeting',
       'PTM this Saturday, 9 AM to 1 PM. Please collect the Term 1 progress report from the class teacher.',
       'parents', NULL::uuid, true)
  ) AS n(title, body, audience, class_id, pinned)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notices x WHERE x.title = n.title AND x.school_id = _school
  );

END
$seed$;

DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT 'class 12 students'  AS check, count(*)::text AS value FROM public.students  WHERE class_id = 'd2000001-0012-4000-8000-000000000012'
UNION ALL SELECT 'class 12 attendance', count(*)::text FROM public.attendance WHERE class_id = 'd2000001-0012-4000-8000-000000000012'
UNION ALL SELECT 'class 12 homework',   count(*)::text FROM public.homework   WHERE class_id = 'd2000001-0012-4000-8000-000000000012'
UNION ALL SELECT 'published exams',     count(*)::text FROM public.exams      WHERE results_published_at IS NOT NULL
UNION ALL SELECT 'subjects catalog',    count(*)::text FROM public.subjects
UNION ALL SELECT 'calendar events',     count(*)::text FROM public.school_calendar_events
UNION ALL SELECT 'class 12 maths bank', count(*)::text FROM public.question_bank WHERE is_active AND class_level = 12 AND subject = 'Mathematics';
