-- Demo enrichment: Community Doubt Portal + more Class 10-A students.
-- Safe to re-run. Password for all new demo users: DemoPass123!

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  c10a uuid := 'd2000001-0001-4000-8000-000000000001';
  u_t_math uuid := 'd1000002-0001-4000-8000-000000000001';
  u_t_phys uuid := 'd1000002-0002-4000-8000-000000000002';
  u_s1 uuid := 'd1000003-0001-4000-8000-000000000001';
  u_s2 uuid := 'd1000003-0002-4000-8000-000000000002';
  u_s3 uuid := 'd1000003-0003-4000-8000-000000000003';
  u_s4 uuid := 'd1000003-0004-4000-8000-000000000004';
  u_s5 uuid := 'd1000003-0005-4000-8000-000000000005';
  u_s6 uuid := 'd1000003-0006-4000-8000-000000000006';
  u_s7 uuid := 'd1000003-0007-4000-8000-000000000007';
  u_s8 uuid := 'd1000003-0008-4000-8000-000000000008';
  u_s9 uuid := 'd1000003-0009-4000-8000-000000000009';
  u_s10 uuid := 'd1000003-0010-4000-8000-000000000010';
  st1 uuid := 'd3000001-0001-4000-8000-000000000001';
  st2 uuid := 'd3000001-0002-4000-8000-000000000002';
  st3 uuid := 'd3000001-0003-4000-8000-000000000003';
  st4 uuid := 'd3000001-0004-4000-8000-000000000004';
  st5 uuid := 'd3000001-0005-4000-8000-000000000005';
  st6 uuid := 'd3000001-0006-4000-8000-000000000006';
  st7 uuid := 'd3000001-0007-4000-8000-000000000007';
  st8 uuid := 'd3000001-0008-4000-8000-000000000008';
  st9 uuid := 'd3000001-0009-4000-8000-000000000009';
  st10 uuid := 'd3000001-0010-4000-8000-000000000010';
  q1 uuid := 'da000001-0001-4000-8000-000000000001';
  q2 uuid := 'da000001-0002-4000-8000-000000000002';
  q3 uuid := 'da000001-0003-4000-8000-000000000003';
  q4 uuid := 'da000001-0004-4000-8000-000000000004';
  q5 uuid := 'da000001-0005-4000-8000-000000000005';
  q6 uuid := 'da000001-0006-4000-8000-000000000006';
  a1 uuid := 'da000002-0001-4000-8000-000000000001';
  a2 uuid := 'da000002-0002-4000-8000-000000000002';
  a3 uuid := 'da000002-0003-4000-8000-000000000003';
  a4 uuid := 'da000002-0004-4000-8000-000000000004';
  a5 uuid := 'da000002-0005-4000-8000-000000000005';
  a6 uuid := 'da000002-0006-4000-8000-000000000006';
  a7 uuid := 'da000002-0007-4000-8000-000000000007';
  _today date := CURRENT_DATE;
