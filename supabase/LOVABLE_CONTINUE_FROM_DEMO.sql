-- Continue after a partial run failed in demo_data. Paste and RUN once.
ALTER TABLE public.library_books ADD COLUMN IF NOT EXISTS shelf_location TEXT DEFAULT '';


-- ========== 20260604120000_demo_data.sql ==========

-- =============================================================================
-- Wisdom Campus (SchoolFlow Connect) — Comprehensive demo dataset
-- Idempotent: fixed UUIDs + ON CONFLICT. Safe to re-run after schema migrations.
--
-- APPLY: Supabase Dashboard SQL editor, or `supabase db push` / migration up.
-- LOGIN: See docs/DEMO_ACCOUNTS.md — password DemoPass123! for all users.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Lovable library schema: books may lack shelf_location; checkouts use library_books_id
ALTER TABLE public.library_books ADD COLUMN IF NOT EXISTS shelf_location TEXT DEFAULT '';

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
  lib_book1   uuid := 'd7000001-0001-4000-8000-000000000001';
  lib_co1     uuid := 'd7000002-0001-4000-8000-000000000001';
  exam1       uuid := 'd8000001-0001-4000-8000-000000000001';
  exam2       uuid := 'd8000001-0002-4000-8000-000000000002';
  _qb_id      uuid;
  _today      date := CURRENT_DATE;
  _yr         text := '2025-26';
BEGIN
  -- ===================== AUTH USERS =====================
  PERFORM public._demo_upsert_auth_user(u_admin,     'admin@wisdomcampus.demo',           _pw, 'Ravi Krishnan');
  PERFORM public._demo_upsert_auth_user(u_principal, 'principal@wisdomcampus.demo',     _pw, 'Sunita Nair');
  PERFORM public._demo_upsert_auth_user(u_t_math,    'priya.sharma@wisdomcampus.demo',  _pw, 'Priya Sharma');
  PERFORM public._demo_upsert_auth_user(u_t_phys,    'rajesh.verma@wisdomcampus.demo',  _pw, 'Rajesh Verma');
  PERFORM public._demo_upsert_auth_user(u_s1,        'arjun.mehta@wisdomcampus.demo',   _pw, 'Arjun Mehta');
  PERFORM public._demo_upsert_auth_user(u_s2,        'priya.patel@wisdomcampus.demo',   _pw, 'Priya Patel');
  PERFORM public._demo_upsert_auth_user(u_s3,        'rohan.singh@wisdomcampus.demo',   _pw, 'Rohan Singh');
  PERFORM public._demo_upsert_auth_user(u_s4,        'ananya.iyer@wisdomcampus.demo',   _pw, 'Ananya Iyer');
  PERFORM public._demo_upsert_auth_user(u_s5,        'vikram.joshi@wisdomcampus.demo',  _pw, 'Vikram Joshi');
  PERFORM public._demo_upsert_auth_user(u_p1,        'mehta.parent@wisdomcampus.demo',  _pw, 'Suresh Mehta');
  PERFORM public._demo_upsert_auth_user(u_p2,        'patel.parent@wisdomcampus.demo',  _pw, 'Kavita Patel');

  -- Profiles (trigger may have created; ensure full data)
  INSERT INTO public.profiles (id, full_name, email) VALUES
    (u_admin,     'Ravi Krishnan',   'admin@wisdomcampus.demo'),
    (u_principal, 'Sunita Nair',     'principal@wisdomcampus.demo'),
    (u_t_math,    'Priya Sharma',    'priya.sharma@wisdomcampus.demo'),
    (u_t_phys,    'Rajesh Verma',    'rajesh.verma@wisdomcampus.demo'),
    (u_s1,        'Arjun Mehta',     'arjun.mehta@wisdomcampus.demo'),
    (u_s2,        'Priya Patel',     'priya.patel@wisdomcampus.demo'),
    (u_s3,        'Rohan Singh',     'rohan.singh@wisdomcampus.demo'),
    (u_s4,        'Ananya Iyer',     'ananya.iyer@wisdomcampus.demo'),
    (u_s5,        'Vikram Joshi',    'vikram.joshi@wisdomcampus.demo'),
    (u_p1,        'Suresh Mehta',    'mehta.parent@wisdomcampus.demo'),
    (u_p2,        'Kavita Patel',    'patel.parent@wisdomcampus.demo')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  -- Roles
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin,     'admin'),
    (u_principal, 'principal'),
    (u_t_math,    'teacher'),
    (u_t_phys,    'teacher'),
    (u_s1,        'student'),
    (u_s2,        'student'),
    (u_s3,        'student'),
    (u_s4,        'student'),
    (u_s5,        'student'),
    (u_p1,        'parent'),
    (u_p2,        'parent')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- ===================== CLASSES =====================
  INSERT INTO public.classes (id, name, section, academic_year, kind, display_name, category) VALUES
    (c10a, '10', 'A', _yr, 'class', 'Class 10-A', 'Secondary'),
    (c9a,  '9',  'A', _yr, 'class', 'Class 9-A',  'Secondary')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, section = EXCLUDED.section, academic_year = EXCLUDED.academic_year,
    display_name = EXCLUDED.display_name, category = EXCLUDED.category;

  -- ===================== TEACHERS =====================
  INSERT INTO public.teachers (
    id, user_id, full_name, subject, mobile, email,
    is_class_teacher, class_teacher_of, employee_id, department, qualification, joining_date, status
  ) VALUES
    (t_math, u_t_math, 'Priya Sharma', 'Mathematics', '9876501001', 'priya.sharma@wisdomcampus.demo',
     true, c10a, 'EMP-T-001', 'Mathematics', 'M.Sc Mathematics', '2018-06-01', 'active'),
    (t_phys, u_t_phys, 'Rajesh Verma', 'Physics', '9876501002', 'rajesh.verma@wisdomcampus.demo',
     false, NULL, 'EMP-T-002', 'Science', 'M.Sc Physics', '2019-07-15', 'active')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    is_class_teacher = EXCLUDED.is_class_teacher, class_teacher_of = EXCLUDED.class_teacher_of;

  INSERT INTO public.teacher_classes (teacher_id, class_id, subject) VALUES
    (t_math, c10a, 'Mathematics'),
    (t_math, c9a,  'Mathematics'),
    (t_phys, c10a, 'Physics')
  ON CONFLICT (teacher_id, class_id, subject) DO NOTHING;

  -- ===================== STUDENTS =====================
  INSERT INTO public.students (
    id, user_id, full_name, admission_number, roll_number, class_id,
    parent_user_id, parent_name, parent_mobile, address, date_of_birth
  ) VALUES
    (st1, u_s1, 'Arjun Mehta',   'WC10A001', '1', c10a, u_p1, 'Suresh Mehta',  '9876502001', '12, MG Road, Pune', '2010-03-15'),
    (st2, u_s2, 'Priya Patel',   'WC10A002', '2', c10a, u_p2, 'Kavita Patel',  '9876502002', '45, FC Road, Pune', '2010-07-22'),
    (st3, u_s3, 'Rohan Singh',   'WC10A003', '3', c10a, NULL, 'Harpreet Singh','9876502003', '8, Koregaon Park', '2010-01-08'),
    (st4, u_s4, 'Ananya Iyer',   'WC10A004', '4', c10a, NULL, 'Lakshmi Iyer',  '9876502004', '22, Baner Road',   '2010-11-30'),
    (st5, u_s5, 'Vikram Joshi',  'WC10A005', '5', c10a, NULL, 'Amit Joshi',    '9876502005', '3, Aundh',         '2010-05-18')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, class_id = EXCLUDED.class_id,
    parent_user_id = EXCLUDED.parent_user_id, roll_number = EXCLUDED.roll_number;

  -- ===================== ATTENDANCE =====================
  INSERT INTO public.attendance (student_id, class_id, date, status, marked_by) VALUES
    (st1, c10a, _today,     'present', u_t_math),
    (st2, c10a, _today,     'present', u_t_math),
    (st3, c10a, _today,     'absent',  u_t_math),
    (st4, c10a, _today,     'present', u_t_math),
    (st5, c10a, _today,     'leave',   u_t_math),
    (st1, c10a, _today - 1, 'present', u_t_math),
    (st2, c10a, _today - 1, 'present', u_t_math),
    (st3, c10a, _today - 1, 'present', u_t_math),
    (st4, c10a, _today - 1, 'absent',  u_t_math),
    (st5, c10a, _today - 1, 'present', u_t_math)
  ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by;

  INSERT INTO public.attendance_locks (class_id, date, locked_by) VALUES
    (c10a, _today - 2, u_t_math)
  ON CONFLICT (class_id, date) DO NOTHING;

  INSERT INTO public.attendance_audit (class_id, date, student_id, prev_status, new_status, edited_by) VALUES
    (c10a, _today - 2, st3, 'absent', 'present', u_principal);

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
  INSERT INTO public.homework (id, class_id, subject, title, description, due_date, created_by) VALUES
    (hw1, c10a, 'Mathematics', 'NCERT Ch 1 — Euclid''s Division Lemma',
     'Solve Ex 1.1 Q 1–5 and upload working.', _today + 3, u_t_math)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;

  INSERT INTO public.homework_submissions (id, homework_id, student_id, content, status, grade, teacher_remarks, submitted_at, graded_at) VALUES
    (hw_sub1, hw1, st1, 'Completed all five questions with steps.', 'graded', 'A', 'Neat presentation', now() - interval '1 day', now())
  ON CONFLICT (homework_id, student_id) DO UPDATE SET status = EXCLUDED.status, grade = EXCLUDED.grade;

  INSERT INTO public.homework_submissions (homework_id, student_id, content, status, submitted_at) VALUES
    (hw1, st2, 'Submitted — pending review', 'submitted', now() - interval '2 hours')
  ON CONFLICT (homework_id, student_id) DO NOTHING;

  -- ===================== LIBRARY (Lovable schema: optional shelf_location; library_books_id) =====================
  INSERT INTO public.library_books (id, title, author, isbn, category, total_copies, available_copies) VALUES
    (lib_book1, 'Mathematics — Class X (NCERT)', 'NCERT', '978-81-7450-634-4', 'Textbook', 5, 4),
    ('d7000001-0002-4000-8000-000000000002', 'Science — Class X (NCERT)', 'NCERT', '978-81-7450-636-8', 'Textbook', 5, 5),
    ('d7000001-0003-4000-8000-000000000003', 'Physics Refresher', 'H.C. Verma', '978-8177091878', 'Reference', 2, 2)
  ON CONFLICT (id) DO UPDATE SET available_copies = EXCLUDED.available_copies;

  INSERT INTO public.library_checkouts (id, library_books_id, student_id, due_date, status) VALUES
    (lib_co1, lib_book1, st1, _today + 10, 'borrowed')
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

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

  -- ===================== STAFF ATTENDANCE =====================
  INSERT INTO public.staff_attendance (teacher_id, date, status, marked_by) VALUES
    (t_math, _today,     'present', u_principal),
    (t_phys, _today,     'present', u_principal),
    (t_math, _today - 1, 'present', u_principal)
  ON CONFLICT (teacher_id, date) DO NOTHING;

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

  -- ===================== APP SETTINGS =====================
  INSERT INTO public.app_settings (id, school_name, locale, currency, enable_notices, enable_fees, enable_leaves, updated_by) VALUES
    (true, 'Wisdom Campus Demo School', 'en-IN', 'INR', true, true, true, u_admin)
  ON CONFLICT (id) DO UPDATE SET
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

  RAISE NOTICE 'Wisdom Campus demo data applied. Login: admin@wisdomcampus.demo / DemoPass123! — see docs/DEMO_ACCOUNTS.md';
