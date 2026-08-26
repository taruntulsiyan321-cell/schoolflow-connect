-- One-shot seed: question bank + Wisdom Campus demo users/data
-- Run: npm run db:seed  OR paste in Supabase SQL Editor




-- =============================================================================
-- Wisdom Campus (SchoolFlow Connect) — Comprehensive demo dataset
-- Idempotent: fixed UUIDs + ON CONFLICT. Safe to re-run after schema migrations.
--
-- APPLY: Supabase Dashboard SQL editor, or `supabase db push` / migration up.
-- LOGIN: See docs/DEMO_ACCOUNTS.md — password DemoPass123! for all users.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Helper: upsert demo auth user (email/password). Runs as migration owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._demo_upsert_auth_user(
  _id uuid,
  _email text,
  _password text,
  _full_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
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
$$;

DO $demo$
DECLARE
  _pw text := 'DemoPass123!';
  -- Auth user UUIDs
  _demo_school uuid := '00000000-0000-4000-8000-000000000001';
  _ay         uuid;
  _session_start date;
  sub_today   uuid;
  sub_yday    uuid;
  u_admin     uuid := 'd1000001-0001-4000-8000-000000000001';
  u_principal uuid := 'd1000001-0002-4000-8000-000000000002';
  u_t_math    uuid := 'd1000002-0001-4000-8000-000000000001';
  u_t_phys    uuid := 'd1000002-0002-4000-8000-000000000002';
  u_s1        uuid := 'd1000003-0001-4000-8000-000000000001';
  u_s2        uuid := 'd1000003-0002-4000-8000-000000000002';
  u_s3        uuid := 'd1000003-0003-4000-8000-000000000003';
  u_s4        uuid := 'd1000003-0004-4000-8000-000000000004';
  u_s5        uuid := 'd1000003-0005-4000-8000-000000000005';
  u_p1        uuid := 'd1000004-0001-4000-8000-000000000001';
  u_p2        uuid := 'd1000004-0002-4000-8000-000000000002';
  -- Entity UUIDs
  c10a        uuid := 'd2000001-0001-4000-8000-000000000001';
  c9a         uuid := 'd2000001-0002-4000-8000-000000000002';
  t_math      uuid := 'd3000002-0001-4000-8000-000000000001';
  t_phys      uuid := 'd3000002-0002-4000-8000-000000000002';
  st1         uuid := 'd3000001-0001-4000-8000-000000000001';
  st2         uuid := 'd3000001-0002-4000-8000-000000000002';
  st3         uuid := 'd3000001-0003-4000-8000-000000000003';
  st4         uuid := 'd3000001-0004-4000-8000-000000000004';
  st5         uuid := 'd3000001-0005-4000-8000-000000000005';
  b_sched     uuid := 'd4000001-0001-4000-8000-000000000001';
  b_live      uuid := 'd4000001-0002-4000-8000-000000000002';
  b_done      uuid := 'd4000001-0003-4000-8000-000000000003';
  bp_done1    uuid := 'd4000002-0001-4000-8000-000000000001';
  bp_done2    uuid := 'd4000002-0002-4000-8000-000000000002';
  bq_done1    uuid := 'd4000003-0001-4000-8000-000000000001';
  bq_done2    uuid := 'd4000003-0002-4000-8000-000000000002';
  dpp_pub     uuid := 'd5000001-0001-4000-8000-000000000001';
  dpp_draft   uuid := 'd5000001-0002-4000-8000-000000000002';
  dpp_q1      uuid := 'd5000002-0001-4000-8000-000000000001';
  dpp_q2      uuid := 'd5000002-0002-4000-8000-000000000002';
  dpp_att     uuid := 'd5000003-0001-4000-8000-000000000001';
  hw1         uuid := 'd6000001-0001-4000-8000-000000000001';
  hw_sub1     uuid := 'd6000002-0001-4000-8000-000000000001';
  exam1       uuid := 'd8000001-0001-4000-8000-000000000001';
  exam2       uuid := 'd8000001-0002-4000-8000-000000000002';
  _qb_id      uuid;
  _today      date := CURRENT_DATE;
  _yr         text := '2025-26';
BEGIN
  -- ===================== AUTH USERS =====================
  PERFORM public._demo_upsert_auth_user(u_admin,     'admin@wisdomcampus.com',           _pw, 'Ravi Krishnan');
  PERFORM public._demo_upsert_auth_user(u_principal, 'principal@wisdomcampus.com',     _pw, 'Sunita Nair');
  PERFORM public._demo_upsert_auth_user(u_t_math,    'priya.sharma@wisdomcampus.com',  _pw, 'Priya Sharma');
  PERFORM public._demo_upsert_auth_user(u_t_phys,    'rajesh.verma@wisdomcampus.com',  _pw, 'Rajesh Verma');
  PERFORM public._demo_upsert_auth_user(u_s1,        'arjun.mehta@wisdomcampus.com',   _pw, 'Arjun Mehta');
  PERFORM public._demo_upsert_auth_user(u_s2,        'priya.patel@wisdomcampus.com',   _pw, 'Priya Patel');
  PERFORM public._demo_upsert_auth_user(u_s3,        'rohan.singh@wisdomcampus.com',   _pw, 'Rohan Singh');
  PERFORM public._demo_upsert_auth_user(u_s4,        'ananya.iyer@wisdomcampus.com',   _pw, 'Ananya Iyer');
  PERFORM public._demo_upsert_auth_user(u_s5,        'vikram.joshi@wisdomcampus.com',  _pw, 'Vikram Joshi');
  PERFORM public._demo_upsert_auth_user(u_p1,        'mehta.parent@wisdomcampus.com',  _pw, 'Suresh Mehta');
  PERFORM public._demo_upsert_auth_user(u_p2,        'patel.parent@wisdomcampus.com',  _pw, 'Kavita Patel');

  -- Profiles (trigger may have created; ensure full data)
  INSERT INTO public.profiles (id, full_name, email) VALUES
    (u_admin,     'Ravi Krishnan',   'admin@wisdomcampus.com'),
    (u_principal, 'Sunita Nair',     'principal@wisdomcampus.com'),
    (u_t_math,    'Priya Sharma',    'priya.sharma@wisdomcampus.com'),
    (u_t_phys,    'Rajesh Verma',    'rajesh.verma@wisdomcampus.com'),
    (u_s1,        'Arjun Mehta',     'arjun.mehta@wisdomcampus.com'),
    (u_s2,        'Priya Patel',     'priya.patel@wisdomcampus.com'),
    (u_s3,        'Rohan Singh',     'rohan.singh@wisdomcampus.com'),
    (u_s4,        'Ananya Iyer',     'ananya.iyer@wisdomcampus.com'),
    (u_s5,        'Vikram Joshi',    'vikram.joshi@wisdomcampus.com'),
    (u_p1,        'Suresh Mehta',    'mehta.parent@wisdomcampus.com'),
    (u_p2,        'Kavita Patel',    'patel.parent@wisdomcampus.com')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  -- Roles
  -- Roles live on public.memberships since Chunk 1.5; public.user_roles is
  -- read-only and a direct INSERT now raises. _grant_membership() is the
  -- supported path (it also creates the accounts row and is idempotent).
  -- local_person_id is passed where the demo has a local record, so the same
  -- human can hold several memberships without the records being merged.
  PERFORM public._grant_membership(u_admin,     _demo_school, 'admin');
  PERFORM public._grant_membership(u_principal, _demo_school, 'principal');
  PERFORM public._grant_membership(u_t_math,    _demo_school, 'teacher', t_math);
  PERFORM public._grant_membership(u_t_phys,    _demo_school, 'teacher', t_phys);
  PERFORM public._grant_membership(u_s1,        _demo_school, 'student', st1);
  PERFORM public._grant_membership(u_s2,        _demo_school, 'student', st2);
  PERFORM public._grant_membership(u_s3,        _demo_school, 'student', st3);
  PERFORM public._grant_membership(u_s4,        _demo_school, 'student', st4);
  PERFORM public._grant_membership(u_s5,        _demo_school, 'student', st5);
  PERFORM public._grant_membership(u_p1,        _demo_school, 'parent');
  PERFORM public._grant_membership(u_p2,        _demo_school, 'parent');

  -- ===================== CLASSES =====================
  INSERT INTO public.classes (id, name, section, academic_year, kind, display_name, category) VALUES
    (c10a, '10', 'A', _yr, 'class', 'Class 10-A', 'Secondary'),
    (c9a,  '9',  'A', _yr, 'class', 'Class 9-A',  'Secondary')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, section = EXCLUDED.section, academic_year = EXCLUDED.academic_year,
    display_name = EXCLUDED.display_name, category = EXCLUDED.category;

  -- ===================== TEACHERS =====================
  -- school_id is explicit: Chunk 2.5 made teachers.school_id NOT NULL so the
  -- composite FK binding an assignment to its own institution is enforceable.
  INSERT INTO public.teachers (
    id, school_id, user_id, full_name, subject, mobile, email,
    is_class_teacher, class_teacher_of, employee_id, department, qualification, joining_date, status
  ) VALUES
    (t_math, _demo_school, u_t_math, 'Priya Sharma', 'Mathematics', '9876501001', 'priya.sharma@wisdomcampus.com',
     true, c10a, 'EMP-T-001', 'Mathematics', 'M.Sc Mathematics', '2018-06-01', 'active'),
    (t_phys, _demo_school, u_t_phys, 'Rajesh Verma', 'Physics', '9876501002', 'rajesh.verma@wisdomcampus.com',
     false, NULL, 'EMP-T-002', 'Science', 'M.Sc Physics', '2019-07-15', 'active')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    is_class_teacher = EXCLUDED.is_class_teacher, class_teacher_of = EXCLUDED.class_teacher_of;

  INSERT INTO public.teacher_classes (teacher_id, class_id, subject) VALUES
    (t_math, c10a, 'Mathematics'),
    (t_math, c9a,  'Mathematics'),
    (t_phys, c10a, 'Physics')
  ON CONFLICT (teacher_id, class_id, subject) DO NOTHING;

  -- The academic year and its start date are resolved here, before the first
  -- row that references them. Chunk 3 made students.academic_year_id and
  -- enrolment_date real columns, and Chunk 4.5 moved roll_number onto
  -- student_enrolments, which is NOT NULL on academic_year_id.
  SELECT ay.id, ay.starts_on INTO _ay, _session_start
    FROM public.academic_years ay
   WHERE ay.school_id = _demo_school AND ay.is_current
   LIMIT 1;
  IF _ay IS NULL THEN
    RAISE EXCEPTION 'Demo seed: no current academic_year for the demo school';
  END IF;

  -- ===================== STUDENTS =====================
  -- school_id is explicit: Chunk 3 made students.school_id NOT NULL (G1).
  -- Chunk 4.5: roll_number lives on student_enrolments (per academic year),
  -- not on students. The enrolment rows below carry it.
  INSERT INTO public.students (
    id, school_id, user_id, full_name, admission_number, class_id,
    parent_user_id, parent_name, parent_mobile, address, date_of_birth,
    enrolment_date, academic_year_id
  ) VALUES
    (st1, _demo_school, u_s1, 'Arjun Mehta',   'WC10A001', c10a, u_p1, 'Suresh Mehta',  '9876502001', '12, MG Road, Pune', '2010-03-15', _session_start, _ay),
    (st2, _demo_school, u_s2, 'Priya Patel',   'WC10A002', c10a, u_p2, 'Kavita Patel',  '9876502002', '45, FC Road, Pune', '2010-07-22', _session_start, _ay),
    (st3, _demo_school, u_s3, 'Rohan Singh',   'WC10A003', c10a, NULL, 'Harpreet Singh','9876502003', '8, Koregaon Park', '2010-01-08', _session_start, _ay),
    (st4, _demo_school, u_s4, 'Ananya Iyer',   'WC10A004', c10a, NULL, 'Lakshmi Iyer',  '9876502004', '22, Baner Road',   '2010-11-30', _session_start, _ay),
    (st5, _demo_school, u_s5, 'Vikram Joshi',  'WC10A005', c10a, NULL, 'Amit Joshi',    '9876502005', '3, Aundh',         '2010-05-18', _session_start, _ay)
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, class_id = EXCLUDED.class_id,
    parent_user_id = EXCLUDED.parent_user_id;

  INSERT INTO public.student_enrolments
    (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
  VALUES
    (_demo_school, st1, _ay, c10a, '1', _session_start),
    (_demo_school, st2, _ay, c10a, '2', _session_start),
    (_demo_school, st3, _ay, c10a, '3', _session_start),
    (_demo_school, st4, _ay, c10a, '4', _session_start),
    (_demo_school, st5, _ay, c10a, '5', _session_start)
  ON CONFLICT (section_id, academic_year_id, roll_number) DO NOTHING;

  -- ===================== ATTENDANCE =====================
  -- Chunk 4: the register is marked FIRST. attendance_submissions is the
  -- authority for whether a section was marked at all, and per-student rows
  -- hang off it. 'leave' is gone — present/absent only (locked decision 5);
  -- an approved absence is owned by leave_requests, not by the register.
  INSERT INTO public.attendance_submissions
    (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES
    (_demo_school, _ay, c10a, _today,     u_t_math),
    (_demo_school, _ay, c10a, _today - 1, u_t_math)
  ON CONFLICT (section_id, date) DO NOTHING;

  SELECT id INTO sub_today FROM public.attendance_submissions
   WHERE section_id = c10a AND date = _today;
  SELECT id INTO sub_yday  FROM public.attendance_submissions
   WHERE section_id = c10a AND date = _today - 1;

  -- Chunk 4.6: the record carries no section or date of its own — the
  -- submission it hangs off holds both, and is the authority.
  INSERT INTO public.attendance (school_id, submission_id, student_id, status, marked_by) VALUES
    (_demo_school, sub_today, st1, 'present', u_t_math),
    (_demo_school, sub_today, st2, 'present', u_t_math),
    (_demo_school, sub_today, st3, 'absent',  u_t_math),
    (_demo_school, sub_today, st4, 'present', u_t_math),
    (_demo_school, sub_today, st5, 'absent',  u_t_math),
    (_demo_school, sub_yday,  st1, 'present', u_t_math),
    (_demo_school, sub_yday,  st2, 'present', u_t_math),
    (_demo_school, sub_yday,  st3, 'present', u_t_math),
    (_demo_school, sub_yday,  st4, 'absent',  u_t_math),
    (_demo_school, sub_yday,  st5, 'present', u_t_math)
  ON CONFLICT (student_id, submission_id) DO UPDATE SET
    status = EXCLUDED.status, marked_by = EXCLUDED.marked_by;

  -- Chunk 4.7: there is no lock. This day exists to demonstrate the EDITED
  -- MARKER instead -- a day whose figure changed after it was submitted, which
  -- is what replaced provisional/final.
  INSERT INTO public.attendance_submissions
    (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_demo_school, _ay, c10a, _today - 2, u_t_math)
  ON CONFLICT (section_id, date) DO NOTHING;

  -- submission_id matters: attendance_day_edits resolves the marker by joining
  -- on it, so an audit row without one would record an edit that no screen can
  -- show. The edit is attributed to the admin, the only role that may edit.
  INSERT INTO public.attendance_audit
    (school_id, submission_id, class_id, date, student_id, prev_status, new_status, edited_by)
  SELECT _demo_school, s.id, c10a, _today - 2, st3, 'absent', 'present', u_admin
    FROM public.attendance_submissions s
   WHERE s.section_id = c10a AND s.date = _today - 2;

  -- ===================== FEES =====================
  INSERT INTO public.fees (student_id, month, amount, paid_amount, due_date, status, notes) VALUES
    (st1, to_char(_today, 'YYYY') || '-04', 4500, 4500, (_today - 30)::date, 'paid',   'April tuition'),
    (st1, to_char(_today, 'YYYY') || '-05', 4500, 2000, (_today + 10)::date, 'partial','May — partial payment'),
    (st1, to_char(_today, 'YYYY') || '-06', 4500, 0,    (_today + 25)::date, 'unpaid', 'June due'),
    (st2, to_char(_today, 'YYYY') || '-05', 4500, 4500, (_today - 5)::date,  'paid',   NULL),
    (st2, to_char(_today, 'YYYY') || '-06', 4500, 0,    (_today + 20)::date, 'unpaid', NULL),
    (st3, to_char(_today, 'YYYY') || '-06', 4500, 4500, (_today)::date,      'paid',   NULL)
  ON CONFLICT (student_id, month) DO UPDATE SET
    amount = EXCLUDED.amount, paid_amount = EXCLUDED.paid_amount,
    status = EXCLUDED.status, notes = EXCLUDED.notes;

  -- ===================== EXAMS & MARKS =====================
  INSERT INTO public.exams (id, name, exam_type, class_id, subject, max_marks, exam_date, created_by) VALUES
    (exam1, 'Unit Test 1 — Real Numbers', 'unit_test', c10a, 'Mathematics', 20, _today - 14, u_t_math),
    (exam2, 'Half Yearly — Electricity',  'half_yearly', c10a, 'Physics', 50, _today - 7, u_t_phys)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, exam_date = EXCLUDED.exam_date;

  INSERT INTO public.marks (exam_id, student_id, marks_obtained, remarks) VALUES
    (exam1, st1, 18, 'Excellent'),
    (exam1, st2, 16, 'Good'),
    (exam1, st3, 12, 'Needs practice'),
    (exam1, st4, 19, 'Top scorer'),
    (exam1, st5, 14, NULL),
    (exam2, st1, 42, NULL),
    (exam2, st2, 38, NULL),
    (exam2, st3, 45, 'Outstanding'),
    (exam2, st4, 40, NULL),
    (exam2, st5, 35, NULL)
  ON CONFLICT (exam_id, student_id) DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, remarks = EXCLUDED.remarks;

  -- ===================== NOTICES =====================
  INSERT INTO public.notices (id, title, body, audience, class_id, posted_by, expires_at) VALUES
    ('d9000001-0001-4000-8000-000000000001',
     'PTM — Class 10-A', 'Parent-Teacher meeting on Saturday 10 AM in Room 12.', 'class', c10a, u_t_math, now() + interval '30 days'),
    ('d9000001-0002-4000-8000-000000000002',
     'Holiday — Guru Purnima', 'School closed on Guru Purnima. Regular classes resume next day.', 'all', NULL, u_principal, now() + interval '60 days'),
    ('d9000001-0003-4000-8000-000000000003',
     'Teachers: CBSE workshop', 'Mandatory NCERT-aligned workshop for Science & Maths faculty.', 'teachers', NULL, u_principal, now() + interval '14 days'),
    ('d9000001-0004-4000-8000-000000000004',
     'Fee reminder', 'Please clear pending June fees before the due date.', 'parents', NULL, u_admin, now() + interval '21 days')
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body;

  -- ===================== HOMEWORK =====================
  -- school_id is explicit: Chunk 2.5 made homework.school_id NOT NULL, which is
  -- what closes the MATCH SIMPLE null-skip on the section_subject composite FK.
  INSERT INTO public.homework (id, school_id, class_id, subject, title, description, due_date, created_by) VALUES
    (hw1, _demo_school, c10a, 'Mathematics', 'NCERT Ch 1 — Euclid''s Division Lemma',
     'Solve Ex 1.1 Q 1–5 and upload working.', _today + 3, u_t_math)
  -- due_date must be refreshed on a re-run, not just the title. It was not,
  -- so a second seed left the homework sitting at its ORIGINAL due date while
  -- the submissions below went in at now() -- i.e. after it had closed. That
  -- was invisible until Chunk 5 started enforcing the lock, at which point the
  -- whole seed failed. Keep every date relative to _today on every run.
  ON CONFLICT (id) DO UPDATE SET
    title       = EXCLUDED.title,
    description = EXCLUDED.description,
    due_date    = EXCLUDED.due_date,
    closes_at   = (EXCLUDED.due_date + 1)::timestamptz;

  INSERT INTO public.homework_submissions (id, homework_id, student_id, content, status, grade, teacher_remarks, submitted_at, graded_at) VALUES
    (hw_sub1, hw1, st1, 'Completed all five questions with steps.', 'graded', 'A', 'Neat presentation', now() - interval '1 day', now())
  ON CONFLICT (homework_id, student_id) DO UPDATE SET status = EXCLUDED.status, grade = EXCLUDED.grade;

  INSERT INTO public.homework_submissions (homework_id, student_id, content, status, submitted_at) VALUES
    (hw1, st2, 'Submitted — pending review', 'submitted', now() - interval '2 hours')
  ON CONFLICT (homework_id, student_id) DO NOTHING;

  -- ===================== MESSAGES (chat) =====================
  INSERT INTO public.messages (sender_id, receiver_id, content, is_read) VALUES
    (u_p1, u_t_math, 'Namaste Ma''am, Arjun was unwell yesterday. Will share medical certificate.', true),
    (u_t_math, u_p1, 'Received. Attendance updated. Hope Arjun feels better soon.', true),
    (u_p1, u_t_math, 'Thank you. When is the PTM?', false)
  ON CONFLICT DO NOTHING;

  -- ===================== LEAVE REQUESTS =====================
  INSERT INTO public.leave_requests (
    id, applicant_user_id, applicant_kind, student_id, class_id,
    leave_type, from_date, to_date, reason, status, reviewed_by, reviewed_at
  ) VALUES
    ('d9000002-0001-4000-8000-000000000001', u_s5, 'student', st5, c10a,
     'medical', _today, _today + 1, 'Viral fever', 'pending', NULL, NULL),
    ('d9000002-0002-4000-8000-000000000002', u_s3, 'student', st3, c10a,
     'family', _today - 10, _today - 9, 'Family function', 'approved', u_t_math, now() - interval '11 days'),
    ('d9000002-0003-4000-8000-000000000003', u_t_phys, 'teacher', NULL, NULL,
     'personal', _today + 5, _today + 5, 'Personal work', 'rejected', u_principal, now() - interval '1 day')
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

  -- ===================== INQUIRIES & COMPLAINTS =====================
  INSERT INTO public.school_inquiries (id, contact_name, contact_phone, contact_email, grade_interest, message, status, created_by) VALUES
    ('d9000003-0001-4000-8000-000000000001', 'Amit Deshmukh', '9988776655', 'amit@example.com', 'Class 9',
     'Interested in CBSE admission for 2026-27.', 'open', u_admin)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.school_complaints (id, student_id, submitted_by, complainant_name, subject, body, category, status) VALUES
    ('d9000004-0001-4000-8000-000000000001', st3, u_p1, 'Suresh Mehta', 'Canteen hygiene',
     'Request to improve lunch hygiene standards.', 'facilities', 'in_progress')
  ON CONFLICT (id) DO NOTHING;

  -- ===================== STUDENT XP & BADGES =====================
  INSERT INTO public.student_xp (user_id, xp, level, current_streak, longest_streak, total_battles, wins, equipped_badge, last_battle_at) VALUES
    (u_s1, 320, 4, 3, 7, 8, 3, 'first_win', now() - interval '1 day'),
    (u_s2, 180, 2, 1, 5, 4, 1, NULL, now() - interval '3 days'),
    (u_s3, 450, 5, 5, 12, 12, 6, 'sharp_shooter', now() - interval '2 hours')
  ON CONFLICT (user_id) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, wins = EXCLUDED.wins;

  INSERT INTO public.student_badges (user_id, badge_code, tier) VALUES
    (u_s1, 'first_win', 'bronze'),
    (u_s1, 'first_dpp', 'bronze'),
    (u_s3, 'first_win', 'bronze'),
    (u_s3, 'sharp_shooter', 'silver'),
    (u_s3, 'dpp_perfect', 'gold')
  ON CONFLICT (user_id, badge_code) DO NOTHING;

  -- ===================== BATTLES =====================
  INSERT INTO public.battles (
    id, class_id, creator_user_id, title, subject, topic, chapter, difficulty,
    type, status, starts_at, duration_sec, per_question_sec, question_count,
    is_public, mode, source, class_level
  ) VALUES
    (b_sched, c10a, u_t_math, 'Scheduled: Trigonometry Warm-up', 'Mathematics', 'Trigonometry', 'Introduction', 'easy',
     'mcq', 'scheduled', now() + interval '2 days', 100, 20, 5, true, 'class', 'bank', 10),
    (b_live, c10a, u_s3, 'Live: Physics Electricity', 'Physics', 'Electricity', 'Current Electricity', 'medium',
     'mcq', 'live', now(), 100, 20, 5, true, 'class', 'bank', 10),
    (b_done, c10a, u_s1, 'Finished: Real Numbers Quiz', 'Mathematics', 'Real Numbers', 'Real Numbers', 'medium',
     'mcq', 'finished', now() - interval '2 days', 100, 20, 2, true, 'class', 'bank', 10)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, title = EXCLUDED.title;

  -- Pick question bank rows for battle questions
  SELECT id INTO _qb_id FROM public.question_bank
  WHERE is_approved AND subject = 'Mathematics' AND class_level = 10 LIMIT 1;

  INSERT INTO public.battle_questions (id, battle_id, order_index, question, options, correct_index, points, bank_question_id) VALUES
    (bq_done1, b_done, 0,
     'The HCF of 12 and 18 is:',
     '["6","12","3","9"]'::jsonb, 0, 10, _qb_id),
    (bq_done2, b_done, 1,
     'The value of sin 30° is:',
     '["1/2","√3/2","1","0"]'::jsonb, 0, 10,
     (SELECT id FROM public.question_bank WHERE is_approved AND subject = 'Mathematics' AND class_level = 10 OFFSET 1 LIMIT 1))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.battle_participants (
    id, battle_id, user_id, student_id, display_name,
    joined_at, finished_at, score, correct_count, answered_count, total_time_ms, rank
  ) VALUES
    (bp_done1, b_done, u_s1, st1, 'Arjun Mehta', now() - interval '2 days', now() - interval '2 days' + interval '90 seconds', 20, 2, 2, 45000, 1),
    (bp_done2, b_done, u_s3, st3, 'Rohan Singh', now() - interval '2 days', now() - interval '2 days' + interval '120 seconds', 10, 1, 2, 90000, 2)
  ON CONFLICT (battle_id, user_id) DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, finished_at = EXCLUDED.finished_at;

  INSERT INTO public.battle_answers (participant_id, question_id, selected_index, is_correct, time_ms) VALUES
    (bp_done1, bq_done1, 0, true, 20000),
    (bp_done1, bq_done2, 0, true, 25000),
    (bp_done2, bq_done1, 0, true, 40000),
    (bp_done2, bq_done2, 1, false, 50000)
  ON CONFLICT (participant_id, question_id) DO NOTHING;

  -- Battle invite (Rohan challenged by Arjun — pending)
  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id, status) VALUES
    (b_live, u_s1, u_s3, 'pending')
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  -- Battle feed events
  INSERT INTO public.battle_events (kind, actor_user_id, actor_name, opponent_name, subject, detail, battle_id, class_id, icon) VALUES
    ('win', u_s3, 'Rohan Singh', 'Arjun Mehta', 'Mathematics', 'won a close Real Numbers duel', b_done, c10a, 'trophy'),
    ('challenge', u_s3, 'Rohan Singh', NULL, 'Physics', 'threw down an Electricity challenge', b_live, c10a, 'swords'),
    ('badge', u_s1, 'Arjun Mehta', NULL, NULL, 'earned First Win badge', NULL, c10a, 'award')
  ON CONFLICT DO NOTHING;

  -- Battle report for finished participant (minimal valid report JSON)
  INSERT INTO public.battle_reports (participant_id, battle_id, user_id, display_name, report, expires_at) VALUES
    (bp_done1, b_done, u_s1, 'Arjun Mehta',
     jsonb_build_object(
       'summary', jsonb_build_object('score', 20, 'correct', 2, 'answered', 2, 'rank', 1, 'won', true),
       'comparison', jsonb_build_object('class_avg_score', 15, 'class_avg_accuracy', 75)
     ),
     now() + interval '20 hours')
  ON CONFLICT (participant_id) DO UPDATE SET report = EXCLUDED.report, expires_at = EXCLUDED.expires_at;

  -- ===================== DPPS =====================
  INSERT INTO public.dpps (
    id, title, subject, chapter, topic, class_id, created_by,
    difficulty, instructions, due_at, duration_sec, total_marks, negative_marking,
    is_published, question_count
  ) VALUES
    (dpp_pub, 'DPP — Quadratic Equations', 'Mathematics', 'Quadratic Equations', 'Nature of Roots',
     c10a, u_t_math, 'medium', 'No calculator. Show rough work in notebook.', now() + interval '5 days',
     1200, 2, 0.25, true, 2),
    (dpp_draft, 'Draft DPP — Light (unpublished)', 'Physics', 'Light', 'Reflection',
     c10a, u_t_phys, 'easy', 'For class test revision.', now() + interval '7 days',
     900, 0, 0, false, 0)
  ON CONFLICT (id) DO UPDATE SET is_published = EXCLUDED.is_published, title = EXCLUDED.title;

  INSERT INTO public.dpp_questions (id, dpp_id, order_index, kind, question, options, correct, marks, explanation) VALUES
    (dpp_q1, dpp_pub, 0, 'mcq',
     'The discriminant of ax² + bx + c = 0 is:',
     '["b² − 4ac","2a","−b/2a","b² + 4ac"]'::jsonb,
     '{"indexes":[0]}'::jsonb, 1, 'D = b² − 4ac'),
    (dpp_q2, dpp_pub, 1, 'mcq',
     'If roots are equal, discriminant equals:',
     '["0","1","b²","2ac"]'::jsonb,
     '{"indexes":[0]}'::jsonb, 1, 'Equal roots ⇒ D = 0')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.dpps SET question_count = 2, total_marks = 2 WHERE id = dpp_pub;

  INSERT INTO public.dpp_attempts (
    id, dpp_id, user_id, student_id, started_at, submitted_at,
    score, max_score, correct_count, total_count, time_spent_sec, status
  ) VALUES
    (dpp_att, dpp_pub, u_s1, st1, now() - interval '1 day', now() - interval '23 hours',
     2, 2, 2, 2, 420, 'submitted')
  ON CONFLICT (dpp_id, user_id) DO UPDATE SET status = EXCLUDED.status, score = EXCLUDED.score;

  INSERT INTO public.dpp_answers (attempt_id, question_id, response, is_correct, marks_awarded, time_ms) VALUES
    (dpp_att, dpp_q1, '{"indexes":[0]}'::jsonb, true, 1, 180000),
    (dpp_att, dpp_q2, '{"indexes":[0]}'::jsonb, true, 1, 200000)
  ON CONFLICT (attempt_id, question_id) DO NOTHING;

  -- In-progress attempt for student 2
  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count, status)
  VALUES (dpp_pub, u_s2, st2, 2, 2, 'in_progress')
  ON CONFLICT (dpp_id, user_id) DO NOTHING;

  -- ===================== NOTIFICATIONS =====================
  INSERT INTO public.notifications (user_id, type, title, body, icon, link, read) VALUES
    (u_s1, 'invite', 'Battle challenge!', 'Rohan Singh challenged you to a Physics battle.', 'swords', '/student/battleground/battle/' || b_live::text, false),
    (u_s1, 'notice', 'PTM reminder', 'Class 10-A PTM this Saturday.', 'bell', '/student/notices', false),
    (u_s2, 'homework', 'Homework graded', 'Your Mathematics submission was graded A.', 'book', '/student/homework', true),
    (u_p1, 'fee', 'Fee reminder', 'June fees pending for Arjun.', 'wallet', '/parent/fees', false),
    (u_t_math, 'leave', 'Leave pending', 'Vikram Joshi requested medical leave.', 'calendar', '/teacher/leaves', false),
    (u_principal, 'inquiry', 'New admission inquiry', 'Amit Deshmukh — Class 9 interest.', 'inbox', '/principal/cases', false)
  ON CONFLICT DO NOTHING;

  -- ===================== TIMETABLE =====================
  INSERT INTO public.class_timetables (class_id, grid, updated_by) VALUES
    (c10a, jsonb_build_object(
      'monday',    jsonb_build_array('Mathematics','Physics','English','Hindi','Chemistry'),
      'tuesday',   jsonb_build_array('Physics','Mathematics','Social Science','English','Games'),
      'wednesday', jsonb_build_array('Chemistry','Mathematics','Physics','Computer','Library'),
      'thursday',  jsonb_build_array('English','Mathematics','Physics','Hindi','Art'),
      'friday',    jsonb_build_array('Mathematics','Chemistry','Physics','Social Science','Assembly'),
      'saturday',  jsonb_build_array('DPP / Revision','Sports','—','—','—')
    ), u_t_math)
  ON CONFLICT (class_id) DO UPDATE SET grid = EXCLUDED.grid, updated_by = EXCLUDED.updated_by;

  -- ===================== STUDENT MISTAKES (coach / recovery / arena focus demo) =====================
  INSERT INTO public.student_mistakes (
    id, user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, mastered, last_wrong_at
  ) VALUES
    ('d9000003-0001-4000-8000-000000000001', u_s1, st1, 'practice', NULL,
     'd9000003-0001-4000-8000-000000000001', 10, 'Mathematics', 'Integrals', 'Power rule integration',
     'Integrals', 'Power rule', 'practice',
     'What is ∫ x² dx?',
     '["x³ + C", "x³/3 + C", "2x + C", "x²/2 + C"]'::jsonb,
     '{"indexes":[0]}'::jsonb,
     '{"indexes":[1]}'::jsonb,
     '∫ xⁿ dx = xⁿ⁺¹/(n+1) + C',
     2, false, now() - interval '2 days'),
    ('d9000003-0002-4000-8000-000000000002', u_s1, st1, 'practice', NULL,
     'd9000003-0002-4000-8000-000000000002', 10, 'Physics', 'Electricity', 'Coulomb''s law',
     'Electrostatics', 'Coulomb force', 'practice',
     'Two equal charges at distance d exert 1.2 N. At distance 2d the force is:',
     '["0.6 N", "1.2 N", "2.4 N", "4.8 N"]'::jsonb,
     '{"indexes":[0]}'::jsonb,
     '{"indexes":[1]}'::jsonb,
     'Coulomb''s law: F ∝ 1/r² — doubling distance halves the force when comparing proportional setups.',
     1, false, now() - interval '1 day'),
    ('d9000003-0003-4000-8000-000000000003', u_s1, st1, 'battleground', b_done,
     bq_done2, 10, 'Mathematics', 'Real Numbers', 'Euclid division',
     'Real Numbers', 'Division lemma', 'battle',
     'The HCF of 867 and 255 is:',
     '["3", "51", "17", "255"]'::jsonb,
     '{"indexes":[0]}'::jsonb,
     '{"indexes":[1]}'::jsonb,
     '867 = 255 × 3 + 102; continue Euclid steps → HCF 51',
     1, false, now() - interval '3 days')
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = EXCLUDED.times_wrong,
    question_text = EXCLUDED.question_text,
    student_answer = EXCLUDED.student_answer,
    correct_answer = EXCLUDED.correct_answer,
    mastered = EXCLUDED.mastered,
    last_wrong_at = EXCLUDED.last_wrong_at;

  -- ===================== APP SETTINGS =====================
  -- app_settings became per-school (PK is school_id); the old singleton `id`
  -- boolean column no longer exists.
  INSERT INTO public.app_settings (school_id, school_name, locale, currency, enable_notices, enable_fees, enable_leaves, updated_by) VALUES
    (_demo_school, 'Wisdom Campus Demo School', 'en-IN', 'INR', true, true, true, u_admin)
  ON CONFLICT (school_id) DO UPDATE SET
    school_name = EXCLUDED.school_name,
    enable_notices = EXCLUDED.enable_notices,
    enable_fees = EXCLUDED.enable_fees,
    enable_leaves = EXCLUDED.enable_leaves,
    updated_by = EXCLUDED.updated_by;

  -- ===================== AUDIT LOGS =====================
  INSERT INTO public.audit_logs (actor_user_id, action, entity, entity_id, metadata) VALUES
    (u_admin, 'demo_seed', 'migration', NULL, '{"note":"Wisdom Campus demo dataset applied"}'::jsonb),
    (u_principal, 'leave_review', 'leave_requests', 'd9000002-0003-4000-8000-000000000003', '{"status":"rejected"}'::jsonb)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Wisdom Campus demo data applied. Login: admin@wisdomcampus.com / DemoPass123! — see docs/DEMO_ACCOUNTS.md';
END $demo$;

DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);