BEGIN
  PERFORM public._demo_upsert_auth_user(u_s6,  'kavya.nair@wisdomcampus.com',  _pw, 'Kavya Nair');
  PERFORM public._demo_upsert_auth_user(u_s7,  'ishaan.gupta@wisdomcampus.com', _pw, 'Ishaan Gupta');
  PERFORM public._demo_upsert_auth_user(u_s8,  'meera.rao@wisdomcampus.com',    _pw, 'Meera Rao');
  PERFORM public._demo_upsert_auth_user(u_s9,  'kabir.khan@wisdomcampus.com',   _pw, 'Kabir Khan');
  PERFORM public._demo_upsert_auth_user(u_s10, 'nisha.das@wisdomcampus.com',    _pw, 'Nisha Das');

  INSERT INTO public.profiles (id, full_name, email) VALUES
    (u_s6, 'Kavya Nair',  'kavya.nair@wisdomcampus.com'),
    (u_s7, 'Ishaan Gupta','ishaan.gupta@wisdomcampus.com'),
    (u_s8, 'Meera Rao',   'meera.rao@wisdomcampus.com'),
    (u_s9, 'Kabir Khan',  'kabir.khan@wisdomcampus.com'),
    (u_s10,'Nisha Das',   'nisha.das@wisdomcampus.com')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_s6, 'student'), (u_s7, 'student'), (u_s8, 'student'), (u_s9, 'student'), (u_s10, 'student')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.students (
    id, user_id, full_name, admission_number, roll_number, class_id,
    parent_name, parent_mobile, address, date_of_birth
  ) VALUES
    (st6,  u_s6,  'Kavya Nair',   'WC10A006', '6',  c10a, 'Deepa Nair',     '9876502006', 'Kothrud, Pune',       '2010-08-11'),
    (st7,  u_s7,  'Ishaan Gupta', 'WC10A007', '7',  c10a, 'Neeraj Gupta',   '9876502007', 'Shivajinagar, Pune',  '2010-02-04'),
    (st8,  u_s8,  'Meera Rao',    'WC10A008', '8',  c10a, 'Sonal Rao',      '9876502008', 'Wakad, Pune',         '2010-12-21'),
    (st9,  u_s9,  'Kabir Khan',   'WC10A009', '9',  c10a, 'Aamir Khan',     '9876502009', 'Camp, Pune',          '2010-09-18'),
    (st10, u_s10, 'Nisha Das',    'WC10A010', '10', c10a, 'Madhumita Das',  '9876502010', 'Hinjewadi, Pune',     '2010-06-07')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    full_name = EXCLUDED.full_name,
    class_id = EXCLUDED.class_id,
    roll_number = EXCLUDED.roll_number;

  INSERT INTO public.student_xp (user_id, xp, level, current_streak, longest_streak, total_battles, wins, equipped_badge, last_battle_at) VALUES
    (u_s6, 260, 3, 4, 8, 5, 2, 'first_dpp', now() - interval '1 day'),
    (u_s7, 510, 5, 6, 9, 9, 5, 'sharp_shooter', now() - interval '3 hours'),
    (u_s8, 145, 2, 2, 4, 3, 1, NULL, now() - interval '2 days'),
    (u_s9, 390, 4, 5, 7, 7, 3, 'first_win', now() - interval '4 hours'),
    (u_s10, 210, 3, 1, 5, 4, 2, NULL, now() - interval '1 day')
  ON CONFLICT (user_id) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, current_streak = EXCLUDED.current_streak, wins = EXCLUDED.wins;

  INSERT INTO public.attendance (student_id, class_id, date, status, marked_by) VALUES
    (st6, c10a, _today, 'present', u_t_math), (st7, c10a, _today, 'present', u_t_math), (st8, c10a, _today, 'present', u_t_math), (st9, c10a, _today, 'absent', u_t_math), (st10, c10a, _today, 'present', u_t_math),
    (st6, c10a, _today - 1, 'present', u_t_math), (st7, c10a, _today - 1, 'leave', u_t_math), (st8, c10a, _today - 1, 'present', u_t_math), (st9, c10a, _today - 1, 'present', u_t_math), (st10, c10a, _today - 1, 'present', u_t_math),
    (st6, c10a, _today - 2, 'absent', u_t_math), (st7, c10a, _today - 2, 'present', u_t_math), (st8, c10a, _today - 2, 'present', u_t_math), (st9, c10a, _today - 2, 'present', u_t_math), (st10, c10a, _today - 2, 'leave', u_t_math)
  ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by;

  INSERT INTO public.community_doubts (
    id, user_id, student_id, class_id, student_name, class_label,
    subject, chapter, concept, title, body, status, teacher_answered,
    accepted_answer_id, last_activity_at, created_at
  ) VALUES
    (q1, u_s1, st1, c10a, 'Arjun Mehta', 'Class 10-A', 'Mathematics', 'Real Numbers', 'Euclid Division Lemma',
     'Why does Euclid division lemma always end with a smaller remainder?',
     'I can use a = bq + r, but I do not understand why r must be smaller than b every time.', 'solved', true, a1, now() - interval '2 hours', now() - interval '3 days'),
    (q2, u_s6, st6, c10a, 'Kavya Nair', 'Class 10-A', 'Mathematics', 'Polynomials', 'Zeroes of polynomial',
     'How are zeroes connected to the graph crossing the x-axis?',
     'In quadratic graphs, I see the curve touching the axis. Is every touch point a zero?', 'teacher_answered', true, NULL, now() - interval '4 hours', now() - interval '2 days'),
    (q3, u_s7, st7, c10a, 'Ishaan Gupta', 'Class 10-A', 'Physics', 'Electricity', 'Series and parallel circuits',
     'Why does current remain same in a series circuit?',
     'Voltage gets divided in series, but current does not. I need a simple reasoning.', 'community_solved', false, NULL, now() - interval '5 hours', now() - interval '2 days'),
    (q4, u_s8, st8, c10a, 'Meera Rao', 'Class 10-A', 'Chemistry', 'Acids Bases and Salts', 'pH scale',
     'Why is pH 7 neutral and not zero?',
     'If pH measures hydrogen ions, why is water not pH 0?', 'unsolved', false, NULL, now() - interval '1 hour', now() - interval '1 day'),
    (q5, u_s9, st9, c10a, 'Kabir Khan', 'Class 10-A', 'Mathematics', 'Triangles', 'Similarity criteria',
     'When should I use AA and when should I use SAS similarity?',
     'I get confused in proofs when both look possible. What should I check first?', 'solved', true, a6, now() - interval '30 minutes', now() - interval '16 hours'),
    (q6, u_s10, st10, c10a, 'Nisha Das', 'Class 10-A', 'Biology', 'Life Processes', 'Transportation in plants',
     'How does transpiration pull water upward against gravity?',
     'The plant has no pump like the heart, so how does water move to leaves?', 'unsolved', false, NULL, now() - interval '20 minutes', now() - interval '5 hours')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    teacher_answered = EXCLUDED.teacher_answered,
    accepted_answer_id = EXCLUDED.accepted_answer_id,
    last_activity_at = EXCLUDED.last_activity_at;

  INSERT INTO public.community_doubt_answers (
    id, doubt_id, user_id, author_name, author_role, body, is_teacher_verified, is_accepted, created_at
  ) VALUES
    (a1, q1, u_t_math, 'Priya Sharma', 'teacher',
     'Think of the remainder as what is left after making the largest possible groups of size b. If r was equal to or bigger than b, you could make one more group, so the division was not finished. Therefore 0 <= r < b.',
     true, true, now() - interval '2 days'),
    (a2, q1, u_s7, 'Ishaan Gupta', 'student',
     'Example: 17 divided by 5 gives 15 used and 2 left. If 5 or more was left, we could subtract another 5.',
     false, false, now() - interval '1 day'),
    (a3, q2, u_t_math, 'Priya Sharma', 'teacher',
     'A zero is an input where y becomes 0. On the graph, y = 0 is exactly the x-axis, so every crossing or touching point on the x-axis is a zero.',
     true, false, now() - interval '1 day'),
    (a4, q3, u_s3, 'Rohan Singh', 'student',
     'In series there is only one path. Charge cannot split anywhere, so the same amount of charge passes every component each second.',
     false, false, now() - interval '20 hours'),
    (a5, q3, u_s6, 'Kavya Nair', 'student',
     'Imagine one narrow pipe with bulbs in a line. The same water flow passes each point, but pressure drops across each part.',
     false, false, now() - interval '18 hours'),
    (a6, q5, u_t_math, 'Priya Sharma', 'teacher',
     'Use AA when two angle pairs are clearly equal. Use SAS similarity when one included angle is equal and the surrounding sides are proportional. Start by marking given equal angles first.',
     true, true, now() - interval '10 hours'),
    (a7, q5, u_s1, 'Arjun Mehta', 'student',
     'I first check if the diagram has parallel lines. If yes, angles usually become easier and AA may work.',
     false, false, now() - interval '8 hours')
  ON CONFLICT (id) DO UPDATE SET
    body = EXCLUDED.body,
    is_teacher_verified = EXCLUDED.is_teacher_verified,
    is_accepted = EXCLUDED.is_accepted;

  INSERT INTO public.community_doubt_votes (user_id, doubt_id) VALUES
    (u_s2, q1), (u_s3, q1), (u_s6, q1), (u_s7, q1), (u_s8, q2), (u_s9, q2), (u_s1, q3), (u_s4, q3), (u_s5, q4), (u_s10, q4), (u_s2, q5), (u_s6, q5), (u_s7, q6)
  ON CONFLICT (user_id, doubt_id) DO NOTHING;

  INSERT INTO public.community_doubt_votes (user_id, answer_id) VALUES
    (u_s1, a1), (u_s2, a1), (u_s3, a1), (u_s6, a1), (u_s7, a1),
    (u_s4, a2), (u_s1, a3), (u_s7, a3), (u_s8, a3),
    (u_s1, a4), (u_s2, a4), (u_s8, a5), (u_s9, a5),
    (u_s1, a6), (u_s2, a6), (u_s3, a6), (u_s8, a6), (u_s10, a6),
    (u_s6, a7)
  ON CONFLICT (user_id, answer_id) DO NOTHING;

  UPDATE public.community_doubt_answers a
  SET upvote_count = v.total
  FROM (
    SELECT answer_id, COUNT(*)::int AS total
    FROM public.community_doubt_votes
    WHERE answer_id IS NOT NULL
    GROUP BY answer_id
  ) v
  WHERE a.id = v.answer_id;

  UPDATE public.community_doubts d
  SET
    upvote_count = COALESCE(v.total, 0),
    answer_count = COALESCE(a.total, 0),
    view_count = CASE d.id
      WHEN q1 THEN 38 WHEN q2 THEN 24 WHEN q3 THEN 31 WHEN q4 THEN 12 WHEN q5 THEN 27 WHEN q6 THEN 9 ELSE d.view_count
    END
  FROM (
    SELECT doubt_id, COUNT(*)::int AS total
    FROM public.community_doubt_votes
    WHERE doubt_id IS NOT NULL
    GROUP BY doubt_id
  ) v
  FULL JOIN (
    SELECT doubt_id, COUNT(*)::int AS total
    FROM public.community_doubt_answers
    GROUP BY doubt_id
  ) a ON a.doubt_id = v.doubt_id
  WHERE d.id = COALESCE(v.doubt_id, a.doubt_id);

  PERFORM public._community_refresh_reputation(u_t_math);
  PERFORM public._community_refresh_reputation(u_s1);
  PERFORM public._community_refresh_reputation(u_s3);
  PERFORM public._community_refresh_reputation(u_s6);
  PERFORM public._community_refresh_reputation(u_s7);

  INSERT INTO public.notifications (user_id, type, title, body, icon, link, read) VALUES
    (u_s1, 'general', 'New doubt replies available', 'Your Real Numbers doubt has a teacher verified best answer.', 'bell', '/student/classes#doubts', false),
    (u_s6, 'general', 'Doubt Portal is active', 'Class 10-A students are discussing Polynomials, Electricity, Triangles and more.', 'bell', '/student/classes#doubts', false),
    (u_t_math, 'general', 'Doubts need attention', 'Two Class 10-A doubts are still unsolved in the community portal.', 'bell', '/teacher/doubts', false)
  ON CONFLICT DO NOTHING;
END $demo$;

DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);