END $demo$;

DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);


-- ========== 20260609000000_fix_quick_battle_overload.sql ==========

-- Fix: "Could not choose the best candidate function" for rpc_create_quick_battle
-- Cause: 6-arg version (20260513) + 7-arg version (phase4) both exist after partial migrations.

DROP FUNCTION IF EXISTS public.rpc_create_quick_battle(text, text, integer, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.rpc_create_quick_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _class_id uuid DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (
    'Quick Battle · ' || _subject || COALESCE(' · ' || _chapter, ''),
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now()
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;


-- ========== 20260610000000_battleground_overhaul.sql ==========

-- Battleground: solo privacy, open/class lobbies, auto-finish battles, class-scoped curriculum

-- Helper: mark battle finished when appropriate
CREATE OR REPLACE FUNCTION public._maybe_finish_battle(_battle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b record; _total int; _done int;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL OR _b.status = 'finished' THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE finished_at IS NOT NULL)
    INTO _total, _done
  FROM public.battle_participants WHERE battle_id = _battle_id;

  IF _b.mode = 'solo' AND _done >= 1 THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
    RETURN;
  END IF;

  IF _total >= 2 AND _done = _total THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
    RETURN;
  END IF;

  IF _b.mode IN ('open', 'lobby') AND _total >= 1 AND _done = _total AND _done > 0 THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
  END IF;
END; $$;

-- Class grade from class id
CREATE OR REPLACE FUNCTION public._class_grade(_class_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (regexp_match(COALESCE(c.name, c.display_name, ''), '\m(6|7|8|9|10|11|12)\M'))[1]::int
  FROM public.classes c WHERE c.id = _class_id;
$$;

-- Curriculum filtered by class grade when class_id provided
CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text, _class_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', sub.chapter,
    'topic', sub.topic
  ) ORDER BY sub.chapter, sub.topic), '[]'::jsonb)
  FROM (
    SELECT DISTINCT
      COALESCE(NULLIF(trim(chapter), ''), 'General') AS chapter,
      NULLIF(trim(topic), '') AS topic
    FROM public.question_bank
    WHERE is_approved AND lower(subject) = lower(_subject)
      AND (
        _class_id IS NULL
        OR class_level IS NULL
        OR class_level = public._class_grade(_class_id)
      )
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_battle_curriculum(text, uuid) TO authenticated;

-- Solo practice: private, not listed in open battles
DROP FUNCTION IF EXISTS public.rpc_create_quick_battle(text, text, integer, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.rpc_create_quick_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _class_id uuid DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    'Solo Practice · ' || _subject || COALESCE(' · ' || _chapter, ''),
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, false, 'solo', 'bank', now(), _grade
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;

-- Open lobby: anyone in school can join
CREATE OR REPLACE FUNCTION public.rpc_create_open_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _topic text DEFAULT NULL,
  _class_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    'Open Battle · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'open', 'bank', now(), _grade
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_open_battle(text, text, int, int, text, text, uuid) TO authenticated;

-- Class lobby: only same class_id
CREATE OR REPLACE FUNCTION public.rpc_create_class_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _topic text DEFAULT NULL,
  _class_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to host a class battle'; END IF;
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    'Class Battle · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'lobby', 'bank', now(), _grade
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_class_battle(text, text, int, int, text, text, uuid) TO authenticated;

-- Patch finish_battle: idempotent + auto-finish battle row
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
  _subject text; _class uuid; _name text; _opp text; _participants int;
  _mins int; _already timestamptz;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms, display_name, finished_at
    INTO _user, _battle, _score, _correct, _answered, _time, _name, _already
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN RAISE EXCEPTION 'Not your participation'; END IF;
  IF _already IS NOT NULL THEN
    PERFORM public._maybe_finish_battle(_battle);
    RETURN;
  END IF;

  UPDATE public.battle_participants SET finished_at = now() WHERE id = _participant_id;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score), count(*) INTO _max_score, _participants
    FROM public.battle_participants WHERE battle_id = _battle;
  _won := (_score = _max_score AND _score > 0 AND _participants > 1);

  INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
  SELECT _user, bq.bank_question_id, 1, now()
  FROM public.battle_answers ba
  JOIN public.battle_questions bq ON bq.id = ba.question_id
  WHERE ba.participant_id = _participant_id AND bq.bank_question_id IS NOT NULL
  ON CONFLICT (user_id, question_id) DO UPDATE
    SET times_seen = student_question_history.times_seen + 1, last_seen_at = now();

  INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
    best_score, total_correct, total_answered, win_streak, best_win_streak, current_streak, longest_streak)
  VALUES (_user, _score, 1 + (_score/100), 1, CASE WHEN _won THEN 1 ELSE 0 END, now(),
    _score, _correct, _answered, CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END,
    CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END)
  ON CONFLICT (user_id) DO UPDATE SET
    xp              = student_xp.xp + EXCLUDED.xp,
    level           = 1 + ((student_xp.xp + EXCLUDED.xp)/100),
    total_battles   = student_xp.total_battles + 1,
    wins            = student_xp.wins + CASE WHEN _won THEN 1 ELSE 0 END,
    last_battle_at  = now(),
    best_score      = GREATEST(student_xp.best_score, _score),
    total_correct   = student_xp.total_correct + _correct,
    total_answered  = student_xp.total_answered + _answered,
    win_streak      = CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END,
    best_win_streak = GREATEST(student_xp.best_win_streak,
                               CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END),
    updated_at      = now(),
    current_streak  = CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END,
    longest_streak  = GREATEST(COALESCE(student_xp.longest_streak, 0),
                      CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END);

  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _user;
  _avg_ms := CASE WHEN _answered > 0 THEN _time::numeric / _answered ELSE NULL END;
  _hour   := EXTRACT(HOUR FROM now());

  IF _won THEN PERFORM public._award_badge(_user,'first_win','bronze'); END IF;
  IF _correct >= 5 THEN PERFORM public._award_badge(_user,'sharp_shooter','silver'); END IF;
  IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user,'flawless','gold'); END IF;

  SELECT b.subject, b.class_id INTO _subject, _class FROM public.battles b WHERE b.id = _battle;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_capture_battle_mistakes') THEN
    PERFORM public._capture_battle_mistakes(_participant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_bump_academic_activity') THEN
    _mins := GREATEST(COALESCE(_time / 60000, 1), 1);
    PERFORM public._bump_academic_activity(_user, 0, 0, 1, _mins);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_award_engagement_badges') THEN
    PERFORM public._award_engagement_badges(_user);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_snapshot_battle_report') THEN
    PERFORM public._snapshot_battle_report(_participant_id);
  END IF;

  PERFORM public._maybe_finish_battle(_battle);
END; $$;

-- Duel challenges: private, not in open lobby list
CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    _name || ' challenges you · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, false, 'duel', 'bank', now(), _grade
  ) RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
  VALUES (_bid, _opponent_user_id, auth.uid())
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event('challenge', auth.uid(), _name,
      'threw down a ' || _subject || ' challenge',
      _subject, NULL, _bid, _cid, 'swords');
  END IF;

  RETURN _bid;
END; $$;

-- Clean up stale solo/duel battles stuck in live list
UPDATE public.battles SET status = 'finished'
WHERE mode IN ('solo', 'duel') AND status IN ('live', 'scheduled')
  AND EXISTS (
    SELECT 1 FROM public.battle_participants bp
    WHERE bp.battle_id = battles.id AND bp.finished_at IS NOT NULL
  );


-- ========== 20260611000000_question_template_engine.sql ==========

-- CBSE Class 12 Mathematics — parametric question template engine

CREATE TABLE IF NOT EXISTS public.question_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class int NOT NULL,
  subject text NOT NULL,
  chapter text NOT NULL,
  template_type text NOT NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation_template text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_templates_chapter
  ON public.question_templates (class, subject, chapter) WHERE is_active;

CREATE INDEX IF NOT EXISTS question_templates_type
  ON public.question_templates (template_type);

CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  chapter text NOT NULL,
  question_count int NOT NULL DEFAULT 10,
  correct_count int NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.question_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.question_templates(id) ON DELETE CASCADE,
  generated_question jsonb NOT NULL,
  selected_answer jsonb,
  correct_answer jsonb NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  is_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_attempts_student
  ON public.question_attempts (student_id, created_at DESC);

ALTER TABLE public.question_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates read all" ON public.question_templates;
CREATE POLICY "templates read all" ON public.question_templates
  FOR SELECT TO authenticated USING (is_active);

DROP POLICY IF EXISTS "practice sessions self" ON public.practice_sessions;
CREATE POLICY "practice sessions self" ON public.practice_sessions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "question attempts self" ON public.question_attempts;
CREATE POLICY "question attempts self" ON public.question_attempts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Randomly pick template IDs for a practice session (generation happens client-side)
CREATE OR REPLACE FUNCTION public.rpc_pick_question_templates(
  _class int,
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS SETOF public.question_templates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
  FROM public.question_templates
  WHERE class = _class
    AND lower(subject) = lower(_subject)
    AND chapter = _chapter
    AND is_active
  ORDER BY random()
  LIMIT GREATEST(_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.rpc_pick_question_templates(int, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_start_practice_session(
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _sid uuid; _student uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  INSERT INTO public.practice_sessions (student_id, user_id, subject, chapter, question_count)
  VALUES (_student, _uid, _subject, _chapter, _count)
  RETURNING id INTO _sid;
  RETURN _sid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_start_practice_session(text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _correct_answer jsonb,
  _selected_answer jsonb DEFAULT NULL,
  _is_correct boolean DEFAULT NULL,
  _score numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _student uuid; _aid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct
  ) VALUES (
    _session_id, _student, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct
  ) RETURNING id INTO _aid;

  IF _is_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1, score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
  END IF;
  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record;
BEGIN
  UPDATE public.practice_sessions SET finished_at = now()
    WHERE id = _session_id AND user_id = auth.uid()
    RETURNING * INTO _s;
  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'score', _s.score
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid) TO authenticated;


-- ========== 20260612000000_ai_and_audit_fixes.sql ==========

-- AI report fixes: ensure snapshot exists, secure AI insights save, on-demand snapshot

CREATE OR REPLACE FUNCTION public.rpc_ensure_battle_report(_participant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _p FROM public.battle_participants WHERE id = _participant_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Participant not found'; END IF;
  IF _p.user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'principal')
     AND NOT EXISTS (
       SELECT 1 FROM public.battles b
       WHERE b.id = _p.battle_id
         AND (b.creator_user_id = auth.uid()
           OR public.teacher_teaches_class(auth.uid(), b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _p.finished_at IS NULL THEN
    RAISE EXCEPTION 'Finish the battle first to view the report';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.battle_reports WHERE participant_id = _participant_id) THEN
    PERFORM public._snapshot_battle_report(_participant_id);
  END IF;

  RETURN public.rpc_get_battle_report(_participant_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_battle_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_save_battle_ai_insights(
  _participant_id uuid,
  _insights jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id INTO _owner FROM public.battle_reports WHERE participant_id = _participant_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF _owner <> _uid
     AND NOT public.has_role(_uid, 'admin')
     AND NOT public.has_role(_uid, 'principal')
     AND NOT EXISTS (
       SELECT 1 FROM public.battle_reports br
       JOIN public.battles b ON b.id = br.battle_id
       WHERE br.participant_id = _participant_id
         AND (b.creator_user_id = _uid OR public.teacher_teaches_class(_uid, b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.battle_reports
    SET ai_insights = _insights
    WHERE participant_id = _participant_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_save_battle_ai_insights(uuid, jsonb) TO authenticated;


-- ========== 20260613000000_concept_mastery_recovery.sql ==========

-- Concept Mastery & Mistake Recovery System
-- Extends Student Success Phases 1-3 with concept tagging, mastery scores, recovery assignments.

-- ── Concept columns on question sources ───────────────────────────────────────
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.dpp_questions
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS chapter text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.question_templates
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text,
  ADD COLUMN IF NOT EXISTS assessment_type text;

UPDATE public.student_mistakes SET assessment_type = source WHERE assessment_type IS NULL;

-- ── Concept mastery per student ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concept_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  class_level int,
  subject text NOT NULL,
  chapter text,
  concept text NOT NULL,
  subconcept text,
  mastery_score numeric NOT NULL DEFAULT 0 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  total_attempts int NOT NULL DEFAULT 0,
  correct_attempts int NOT NULL DEFAULT 0,
  recovery_attempts int NOT NULL DEFAULT 0,
  recovery_correct int NOT NULL DEFAULT 0,
  mistake_count int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS concept_mastery_user_concept
  ON public.concept_mastery (
    user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, '')
  );

CREATE INDEX IF NOT EXISTS concept_mastery_user_score
  ON public.concept_mastery (user_id, mastery_score ASC);

ALTER TABLE public.concept_mastery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mastery self" ON public.concept_mastery;
CREATE POLICY "mastery self" ON public.concept_mastery
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mastery parent" ON public.concept_mastery;
CREATE POLICY "mastery parent" ON public.concept_mastery
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = concept_mastery.user_id AND s.parent_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "mastery teacher" ON public.concept_mastery;
CREATE POLICY "mastery teacher" ON public.concept_mastery
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = concept_mastery.user_id AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── Recovery assignments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recovery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subject text NOT NULL,
  chapter text,
  concept text NOT NULL,
  subconcept text,
  severity text NOT NULL CHECK (severity IN ('minor', 'moderate', 'severe')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  question_count int NOT NULL DEFAULT 0,
  questions_completed int NOT NULL DEFAULT 0,
  questions_correct int NOT NULL DEFAULT 0,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS recovery_assignments_user_open
  ON public.recovery_assignments (user_id, status) WHERE status IN ('pending', 'in_progress');

ALTER TABLE public.recovery_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery self" ON public.recovery_assignments;
CREATE POLICY "recovery self" ON public.recovery_assignments
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.recovery_assignment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.recovery_assignments(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  question_text text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text,
  bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.question_templates(id) ON DELETE SET NULL,
  answered boolean NOT NULL DEFAULT false,
  is_correct boolean,
  student_answer jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_questions_assignment
  ON public.recovery_assignment_questions (assignment_id, order_index);

ALTER TABLE public.recovery_assignment_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery q via assignment" ON public.recovery_assignment_questions;
CREATE POLICY "recovery q via assignment" ON public.recovery_assignment_questions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.recovery_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.recovery_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid())
  );

-- ── Concept tag helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._humanize_template_type(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT initcap(replace(replace(_t, '_', ' '), 'rf ', 'Relations '));
$$;

CREATE OR REPLACE FUNCTION public._backfill_question_bank_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.question_bank SET
    concept = COALESCE(NULLIF(concept, ''), NULLIF(topic, ''), NULLIF(chapter, ''), subject),
    subconcept = COALESCE(NULLIF(subconcept, ''), NULLIF(topic, ''), concept)
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_dpp_question_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.dpp_questions dq SET
    class_level = COALESCE(
      dq.class_level,
      CASE WHEN c.name ~ '^[0-9]+$' THEN c.name::int ELSE NULL END
    ),
    subject = COALESCE(dq.subject, d.subject),
    chapter = COALESCE(dq.chapter, d.chapter),
    concept = COALESCE(NULLIF(dq.concept, ''), NULLIF(dq.subconcept, ''), NULLIF(d.topic, ''), NULLIF(d.chapter, ''), d.subject),
    subconcept = COALESCE(NULLIF(dq.subconcept, ''), NULLIF(d.topic, ''), dq.concept)
  FROM public.dpps d
  LEFT JOIN public.classes c ON c.id = d.class_id
  WHERE dq.dpp_id = d.id AND (dq.concept IS NULL OR dq.concept = '');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_battle_question_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.battle_questions bq SET
    concept = v.new_concept,
    subconcept = v.new_subconcept
  FROM (
    SELECT
      bq2.id,
      COALESCE(NULLIF(bq2.concept, ''), NULLIF(qb.concept, ''), NULLIF(qb.topic, ''), NULLIF(b.chapter, ''), b.subject) AS new_concept,
      COALESCE(NULLIF(bq2.subconcept, ''), NULLIF(qb.subconcept, ''), NULLIF(qb.topic, ''), bq2.concept) AS new_subconcept
    FROM public.battle_questions bq2
    INNER JOIN public.battles b ON bq2.battle_id = b.id
    LEFT JOIN public.question_bank qb ON qb.id = bq2.bank_question_id
    WHERE bq2.concept IS NULL OR bq2.concept = ''
  ) v
  WHERE bq.id = v.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_template_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.question_templates SET
    concept = COALESCE(NULLIF(concept, ''), chapter),
    subconcept = COALESCE(NULLIF(subconcept, ''), public._humanize_template_type(template_type))
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_backfill_question_concepts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'principal') THEN
    RAISE EXCEPTION 'Admin or principal only';
  END IF;
  RETURN jsonb_build_object(
    'question_bank', public._backfill_question_bank_concepts(),
    'dpp_questions', public._backfill_dpp_question_concepts(),
    'battle_questions', public._backfill_battle_question_concepts(),
    'question_templates', public._backfill_template_concepts()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_backfill_question_concepts() TO authenticated;

-- Run backfill on migration
SELECT public._backfill_question_bank_concepts();
SELECT public._backfill_dpp_question_concepts();
SELECT public._backfill_battle_question_concepts();
SELECT public._backfill_template_concepts();

-- ── Mastery computation ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._compute_mastery_score(
  _attempts int, _correct int, _recovery_attempts int, _recovery_correct int, _mistakes int, _last_at timestamptz
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _acc numeric := CASE WHEN _attempts > 0 THEN 100.0 * _correct / _attempts ELSE 50 END;
  _rec numeric := CASE WHEN _recovery_attempts > 0 THEN 100.0 * _recovery_correct / _recovery_attempts ELSE _acc END;
  _cons numeric := CASE WHEN _attempts >= 8 THEN LEAST(100, _acc + 5) WHEN _attempts >= 4 THEN _acc ELSE _acc * 0.9 END;
  _recency numeric := CASE
    WHEN _last_at IS NULL THEN 40
    WHEN _last_at >= now() - interval '3 days' THEN 100
    WHEN _last_at >= now() - interval '14 days' THEN 75
    WHEN _last_at >= now() - interval '30 days' THEN 50
    ELSE 30
  END;
  _penalty numeric := LEAST(25, _mistakes * 3);
BEGIN
  RETURN LEAST(100, GREATEST(0, round(
    0.45 * _acc + 0.25 * _rec + 0.15 * _cons + 0.15 * _recency - _penalty, 1
  )));
END; $$;

CREATE OR REPLACE FUNCTION public._upsert_concept_mastery(
  _uid uuid, _sid uuid, _class int, _subject text, _chapter text, _concept text, _subconcept text,
  _is_correct boolean, _is_recovery boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _mistakes int;
BEGIN
  IF _concept IS NULL OR _concept = '' THEN
    _concept := COALESCE(_chapter, _subject, 'General');
  END IF;

  SELECT count(*)::int INTO _mistakes FROM public.student_mistakes
  WHERE user_id = _uid AND NOT mastered
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND COALESCE(concept, topic, '') = COALESCE(_concept, '');

  INSERT INTO public.concept_mastery (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    total_attempts, correct_attempts, recovery_attempts, recovery_correct,
    mistake_count, last_attempt_at, mastery_score, updated_at
  ) VALUES (
    _uid, _sid, _class, _subject, _chapter, _concept, _subconcept,
    1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    _mistakes, now(),
    public._compute_mastery_score(
      1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    now()
  )
  ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
  DO UPDATE SET
    student_id = COALESCE(EXCLUDED.student_id, concept_mastery.student_id),
    class_level = COALESCE(EXCLUDED.class_level, concept_mastery.class_level),
    total_attempts = concept_mastery.total_attempts + 1,
    correct_attempts = concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
    recovery_attempts = concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    recovery_correct = concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    mistake_count = _mistakes,
    last_attempt_at = now(),
    mastery_score = public._compute_mastery_score(
      concept_mastery.total_attempts + 1,
      concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
      concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    updated_at = now();
END; $$;

-- ── Unified mistake recording with concepts ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(
  _assessment_type text,
  _source_id uuid,
  _question_id uuid DEFAULT NULL,
  _subject text DEFAULT 'General',
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _class_level int DEFAULT NULL,
  _question_text text DEFAULT '',
  _options jsonb DEFAULT '[]'::jsonb,
  _student_answer jsonb DEFAULT '{}'::jsonb,
  _correct_answer jsonb DEFAULT '{}'::jsonb,
  _explanation text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at
  ) VALUES (
    _uid, _sid,
    CASE _assessment_type
      WHEN 'battle' THEN 'battleground'
      WHEN 'practice' THEN 'practice'
      ELSE _assessment_type
    END,
    _source_id, _question_id,
    _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _assessment_type,
    _question_text, _options, _student_answer, _correct_answer, _explanation,
    1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    mastered = false
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  RETURN _mid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, int, text, jsonb, jsonb, jsonb, text) TO authenticated;

-- ── Severity from accuracy ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._concept_severity(_accuracy numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _accuracy < 35 THEN 'severe'
    WHEN _accuracy < 55 THEN 'moderate'
    ELSE 'minor'
  END;
$$;

CREATE OR REPLACE FUNCTION public._recovery_question_count(_severity text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _severity
    WHEN 'severe' THEN 12
    WHEN 'moderate' THEN 6
    ELSE 3
  END;
$$;

-- ── Assign recovery questions for a weak concept ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_assign_concept_recovery(
  _subject text,
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _accuracy numeric DEFAULT 40,
  _source_type text DEFAULT NULL,
  _source_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _severity text; _cnt int; _aid uuid; _concept_f text;
  _qb record; _tm record; _idx int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _severity := public._concept_severity(_accuracy);
  _cnt := public._recovery_question_count(_severity);

  IF EXISTS (
    SELECT 1 FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept_f AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  ) THEN
    SELECT id INTO _aid FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND concept = _concept_f
    ORDER BY created_at DESC LIMIT 1;
    RETURN _aid;
  END IF;

  INSERT INTO public.recovery_assignments (
    user_id, student_id, subject, chapter, concept, subconcept,
    severity, question_count, source_type, source_id
  ) VALUES (
    _uid, _sid, _subject, _chapter, _concept_f, _subconcept,
    _severity, _cnt, _source_type, _source_id
  ) RETURNING id INTO _aid;

  FOR _qb IN
    SELECT id, question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_subject)
      AND (_chapter IS NULL OR chapter ILIKE '%' || _chapter || '%' OR concept ILIKE '%' || _concept_f || '%')
      AND (concept ILIKE '%' || _concept_f || '%' OR topic ILIKE '%' || _concept_f || '%' OR chapter ILIKE '%' || _concept_f || '%')
    ORDER BY random() LIMIT _cnt
  LOOP
    _idx := _idx + 1;
    INSERT INTO public.recovery_assignment_questions (
      assignment_id, order_index, question_text, options, correct_answer, explanation, bank_question_id
    ) VALUES (
      _aid, _idx, _qb.question, _qb.options,
      jsonb_build_object('correct_index', _qb.correct_index),
      _qb.explanation, _qb.id
    );
  END LOOP;

  IF _idx < _cnt AND lower(_subject) LIKE '%math%' THEN
    FOR _tm IN
      SELECT id, chapter, template_type, explanation_template
      FROM public.question_templates
      WHERE is_active AND class = 12 AND lower(subject) = 'mathematics'
        AND (_chapter IS NULL OR chapter = _chapter)
        AND (concept = _concept_f OR subconcept ILIKE '%' || COALESCE(_subconcept, _concept_f) || '%')
      ORDER BY random() LIMIT (_cnt - _idx)
    LOOP
      _idx := _idx + 1;
      INSERT INTO public.recovery_assignment_questions (
        assignment_id, order_index, question_text, options, correct_answer, explanation, template_id
      ) VALUES (
        _aid, _idx,
        'Practice: ' || public._humanize_template_type(_tm.template_type) || ' (' || _tm.chapter || ')',
        '["Option A","Option B","Option C","Option D"]'::jsonb,
        '{"correct_index":0,"note":"Complete via Class 12 Math practice for full generated question"}'::jsonb,
        _tm.explanation_template, _tm.id
      );
    END LOOP;
  END IF;

  UPDATE public.recovery_assignments SET question_count = _idx WHERE id = _aid;

  IF NOT EXISTS (
    SELECT 1 FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _subject AND COALESCE(topic, '') = _concept_f AND reason = 'concept_recovery'
  ) THEN
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (_uid, _sid, _subject, _chapter, _concept_f, 'concept_recovery', 95, CURRENT_DATE);
  END IF;

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;

-- ── Read-only concept report builder (no side effects) ────────────────────────
CREATE OR REPLACE FUNCTION public._build_concept_recovery_report(
  _source_type text,
  _source_id uuid,
  _uid uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total int := 0; _correct int := 0; _time_sec int := 0;
  _weak jsonb := '[]'::jsonb; _strong jsonb := '[]'::jsonb; _row record;
BEGIN

  IF _source_type = 'dpp_attempt' THEN
    SELECT att.correct_count, att.total_count, att.time_spent_sec
      INTO _correct, _total, _time_sec
    FROM public.dpp_attempts att WHERE att.id = _source_id AND att.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(dq.subject, d.subject, 'General') AS subject,
        COALESCE(dq.chapter, d.chapter) AS chapter,
        COALESCE(dq.concept, dq.subconcept, d.topic, d.chapter, d.subject) AS concept,
        dq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE da.is_correct)::int AS correct
      FROM public.dpp_answers da
      JOIN public.dpp_questions dq ON dq.id = da.question_id
      JOIN public.dpp_attempts att ON att.id = da.attempt_id
      JOIN public.dpps d ON d.id = att.dpp_id
      WHERE att.id = _source_id AND att.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'subconcept', _row.subconcept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1),
          'attempts', _row.attempts, 'correct', _row.correct
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'battle_participant' THEN
    SELECT bp.correct_count, bp.answered_count,
           GREATEST(EXTRACT(EPOCH FROM (bp.finished_at - bp.joined_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.battle_participants bp WHERE bp.id = _source_id AND bp.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(b.subject, 'General') AS subject,
        b.chapter,
        b.class_level,
        COALESCE(bq.concept, b.topic, b.chapter, b.subject) AS concept,
        bq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE ba.is_correct)::int AS correct
      FROM public.battle_answers ba
      JOIN public.battle_questions bq ON bq.id = ba.question_id
      JOIN public.battle_participants bp ON bp.id = ba.participant_id
      JOIN public.battles b ON b.id = bp.battle_id
      WHERE bp.id = _source_id AND bp.user_id = _uid
      GROUP BY 1, 2, 3, 4, 5
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'practice_session' THEN
    SELECT ps.correct_count, ps.question_count,
           GREATEST(EXTRACT(EPOCH FROM (ps.finished_at - ps.created_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;

    FOR _row IN
      SELECT
        ps.subject,
        ps.chapter,
        COALESCE(qt.concept, qt.chapter) AS concept,
        qt.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE qa.is_correct)::int AS correct
      FROM public.question_attempts qa
      JOIN public.practice_sessions ps ON ps.id = qa.session_id
      JOIN public.question_templates qt ON qt.id = qa.template_id
      WHERE ps.id = _source_id AND ps.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown source_type: %', _source_type;
  END IF;

  RETURN jsonb_build_object(
    'source_type', _source_type,
    'source_id', _source_id,
    'accuracy_pct', CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) ELSE 0 END,
    'correct_count', _correct,
    'total_count', _total,
    'time_sec', _time_sec,
    'time_minutes', round(COALESCE(_time_sec, 0) / 60.0, 1),
    'weak_concepts', _weak,
    'strong_concepts', _strong,
    'improvement_areas', (
      SELECT COALESCE(jsonb_agg(w->>'concept'), '[]'::jsonb)
      FROM jsonb_array_elements(_weak) w
    )
  );
END; $$;

-- Read-only report for result pages (safe to call on every view)
CREATE OR REPLACE FUNCTION public.rpc_get_concept_recovery_report(_source_type text, _source_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _report jsonb; _assignments jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assignment_id', id, 'concept', concept, 'severity', severity, 'status', status
  )), '[]'::jsonb)
    INTO _assignments
  FROM public.recovery_assignments
  WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id;

  RETURN _report || jsonb_build_object('recovery_assignments', _assignments);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_concept_recovery_report(text, uuid) TO authenticated;

-- One-shot post-assessment: assign recovery + rebuild revision (idempotent per source)
CREATE OR REPLACE FUNCTION public.rpc_post_assessment_concept_analysis(
  _source_type text,
  _source_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _report jsonb;
  _weak jsonb; _w record; _aid uuid; _assignments jsonb := '[]'::jsonb;
  _already boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;
  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);
  _weak := _report->'weak_concepts';

  SELECT EXISTS (
    SELECT 1 FROM public.recovery_assignments
    WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id
  ) INTO _already;

  IF NOT _already THEN
    FOR _w IN SELECT * FROM jsonb_to_recordset(_weak) AS x(
      subject text, chapter text, concept text, subconcept text, accuracy numeric
    ) LOOP
      _aid := public.rpc_assign_concept_recovery(
        _w.subject, _w.chapter, _w.concept, _w.subconcept,
        _w.accuracy, _source_type, _source_id
      );
      _assignments := _assignments || jsonb_build_array(jsonb_build_object(
        'assignment_id', _aid, 'concept', _w.concept,
        'severity', public._concept_severity(_w.accuracy)
      ));
    END LOOP;
    PERFORM public._rebuild_revision_queue(_uid, _sid);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'assignment_id', id, 'concept', concept, 'severity', severity
    )), '[]'::jsonb)
      INTO _assignments
    FROM public.recovery_assignments
    WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id;
  END IF;

  RETURN _report || jsonb_build_object('recovery_assignments', _assignments);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_post_assessment_concept_analysis(text, uuid) TO authenticated;

-- ── Recovery zone dashboard ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_recovery_zone()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _pending int; _weak jsonb; _mastery jsonb; _open jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT count(*)::int INTO _pending FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _weak
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score < 60
  LIMIT 12;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score
  ) ORDER BY mastery_score DESC), '[]'::jsonb)
    INTO _mastery
  FROM public.concept_mastery
  WHERE user_id = _uid
  LIMIT 20;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'chapter', chapter, 'concept', concept,
    'severity', severity, 'status', status,
    'question_count', question_count, 'questions_completed', questions_completed,
    'created_at', created_at
  ) ORDER BY
    CASE severity WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
    created_at DESC), '[]'::jsonb)
    INTO _open
  FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress')
  LIMIT 15;

  RETURN jsonb_build_object(
    'pending_count', _pending,
    'weak_concepts', _weak,
    'mastery', _mastery,
    'open_assignments', _open
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_recovery_zone() TO authenticated;

-- ── Recovery session: load assignment ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_recovery_assignment(_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a record; _questions jsonb;
BEGIN
  SELECT * INTO _a FROM public.recovery_assignments
  WHERE id = _assignment_id AND user_id = auth.uid();
  IF _a IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  IF _a.status = 'pending' THEN
    UPDATE public.recovery_assignments SET status = 'in_progress' WHERE id = _assignment_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'order_index', q.order_index,
    'question_text', q.question_text, 'options', q.options,
    'answered', q.answered, 'is_correct', q.is_correct,
    'explanation', q.explanation
  ) ORDER BY q.order_index), '[]'::jsonb)
    INTO _questions
  FROM public.recovery_assignment_questions q
  WHERE q.assignment_id = _assignment_id;

  RETURN jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', _a.id, 'subject', _a.subject, 'chapter', _a.chapter,
      'concept', _a.concept, 'subconcept', _a.subconcept,
      'severity', _a.severity, 'status', _a.status,
      'question_count', _a.question_count,
      'questions_completed', _a.questions_completed,
      'questions_correct', _a.questions_correct
    ),
    'questions', _questions
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_recovery_assignment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_answer(
  _question_id uuid,
  _student_answer jsonb,
  _is_correct boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record; _a record; _uid uuid := auth.uid(); _done boolean;
BEGIN
  SELECT q.*, a.user_id, a.student_id, a.subject, a.chapter, a.concept, a.subconcept, a.id AS assignment_id
    INTO _q
  FROM public.recovery_assignment_questions q
  JOIN public.recovery_assignments a ON a.id = q.assignment_id
  WHERE q.id = _question_id AND a.user_id = _uid;

  IF _q IS NULL THEN RAISE EXCEPTION 'Question not found'; END IF;

  UPDATE public.recovery_assignment_questions SET
    answered = true, is_correct = _is_correct, student_answer = _student_answer
  WHERE id = _question_id;

  UPDATE public.recovery_assignments SET
    questions_completed = questions_completed + 1,
    questions_correct = questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  WHERE id = _q.assignment_id
  RETURNING * INTO _a;

  PERFORM public._upsert_concept_mastery(
    _uid, _a.student_id, NULL, _a.subject, _a.chapter, _a.concept, _a.subconcept, _is_correct, true
  );

  SELECT count(*) = _a.question_count INTO _done
  FROM public.recovery_assignment_questions WHERE assignment_id = _q.assignment_id AND answered;

  IF _done THEN
    UPDATE public.recovery_assignments SET status = 'completed', completed_at = now() WHERE id = _q.assignment_id;
    PERFORM public._rebuild_revision_queue(_uid, _a.student_id);
  END IF;

  RETURN jsonb_build_object(
    'completed', _done,
    'questions_completed', _a.questions_completed + 1,
    'questions_correct', _a.questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_answer(uuid, jsonb, boolean) TO authenticated;

-- ── Student concept mastery list ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_concept_mastery()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _items jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'total_attempts', total_attempts,
    'correct_attempts', correct_attempts, 'recovery_attempts', recovery_attempts,
    'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _items
  FROM public.concept_mastery WHERE user_id = _uid;
  RETURN jsonb_build_object('items', _items);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_concept_mastery() TO authenticated;

-- ── Patch DPP mistake capture with concepts ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _q record; _ans record; _prio int; _existing uuid;
  _concept text; _subconcept text;
BEGIN
  SELECT a.*, d.subject, d.chapter, d.topic INTO _att
  FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
  WHERE a.id = _attempt_id;
  IF _att IS NULL THEN RETURN; END IF;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    IF _ans IS NULL OR COALESCE(_ans.is_correct, false) THEN
      IF _ans IS NOT NULL THEN
        _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
        _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);
        PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
          COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
          _concept, _subconcept, true, false);
      END IF;
      CONTINUE;
    END IF;

    _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
    _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _att.user_id, _att.student_id, 'dpp', _att.dpp_id, _q.id,
      _q.class_level, COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _att.topic, _concept, _subconcept, 'dpp',
      _q.question, _q.options, _ans.response, _q.correct, _q.explanation, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
      COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _concept, _subconcept, false, false);

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(
      _att.user_id, COALESCE(_att.subject, 'General'), _att.chapter, _concept, NULL
    ) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _att.user_id AND NOT completed
      AND subject = COALESCE(_att.subject, 'General')
      AND COALESCE(chapter, '') = COALESCE(_att.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_concept, '')
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, _prio), reason = 'dpp_wrong', due_date = LEAST(due_date, CURRENT_DATE)
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _att.user_id, _att.student_id,
        COALESCE(_att.subject, 'General'), _att.chapter, _concept,
        'dpp_wrong', _prio, CURRENT_DATE
      );
    END IF;
  END LOOP;
END; $$;

-- ── Patch battle mistake capture with concepts ────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_battle_mistakes(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bp record; _ba record; _concept text; _subconcept text;
BEGIN
  SELECT bp.*, b.subject, b.chapter, b.topic, b.class_level
    INTO _bp
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.id = _participant_id;
  IF _bp IS NULL THEN RETURN; END IF;

  FOR _ba IN
    SELECT ba.*, bq.question, bq.options, bq.correct_index, bq.bank_question_id,
           bq.concept, bq.subconcept
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id
  LOOP
    _concept := COALESCE(_ba.concept, _bp.topic, _bp.chapter, _bp.subject);
    _subconcept := COALESCE(_ba.subconcept, _ba.concept, _bp.topic);

    IF _ba.is_correct THEN
      PERFORM public._upsert_concept_mastery(_bp.user_id, _bp.student_id, _bp.class_level,
        COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, true, false);
      CONTINUE;
    END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _bp.user_id, _bp.student_id, 'battleground', _bp.battle_id, _ba.question_id,
      _bp.class_level, COALESCE(_bp.subject, 'General'), _bp.chapter, _bp.topic,
      _concept, _subconcept, 'battle',
      _ba.question, _ba.options,
      jsonb_build_object('selected_index', _ba.selected_index),
      jsonb_build_object('correct_index', _ba.correct_index),
      NULL, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_bp.user_id, _bp.student_id, _bp.class_level,
      COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, false, false);
  END LOOP;
END; $$;

-- ── Patch practice attempt recording ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _correct_answer jsonb,
  _selected_answer jsonb DEFAULT NULL,
  _is_correct boolean DEFAULT NULL,
  _score numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _student uuid; _aid uuid; _tm record; _concept text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
  _concept := COALESCE(_tm.concept, _tm.chapter);

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct
  ) VALUES (
    _session_id, _student, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct
  ) RETURNING id INTO _aid;

  IF _is_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1, score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
  ELSE
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _aid,
      _tm.subject, _tm.chapter, _concept, _tm.subconcept, _tm.class,
      COALESCE(_generated_question->>'question', 'Practice question'),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _correct_answer,
      _tm.explanation_template
    );
  END IF;

  PERFORM public._upsert_concept_mastery(_uid, _student, _tm.class, _tm.subject, _tm.chapter,
    _concept, _tm.subconcept, COALESCE(_is_correct, false), false);

  RETURN _aid;
END; $$;

-- ── Teacher concept analytics ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_teacher_concept_analytics(_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _base jsonb;
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal')
     AND NOT public.teacher_teaches_class(_uid, _class_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _base := public.rpc_teacher_class_insights(_class_id);

  RETURN _base || jsonb_build_object(
    'class_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', cm.subject, 'chapter', cm.chapter, 'concept', cm.concept,
        'avg_mastery', round(avg(cm.mastery_score), 1),
        'students', count(DISTINCT cm.user_id)
      ) ORDER BY avg(cm.mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 55
      GROUP BY cm.subject, cm.chapter, cm.concept
      LIMIT 10
    ),
    'student_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name,
        'concept', cm.concept, 'subject', cm.subject,
        'mastery_score', cm.mastery_score
      ) ORDER BY cm.mastery_score ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 45
      LIMIT 20
    ),
    'recovery_completion_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE ra.status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments ra
      JOIN public.students s ON s.user_id = ra.user_id
      WHERE s.class_id = _class_id
    ),
    'mastery_distribution', (
      SELECT jsonb_build_object(
        'below_40', count(*) FILTER (WHERE cm.mastery_score < 40),
        '40_60', count(*) FILTER (WHERE cm.mastery_score >= 40 AND cm.mastery_score < 60),
        '60_80', count(*) FILTER (WHERE cm.mastery_score >= 60 AND cm.mastery_score < 80),
        'above_80', count(*) FILTER (WHERE cm.mastery_score >= 80)
      )
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_teacher_concept_analytics(uuid) TO authenticated;

-- ── Parent concept analytics (no question detail) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_parent_concept_analytics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _parent uuid := auth.uid(); _result jsonb := '[]'::jsonb; _child record;
BEGIN
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN SELECT s.* FROM public.students s WHERE s.parent_user_id = _parent
  LOOP
    IF _child.user_id IS NULL THEN CONTINUE; END IF;
    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name', _child.full_name,
      'weak_areas', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'subject', subject, 'concept', concept, 'mastery_score', mastery_score
        ) ORDER BY mastery_score ASC), '[]'::jsonb)
        FROM public.concept_mastery
        WHERE user_id = _child.user_id AND mastery_score < 55
        LIMIT 5
      ),
      'recovery_pending', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status IN ('pending', 'in_progress')
      ),
      'recovery_completed', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status = 'completed'
          AND completed_at >= now() - interval '30 days'
      ),
      'mastery_trend', (
        SELECT round(avg(mastery_score), 1) FROM public.concept_mastery WHERE user_id = _child.user_id
      )
    ));
  END LOOP;

  RETURN jsonb_build_object('children', _result);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_parent_concept_analytics() TO authenticated;

-- ── Principal concept analytics ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_principal_concept_analytics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;

  RETURN jsonb_build_object(
    'school_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject, 'concept', concept,
        'avg_mastery', round(avg(mastery_score), 1),
        'students_affected', count(DISTINCT user_id)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      WHERE mastery_score < 50
      GROUP BY subject, concept
      LIMIT 12
    ),
    'subject_performance', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject,
        'avg_mastery', round(avg(mastery_score), 1),
        'concepts_tracked', count(*)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      GROUP BY subject
    ),
    'recovery_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments
    ),
    'recovery_participation', (
      SELECT count(DISTINCT user_id)::int FROM public.recovery_assignments
      WHERE created_at >= now() - interval '30 days'
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_principal_concept_analytics() TO authenticated;

-- ── Extend academic snapshot with recovery + mastery ──────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _dpp_open int := 0; _dpp_done int := 0;
  _weak jsonb; _strong jsonb; _rev jsonb; _mistakes int; _heat jsonb;
  _recovery_pending int := 0; _mastery_summary jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;

  IF _s.id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE hs.status IN ('submitted','graded')),
           count(*) FILTER (WHERE hs.status IS NULL OR hs.status = 'pending')
      INTO _hw_done, _hw_pending
    FROM public.homework h
    LEFT JOIN public.homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = _s.id
    WHERE h.class_id = _s.class_id;

    SELECT count(*) FILTER (WHERE att.status = 'submitted'),
           count(*) FILTER (WHERE att.status IS DISTINCT FROM 'submitted')
      INTO _dpp_done, _dpp_open
    FROM public.dpps d
    LEFT JOIN public.dpp_attempts att ON att.dpp_id = d.id AND att.user_id = _uid
    WHERE d.is_published AND d.class_id = _s.class_id;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy < 65 LIMIT 5;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy DESC), '[]'::jsonb)
    INTO _strong FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy >= 75 LIMIT 5;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'dpp', dpp_count, 'homework', homework_count,
    'battles', battle_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND NOT mastered;

  SELECT count(*)::int INTO _recovery_pending FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'topic', topic, 'chapter', chapter,
    'priority', priority, 'due_date', due_date, 'reason', reason
  ) ORDER BY priority DESC, due_date ASC), '[]'::jsonb)
    INTO _rev FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed LIMIT 10;

  RETURN jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'dpp', jsonb_build_object('open', _dpp_open, 'completed', _dpp_done),
    'weak_topics', _weak,
    'strong_topics', _strong,
    'revision_queue', _rev,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $$;


-- ========== class12_math_templates.sql ==========

-- Class 12 Mathematics template seed (idempotent)
DELETE FROM public.question_templates WHERE class = 12 AND subject = 'Mathematics';
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":0,"seed":1,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":1,"seed":2,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":2,"seed":3,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":3,"seed":4,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":4,"seed":5,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":5,"seed":6,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":6,"seed":7,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":7,"seed":8,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":8,"seed":9,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":9,"seed":10,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":10,"seed":11,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":11,"seed":12,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":12,"seed":13,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":13,"seed":14,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":14,"seed":15,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":15,"seed":16,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":16,"seed":17,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":17,"seed":18,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":18,"seed":19,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":19,"seed":20,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":20,"seed":21,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":21,"seed":22,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":22,"seed":23,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":23,"seed":24,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":24,"seed":25,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":25,"seed":26,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":26,"seed":27,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":27,"seed":28,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":28,"seed":29,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":29,"seed":30,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":30,"seed":31,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":31,"seed":32,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":32,"seed":33,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":33,"seed":34,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":34,"seed":35,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":0,"seed":36,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":1,"seed":37,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":2,"seed":38,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":3,"seed":39,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":4,"seed":40,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":5,"seed":41,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":6,"seed":42,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":7,"seed":43,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":8,"seed":44,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":9,"seed":45,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":10,"seed":46,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":11,"seed":47,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":12,"seed":48,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":13,"seed":49,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":14,"seed":50,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":15,"seed":51,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":16,"seed":52,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":17,"seed":53,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":18,"seed":54,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":19,"seed":55,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":20,"seed":56,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":21,"seed":57,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":22,"seed":58,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":23,"seed":59,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":24,"seed":60,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":25,"seed":61,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":26,"seed":62,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":27,"seed":63,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":28,"seed":64,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":29,"seed":65,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":30,"seed":66,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":31,"seed":67,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":32,"seed":68,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":33,"seed":69,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":34,"seed":70,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":0,"seed":71,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":1,"seed":72,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":2,"seed":73,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":3,"seed":74,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":4,"seed":75,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":5,"seed":76,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":6,"seed":77,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":7,"seed":78,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":8,"seed":79,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":9,"seed":80,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":10,"seed":81,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":11,"seed":82,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":12,"seed":83,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":13,"seed":84,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":14,"seed":85,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":15,"seed":86,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":16,"seed":87,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":17,"seed":88,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":18,"seed":89,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":19,"seed":90,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":20,"seed":91,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":21,"seed":92,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":22,"seed":93,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":23,"seed":94,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":24,"seed":95,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":25,"seed":96,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":26,"seed":97,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":27,"seed":98,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":28,"seed":99,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":29,"seed":100,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":30,"seed":101,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":31,"seed":102,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":32,"seed":103,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":33,"seed":104,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":34,"seed":105,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":0,"seed":106,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":1,"seed":107,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":2,"seed":108,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":3,"seed":109,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":4,"seed":110,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":5,"seed":111,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":6,"seed":112,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":7,"seed":113,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":8,"seed":114,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":9,"seed":115,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":10,"seed":116,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":11,"seed":117,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":12,"seed":118,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":13,"seed":119,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":14,"seed":120,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":15,"seed":121,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":16,"seed":122,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":17,"seed":123,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":18,"seed":124,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":19,"seed":125,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":20,"seed":126,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":21,"seed":127,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":22,"seed":128,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":23,"seed":129,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":24,"seed":130,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":25,"seed":131,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":26,"seed":132,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":27,"seed":133,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":28,"seed":134,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":29,"seed":135,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":30,"seed":136,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":31,"seed":137,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":32,"seed":138,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":33,"seed":139,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":34,"seed":140,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":35,"seed":141,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":36,"seed":142,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":37,"seed":143,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":38,"seed":144,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":39,"seed":145,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":40,"seed":146,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":41,"seed":147,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":42,"seed":148,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":43,"seed":149,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":44,"seed":150,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":45,"seed":151,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":46,"seed":152,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":47,"seed":153,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":48,"seed":154,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":49,"seed":155,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":50,"seed":156,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":51,"seed":157,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":52,"seed":158,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":0,"seed":159,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":1,"seed":160,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":2,"seed":161,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":3,"seed":162,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":4,"seed":163,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":5,"seed":164,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":6,"seed":165,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":7,"seed":166,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":8,"seed":167,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":9,"seed":168,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":10,"seed":169,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":11,"seed":170,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":12,"seed":171,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":13,"seed":172,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":14,"seed":173,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":15,"seed":174,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":16,"seed":175,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":17,"seed":176,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":18,"seed":177,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":19,"seed":178,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":20,"seed":179,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":21,"seed":180,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":22,"seed":181,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":23,"seed":182,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":24,"seed":183,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":25,"seed":184,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":26,"seed":185,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":27,"seed":186,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":28,"seed":187,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":29,"seed":188,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":30,"seed":189,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":31,"seed":190,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":32,"seed":191,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":33,"seed":192,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":34,"seed":193,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":35,"seed":194,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":36,"seed":195,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":37,"seed":196,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":38,"seed":197,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":39,"seed":198,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":40,"seed":199,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":41,"seed":200,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":42,"seed":201,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":43,"seed":202,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":44,"seed":203,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":45,"seed":204,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":46,"seed":205,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":47,"seed":206,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":48,"seed":207,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":49,"seed":208,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":50,"seed":209,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":51,"seed":210,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":52,"seed":211,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":0,"seed":212,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":1,"seed":213,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":2,"seed":214,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":3,"seed":215,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":4,"seed":216,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":5,"seed":217,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":6,"seed":218,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":7,"seed":219,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":8,"seed":220,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":9,"seed":221,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":10,"seed":222,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":11,"seed":223,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":12,"seed":224,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":13,"seed":225,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":14,"seed":226,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":15,"seed":227,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":16,"seed":228,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":17,"seed":229,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":18,"seed":230,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":19,"seed":231,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":20,"seed":232,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":21,"seed":233,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":22,"seed":234,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":23,"seed":235,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":24,"seed":236,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":25,"seed":237,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":26,"seed":238,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":27,"seed":239,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":28,"seed":240,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":29,"seed":241,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":30,"seed":242,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":31,"seed":243,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":32,"seed":244,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":33,"seed":245,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":34,"seed":246,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":0,"seed":247,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":1,"seed":248,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":2,"seed":249,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":3,"seed":250,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":4,"seed":251,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":5,"seed":252,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":6,"seed":253,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":7,"seed":254,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":8,"seed":255,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":9,"seed":256,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":10,"seed":257,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":11,"seed":258,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":12,"seed":259,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":13,"seed":260,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":14,"seed":261,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":15,"seed":262,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":16,"seed":263,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":17,"seed":264,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":18,"seed":265,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":19,"seed":266,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":20,"seed":267,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":21,"seed":268,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":22,"seed":269,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":23,"seed":270,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":24,"seed":271,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":25,"seed":272,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":26,"seed":273,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":27,"seed":274,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":28,"seed":275,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":29,"seed":276,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":30,"seed":277,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":31,"seed":278,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":32,"seed":279,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":33,"seed":280,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":34,"seed":281,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":0,"seed":282,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":1,"seed":283,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":2,"seed":284,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":3,"seed":285,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":4,"seed":286,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":5,"seed":287,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":6,"seed":288,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":7,"seed":289,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":8,"seed":290,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":9,"seed":291,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":10,"seed":292,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":11,"seed":293,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":12,"seed":294,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":13,"seed":295,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":14,"seed":296,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":15,"seed":297,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":16,"seed":298,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":17,"seed":299,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":18,"seed":300,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":19,"seed":301,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":20,"seed":302,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":21,"seed":303,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":22,"seed":304,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":23,"seed":305,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":24,"seed":306,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":25,"seed":307,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":26,"seed":308,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":27,"seed":309,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":28,"seed":310,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":29,"seed":311,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":30,"seed":312,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":31,"seed":313,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":32,"seed":314,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":33,"seed":315,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":34,"seed":316,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":0,"seed":317,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":1,"seed":318,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":2,"seed":319,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":3,"seed":320,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":4,"seed":321,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":5,"seed":322,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":6,"seed":323,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":7,"seed":324,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":8,"seed":325,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":9,"seed":326,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":10,"seed":327,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":11,"seed":328,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":12,"seed":329,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":13,"seed":330,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":14,"seed":331,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":15,"seed":332,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":16,"seed":333,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":17,"seed":334,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":18,"seed":335,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":19,"seed":336,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":20,"seed":337,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":21,"seed":338,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":22,"seed":339,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":23,"seed":340,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":24,"seed":341,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":25,"seed":342,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":26,"seed":343,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":27,"seed":344,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":28,"seed":345,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":29,"seed":346,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":30,"seed":347,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":31,"seed":348,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":32,"seed":349,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":33,"seed":350,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":34,"seed":351,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":35,"seed":352,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":36,"seed":353,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":37,"seed":354,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":38,"seed":355,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":39,"seed":356,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":40,"seed":357,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":41,"seed":358,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":42,"seed":359,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":43,"seed":360,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":44,"seed":361,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":45,"seed":362,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":46,"seed":363,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":47,"seed":364,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":48,"seed":365,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":49,"seed":366,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":50,"seed":367,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":51,"seed":368,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":52,"seed":369,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":0,"seed":370,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":1,"seed":371,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":2,"seed":372,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":3,"seed":373,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":4,"seed":374,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":5,"seed":375,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":6,"seed":376,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":7,"seed":377,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":8,"seed":378,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":9,"seed":379,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":10,"seed":380,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":11,"seed":381,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":12,"seed":382,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":13,"seed":383,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":14,"seed":384,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":15,"seed":385,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":16,"seed":386,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":17,"seed":387,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":18,"seed":388,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":19,"seed":389,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":20,"seed":390,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":21,"seed":391,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":22,"seed":392,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":23,"seed":393,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":24,"seed":394,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":25,"seed":395,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":26,"seed":396,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":27,"seed":397,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":28,"seed":398,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":29,"seed":399,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":30,"seed":400,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":31,"seed":401,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":32,"seed":402,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":33,"seed":403,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":34,"seed":404,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":35,"seed":405,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":36,"seed":406,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":37,"seed":407,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":38,"seed":408,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":39,"seed":409,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":40,"seed":410,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":41,"seed":411,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":42,"seed":412,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":43,"seed":413,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":44,"seed":414,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":45,"seed":415,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":46,"seed":416,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":47,"seed":417,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":48,"seed":418,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":49,"seed":419,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":50,"seed":420,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":51,"seed":421,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":52,"seed":422,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":0,"seed":423,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":1,"seed":424,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":2,"seed":425,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":3,"seed":426,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":4,"seed":427,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":5,"seed":428,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":6,"seed":429,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":7,"seed":430,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":8,"seed":431,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":9,"seed":432,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":10,"seed":433,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":11,"seed":434,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":12,"seed":435,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":13,"seed":436,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":14,"seed":437,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":15,"seed":438,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":16,"seed":439,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":17,"seed":440,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":18,"seed":441,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":19,"seed":442,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":20,"seed":443,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":21,"seed":444,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":22,"seed":445,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":23,"seed":446,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":24,"seed":447,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":25,"seed":448,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":26,"seed":449,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":27,"seed":450,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":28,"seed":451,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":29,"seed":452,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":30,"seed":453,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":31,"seed":454,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":32,"seed":455,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":33,"seed":456,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":34,"seed":457,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":35,"seed":458,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":36,"seed":459,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":37,"seed":460,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":38,"seed":461,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":39,"seed":462,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":40,"seed":463,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":41,"seed":464,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":42,"seed":465,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":43,"seed":466,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":44,"seed":467,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":45,"seed":468,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":46,"seed":469,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":47,"seed":470,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":48,"seed":471,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":49,"seed":472,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":50,"seed":473,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":51,"seed":474,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":52,"seed":475,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":0,"seed":476,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":1,"seed":477,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":2,"seed":478,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":3,"seed":479,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":4,"seed":480,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":5,"seed":481,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":6,"seed":482,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":7,"seed":483,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":8,"seed":484,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":9,"seed":485,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":10,"seed":486,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":11,"seed":487,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":12,"seed":488,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":13,"seed":489,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":14,"seed":490,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":15,"seed":491,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":16,"seed":492,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":17,"seed":493,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":18,"seed":494,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":19,"seed":495,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":20,"seed":496,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":21,"seed":497,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":22,"seed":498,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":23,"seed":499,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":24,"seed":500,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":25,"seed":501,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":26,"seed":502,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":27,"seed":503,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":28,"seed":504,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":29,"seed":505,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":30,"seed":506,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":31,"seed":507,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":32,"seed":508,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":33,"seed":509,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":34,"seed":510,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":35,"seed":511,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":36,"seed":512,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":37,"seed":513,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":38,"seed":514,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":39,"seed":515,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":40,"seed":516,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":41,"seed":517,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":42,"seed":518,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":43,"seed":519,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":44,"seed":520,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":45,"seed":521,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":46,"seed":522,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":47,"seed":523,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":48,"seed":524,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":49,"seed":525,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":50,"seed":526,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":51,"seed":527,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":52,"seed":528,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":0,"seed":529,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":1,"seed":530,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":2,"seed":531,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":3,"seed":532,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":4,"seed":533,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":5,"seed":534,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":6,"seed":535,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":7,"seed":536,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":8,"seed":537,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":9,"seed":538,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":10,"seed":539,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":11,"seed":540,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":12,"seed":541,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":13,"seed":542,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":14,"seed":543,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":15,"seed":544,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":16,"seed":545,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":17,"seed":546,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":18,"seed":547,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":19,"seed":548,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":20,"seed":549,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":21,"seed":550,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":22,"seed":551,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":23,"seed":552,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":24,"seed":553,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":25,"seed":554,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":26,"seed":555,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":27,"seed":556,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":28,"seed":557,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":29,"seed":558,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":30,"seed":559,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":31,"seed":560,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":32,"seed":561,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":33,"seed":562,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":34,"seed":563,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":35,"seed":564,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":36,"seed":565,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":37,"seed":566,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":38,"seed":567,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":39,"seed":568,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":40,"seed":569,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":41,"seed":570,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":42,"seed":571,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":43,"seed":572,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":44,"seed":573,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":45,"seed":574,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":46,"seed":575,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":47,"seed":576,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":48,"seed":577,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":49,"seed":578,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":50,"seed":579,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":51,"seed":580,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":52,"seed":581,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":0,"seed":582,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":1,"seed":583,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":2,"seed":584,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":3,"seed":585,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":4,"seed":586,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":5,"seed":587,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":6,"seed":588,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":7,"seed":589,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":8,"seed":590,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":9,"seed":591,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":10,"seed":592,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":11,"seed":593,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":12,"seed":594,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":13,"seed":595,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":14,"seed":596,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":15,"seed":597,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":16,"seed":598,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":17,"seed":599,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":18,"seed":600,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":19,"seed":601,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":20,"seed":602,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":21,"seed":603,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":22,"seed":604,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":23,"seed":605,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":24,"seed":606,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":25,"seed":607,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":26,"seed":608,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":27,"seed":609,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":28,"seed":610,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":29,"seed":611,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":30,"seed":612,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":31,"seed":613,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":32,"seed":614,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":33,"seed":615,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":34,"seed":616,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":35,"seed":617,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":36,"seed":618,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":37,"seed":619,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":38,"seed":620,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":39,"seed":621,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":40,"seed":622,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":41,"seed":623,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":42,"seed":624,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":43,"seed":625,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":44,"seed":626,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":45,"seed":627,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":46,"seed":628,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":47,"seed":629,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":48,"seed":630,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":49,"seed":631,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":50,"seed":632,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":51,"seed":633,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":52,"seed":634,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":0,"seed":635,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":1,"seed":636,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":2,"seed":637,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":3,"seed":638,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":4,"seed":639,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":5,"seed":640,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":6,"seed":641,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":7,"seed":642,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":8,"seed":643,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":9,"seed":644,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":10,"seed":645,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":11,"seed":646,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":12,"seed":647,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":13,"seed":648,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":14,"seed":649,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":15,"seed":650,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":16,"seed":651,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":17,"seed":652,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":18,"seed":653,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":19,"seed":654,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":20,"seed":655,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":21,"seed":656,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":22,"seed":657,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":23,"seed":658,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":24,"seed":659,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":25,"seed":660,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":26,"seed":661,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":27,"seed":662,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":28,"seed":663,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":29,"seed":664,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":30,"seed":665,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":31,"seed":666,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":32,"seed":667,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":33,"seed":668,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":34,"seed":669,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":35,"seed":670,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":36,"seed":671,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":37,"seed":672,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":38,"seed":673,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":39,"seed":674,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":40,"seed":675,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":41,"seed":676,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":42,"seed":677,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":43,"seed":678,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":44,"seed":679,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":45,"seed":680,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":46,"seed":681,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":47,"seed":682,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":48,"seed":683,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":49,"seed":684,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":50,"seed":685,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":51,"seed":686,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":52,"seed":687,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":0,"seed":688,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":1,"seed":689,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":2,"seed":690,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":3,"seed":691,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":4,"seed":692,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":5,"seed":693,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":6,"seed":694,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":7,"seed":695,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":8,"seed":696,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":9,"seed":697,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":10,"seed":698,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":11,"seed":699,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":12,"seed":700,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":13,"seed":701,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":14,"seed":702,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":15,"seed":703,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":16,"seed":704,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":17,"seed":705,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":18,"seed":706,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":19,"seed":707,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":20,"seed":708,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":21,"seed":709,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":22,"seed":710,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":23,"seed":711,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":24,"seed":712,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":25,"seed":713,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":26,"seed":714,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":27,"seed":715,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":28,"seed":716,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":29,"seed":717,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":30,"seed":718,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":31,"seed":719,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":32,"seed":720,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":33,"seed":721,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":34,"seed":722,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":35,"seed":723,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":36,"seed":724,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":37,"seed":725,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":38,"seed":726,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":39,"seed":727,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":40,"seed":728,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":41,"seed":729,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":42,"seed":730,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":43,"seed":731,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":44,"seed":732,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":45,"seed":733,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":46,"seed":734,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":47,"seed":735,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":48,"seed":736,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":49,"seed":737,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":50,"seed":738,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":51,"seed":739,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":52,"seed":740,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":0,"seed":741,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":1,"seed":742,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":2,"seed":743,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":3,"seed":744,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":4,"seed":745,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":5,"seed":746,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":6,"seed":747,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":7,"seed":748,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":8,"seed":749,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":9,"seed":750,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":10,"seed":751,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":11,"seed":752,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":12,"seed":753,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":13,"seed":754,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":14,"seed":755,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":15,"seed":756,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":16,"seed":757,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":17,"seed":758,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":18,"seed":759,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":19,"seed":760,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":20,"seed":761,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":21,"seed":762,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":22,"seed":763,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":23,"seed":764,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":24,"seed":765,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":25,"seed":766,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":26,"seed":767,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":27,"seed":768,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":28,"seed":769,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":29,"seed":770,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":30,"seed":771,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":31,"seed":772,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":32,"seed":773,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":33,"seed":774,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":34,"seed":775,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":0,"seed":776,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":1,"seed":777,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":2,"seed":778,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":3,"seed":779,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":4,"seed":780,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":5,"seed":781,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":6,"seed":782,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":7,"seed":783,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":8,"seed":784,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":9,"seed":785,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":10,"seed":786,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":11,"seed":787,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":12,"seed":788,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":13,"seed":789,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":14,"seed":790,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":15,"seed":791,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":16,"seed":792,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":17,"seed":793,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":18,"seed":794,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":19,"seed":795,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":20,"seed":796,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":21,"seed":797,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":22,"seed":798,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":23,"seed":799,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":24,"seed":800,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":25,"seed":801,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":26,"seed":802,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":27,"seed":803,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":28,"seed":804,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":29,"seed":805,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":30,"seed":806,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":31,"seed":807,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":32,"seed":808,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":33,"seed":809,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":34,"seed":810,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":0,"seed":811,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":1,"seed":812,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":2,"seed":813,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":3,"seed":814,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":4,"seed":815,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":5,"seed":816,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":6,"seed":817,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":7,"seed":818,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":8,"seed":819,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":9,"seed":820,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":10,"seed":821,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":11,"seed":822,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":12,"seed":823,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":13,"seed":824,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":14,"seed":825,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":15,"seed":826,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":16,"seed":827,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":17,"seed":828,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":18,"seed":829,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":19,"seed":830,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":20,"seed":831,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":21,"seed":832,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":22,"seed":833,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":23,"seed":834,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":24,"seed":835,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":25,"seed":836,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":26,"seed":837,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":27,"seed":838,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":28,"seed":839,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":29,"seed":840,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":30,"seed":841,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":31,"seed":842,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":32,"seed":843,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":33,"seed":844,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":34,"seed":845,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":0,"seed":846,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":1,"seed":847,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":2,"seed":848,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":3,"seed":849,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":4,"seed":850,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":5,"seed":851,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":6,"seed":852,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":7,"seed":853,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":8,"seed":854,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":9,"seed":855,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":10,"seed":856,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":11,"seed":857,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":12,"seed":858,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":13,"seed":859,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":14,"seed":860,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":15,"seed":861,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":16,"seed":862,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":17,"seed":863,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":18,"seed":864,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":19,"seed":865,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":20,"seed":866,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":21,"seed":867,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":22,"seed":868,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":23,"seed":869,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":24,"seed":870,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":25,"seed":871,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":26,"seed":872,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":27,"seed":873,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":28,"seed":874,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":29,"seed":875,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":30,"seed":876,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":31,"seed":877,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":32,"seed":878,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":33,"seed":879,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":34,"seed":880,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":35,"seed":881,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":36,"seed":882,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":37,"seed":883,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":38,"seed":884,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":39,"seed":885,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":40,"seed":886,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":41,"seed":887,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":42,"seed":888,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":43,"seed":889,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":44,"seed":890,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":45,"seed":891,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":46,"seed":892,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":47,"seed":893,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":48,"seed":894,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":49,"seed":895,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":50,"seed":896,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":51,"seed":897,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":52,"seed":898,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":0,"seed":899,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":1,"seed":900,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":2,"seed":901,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":3,"seed":902,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":4,"seed":903,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":5,"seed":904,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":6,"seed":905,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":7,"seed":906,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":8,"seed":907,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":9,"seed":908,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":10,"seed":909,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":11,"seed":910,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":12,"seed":911,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":13,"seed":912,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":14,"seed":913,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":15,"seed":914,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":16,"seed":915,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":17,"seed":916,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":18,"seed":917,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":19,"seed":918,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":20,"seed":919,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":21,"seed":920,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":22,"seed":921,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":23,"seed":922,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":24,"seed":923,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":25,"seed":924,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":26,"seed":925,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":27,"seed":926,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":28,"seed":927,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":29,"seed":928,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":30,"seed":929,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":31,"seed":930,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":32,"seed":931,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":33,"seed":932,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":34,"seed":933,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":35,"seed":934,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":36,"seed":935,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":37,"seed":936,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":38,"seed":937,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":39,"seed":938,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":40,"seed":939,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":41,"seed":940,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":42,"seed":941,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":43,"seed":942,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":44,"seed":943,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":45,"seed":944,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":46,"seed":945,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":47,"seed":946,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":48,"seed":947,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":49,"seed":948,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":50,"seed":949,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":51,"seed":950,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":52,"seed":951,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":0,"seed":952,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":1,"seed":953,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":2,"seed":954,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":3,"seed":955,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":4,"seed":956,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":5,"seed":957,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":6,"seed":958,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":7,"seed":959,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":8,"seed":960,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":9,"seed":961,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":10,"seed":962,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":11,"seed":963,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":12,"seed":964,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":13,"seed":965,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":14,"seed":966,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":15,"seed":967,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":16,"seed":968,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":17,"seed":969,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":18,"seed":970,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":19,"seed":971,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":20,"seed":972,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":21,"seed":973,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":22,"seed":974,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":23,"seed":975,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":24,"seed":976,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":25,"seed":977,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":26,"seed":978,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":27,"seed":979,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":28,"seed":980,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":29,"seed":981,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":30,"seed":982,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":31,"seed":983,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":32,"seed":984,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":33,"seed":985,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":34,"seed":986,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":35,"seed":987,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":36,"seed":988,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":37,"seed":989,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":38,"seed":990,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":39,"seed":991,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":40,"seed":992,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":41,"seed":993,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":42,"seed":994,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":43,"seed":995,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":44,"seed":996,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":45,"seed":997,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":46,"seed":998,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":47,"seed":999,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":48,"seed":1000,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":49,"seed":1001,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":50,"seed":1002,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":51,"seed":1003,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":52,"seed":1004,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":0,"seed":1005,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":1,"seed":1006,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":2,"seed":1007,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":3,"seed":1008,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":4,"seed":1009,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":5,"seed":1010,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":6,"seed":1011,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":7,"seed":1012,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":8,"seed":1013,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":9,"seed":1014,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":10,"seed":1015,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":11,"seed":1016,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":12,"seed":1017,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":13,"seed":1018,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":14,"seed":1019,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":15,"seed":1020,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":16,"seed":1021,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":17,"seed":1022,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":18,"seed":1023,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":19,"seed":1024,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":20,"seed":1025,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":21,"seed":1026,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":22,"seed":1027,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":23,"seed":1028,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":24,"seed":1029,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":25,"seed":1030,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":26,"seed":1031,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":27,"seed":1032,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":28,"seed":1033,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":29,"seed":1034,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":30,"seed":1035,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":31,"seed":1036,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":32,"seed":1037,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":33,"seed":1038,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":34,"seed":1039,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":35,"seed":1040,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":36,"seed":1041,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":37,"seed":1042,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":38,"seed":1043,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":39,"seed":1044,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":40,"seed":1045,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":41,"seed":1046,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":42,"seed":1047,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":43,"seed":1048,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":44,"seed":1049,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":45,"seed":1050,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":46,"seed":1051,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":47,"seed":1052,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":48,"seed":1053,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":49,"seed":1054,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":50,"seed":1055,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":51,"seed":1056,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":52,"seed":1057,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":0,"seed":1058,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":1,"seed":1059,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":2,"seed":1060,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":3,"seed":1061,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":4,"seed":1062,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":5,"seed":1063,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":6,"seed":1064,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":7,"seed":1065,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":8,"seed":1066,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":9,"seed":1067,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":10,"seed":1068,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":11,"seed":1069,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":12,"seed":1070,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":13,"seed":1071,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":14,"seed":1072,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":15,"seed":1073,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":16,"seed":1074,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":17,"seed":1075,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":18,"seed":1076,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":19,"seed":1077,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":20,"seed":1078,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":21,"seed":1079,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":22,"seed":1080,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":23,"seed":1081,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":24,"seed":1082,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":25,"seed":1083,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":26,"seed":1084,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":27,"seed":1085,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":28,"seed":1086,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":29,"seed":1087,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":30,"seed":1088,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":31,"seed":1089,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":32,"seed":1090,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":33,"seed":1091,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":34,"seed":1092,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":35,"seed":1093,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":36,"seed":1094,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":37,"seed":1095,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":38,"seed":1096,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":39,"seed":1097,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":40,"seed":1098,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":41,"seed":1099,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":42,"seed":1100,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":43,"seed":1101,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":44,"seed":1102,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":45,"seed":1103,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":46,"seed":1104,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":47,"seed":1105,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":48,"seed":1106,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":49,"seed":1107,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":50,"seed":1108,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":51,"seed":1109,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":52,"seed":1110,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":53,"seed":1111,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":54,"seed":1112,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":55,"seed":1113,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":56,"seed":1114,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":57,"seed":1115,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":58,"seed":1116,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":59,"seed":1117,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":60,"seed":1118,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":61,"seed":1119,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":62,"seed":1120,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":63,"seed":1121,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":64,"seed":1122,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":65,"seed":1123,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":66,"seed":1124,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":67,"seed":1125,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":68,"seed":1126,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":69,"seed":1127,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":70,"seed":1128,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":71,"seed":1129,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":72,"seed":1130,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":73,"seed":1131,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":74,"seed":1132,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":75,"seed":1133,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":76,"seed":1134,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":77,"seed":1135,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":78,"seed":1136,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":79,"seed":1137,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":80,"seed":1138,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":81,"seed":1139,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":82,"seed":1140,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":83,"seed":1141,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":84,"seed":1142,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":85,"seed":1143,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":86,"seed":1144,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":87,"seed":1145,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":88,"seed":1146,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":89,"seed":1147,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":90,"seed":1148,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":91,"seed":1149,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":92,"seed":1150,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":93,"seed":1151,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":94,"seed":1152,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":95,"seed":1153,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":96,"seed":1154,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":97,"seed":1155,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":98,"seed":1156,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":99,"seed":1157,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":100,"seed":1158,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":101,"seed":1159,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":102,"seed":1160,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":103,"seed":1161,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":104,"seed":1162,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":0,"seed":1163,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":1,"seed":1164,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":2,"seed":1165,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":3,"seed":1166,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":4,"seed":1167,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":5,"seed":1168,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":6,"seed":1169,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":7,"seed":1170,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":8,"seed":1171,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":9,"seed":1172,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":10,"seed":1173,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":11,"seed":1174,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":12,"seed":1175,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":13,"seed":1176,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":14,"seed":1177,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":15,"seed":1178,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":16,"seed":1179,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":17,"seed":1180,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":18,"seed":1181,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":19,"seed":1182,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":20,"seed":1183,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":21,"seed":1184,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":22,"seed":1185,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":23,"seed":1186,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":24,"seed":1187,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":25,"seed":1188,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":26,"seed":1189,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":27,"seed":1190,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":28,"seed":1191,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":29,"seed":1192,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":30,"seed":1193,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":31,"seed":1194,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":32,"seed":1195,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":33,"seed":1196,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":34,"seed":1197,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":0,"seed":1198,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":1,"seed":1199,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":2,"seed":1200,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":3,"seed":1201,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":4,"seed":1202,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":5,"seed":1203,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":6,"seed":1204,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":7,"seed":1205,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":8,"seed":1206,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":9,"seed":1207,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":10,"seed":1208,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":11,"seed":1209,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":12,"seed":1210,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":13,"seed":1211,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":14,"seed":1212,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":15,"seed":1213,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":16,"seed":1214,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":17,"seed":1215,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":18,"seed":1216,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":19,"seed":1217,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":20,"seed":1218,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":21,"seed":1219,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":22,"seed":1220,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":23,"seed":1221,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":24,"seed":1222,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":25,"seed":1223,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":26,"seed":1224,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":27,"seed":1225,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":28,"seed":1226,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":29,"seed":1227,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":30,"seed":1228,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":31,"seed":1229,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":32,"seed":1230,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":33,"seed":1231,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":34,"seed":1232,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":0,"seed":1233,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":1,"seed":1234,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":2,"seed":1235,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":3,"seed":1236,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":4,"seed":1237,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":5,"seed":1238,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":6,"seed":1239,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":7,"seed":1240,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":8,"seed":1241,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":9,"seed":1242,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":10,"seed":1243,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":11,"seed":1244,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":12,"seed":1245,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":13,"seed":1246,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":14,"seed":1247,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":15,"seed":1248,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":16,"seed":1249,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":17,"seed":1250,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":18,"seed":1251,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":19,"seed":1252,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":20,"seed":1253,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":21,"seed":1254,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":22,"seed":1255,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":23,"seed":1256,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":24,"seed":1257,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":25,"seed":1258,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":26,"seed":1259,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":27,"seed":1260,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":28,"seed":1261,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":29,"seed":1262,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":30,"seed":1263,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":31,"seed":1264,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":32,"seed":1265,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":33,"seed":1266,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":34,"seed":1267,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":0,"seed":1268,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":1,"seed":1269,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":2,"seed":1270,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":3,"seed":1271,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":4,"seed":1272,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":5,"seed":1273,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":6,"seed":1274,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":7,"seed":1275,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":8,"seed":1276,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":9,"seed":1277,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":10,"seed":1278,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":11,"seed":1279,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":12,"seed":1280,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":13,"seed":1281,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":14,"seed":1282,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":15,"seed":1283,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":16,"seed":1284,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":17,"seed":1285,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":18,"seed":1286,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":19,"seed":1287,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":20,"seed":1288,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":21,"seed":1289,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":22,"seed":1290,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":23,"seed":1291,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":24,"seed":1292,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":25,"seed":1293,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":26,"seed":1294,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":27,"seed":1295,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":28,"seed":1296,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":29,"seed":1297,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":30,"seed":1298,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":31,"seed":1299,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":32,"seed":1300,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":33,"seed":1301,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":34,"seed":1302,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":35,"seed":1303,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":36,"seed":1304,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":37,"seed":1305,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":38,"seed":1306,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":39,"seed":1307,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":40,"seed":1308,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":41,"seed":1309,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":42,"seed":1310,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":43,"seed":1311,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":44,"seed":1312,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":45,"seed":1313,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":46,"seed":1314,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":47,"seed":1315,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":48,"seed":1316,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":49,"seed":1317,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":50,"seed":1318,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":51,"seed":1319,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":52,"seed":1320,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":0,"seed":1321,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":1,"seed":1322,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":2,"seed":1323,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":3,"seed":1324,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":4,"seed":1325,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":5,"seed":1326,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":6,"seed":1327,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":7,"seed":1328,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":8,"seed":1329,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":9,"seed":1330,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":10,"seed":1331,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":11,"seed":1332,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":12,"seed":1333,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":13,"seed":1334,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":14,"seed":1335,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":15,"seed":1336,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":16,"seed":1337,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":17,"seed":1338,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":18,"seed":1339,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":19,"seed":1340,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":20,"seed":1341,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":21,"seed":1342,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":22,"seed":1343,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":23,"seed":1344,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":24,"seed":1345,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":25,"seed":1346,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":26,"seed":1347,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":27,"seed":1348,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":28,"seed":1349,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":29,"seed":1350,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":30,"seed":1351,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":31,"seed":1352,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":32,"seed":1353,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":33,"seed":1354,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":34,"seed":1355,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":35,"seed":1356,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":36,"seed":1357,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":37,"seed":1358,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":38,"seed":1359,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":39,"seed":1360,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":40,"seed":1361,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":41,"seed":1362,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":42,"seed":1363,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":43,"seed":1364,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":44,"seed":1365,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":45,"seed":1366,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":46,"seed":1367,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":47,"seed":1368,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":48,"seed":1369,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":49,"seed":1370,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":50,"seed":1371,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":51,"seed":1372,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":52,"seed":1373,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
