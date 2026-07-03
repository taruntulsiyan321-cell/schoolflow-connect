-- Enrich Class 10-A teacher panel demo data (Priya Sharma / u_t_math).
-- Safe to re-run. Fixed UUIDs + ON CONFLICT throughout.

DO $demo$
DECLARE
  c10a uuid := 'd2000001-0001-4000-8000-000000000001';
  u_t_math uuid := 'd1000002-0001-4000-8000-000000000001';
  u_p1 uuid := 'd1000004-0001-4000-8000-000000000001';
  u_p2 uuid := 'd1000004-0002-4000-8000-000000000002';
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
  hw1 uuid := 'd6000001-0001-4000-8000-000000000001';
  hw2 uuid := 'de607030-0001-4000-8000-000000000001';
  hw3 uuid := 'de607030-0002-4000-8000-000000000002';
  hw4 uuid := 'de607030-0003-4000-8000-000000000003';
  dpp_pub uuid := 'd5000001-0001-4000-8000-000000000001';
  dpp2 uuid := 'de607030-0010-4000-8000-000000000001';
  dpp3 uuid := 'de607030-0011-4000-8000-000000000002';
  dpp2_q1 uuid := 'de607030-0012-4000-8000-000000000001';
  dpp2_q2 uuid := 'de607030-0012-4000-8000-000000000002';
  dpp2_q3 uuid := 'de607030-0012-4000-8000-000000000003';
  dpp3_q1 uuid := 'de607030-0013-4000-8000-000000000001';
  dpp3_q2 uuid := 'de607030-0013-4000-8000-000000000002';
  b_teacher_live uuid := 'de607030-0020-4000-8000-000000000001';
  b_teacher_done uuid := 'de607030-0021-4000-8000-000000000002';
  b_teacher_sched uuid := 'de607030-0022-4000-8000-000000000003';
  bq_t1 uuid := 'de607030-0023-4000-8000-000000000001';
  bq_t2 uuid := 'de607030-0023-4000-8000-000000000002';
  bq_t3 uuid := 'de607030-0023-4000-8000-000000000003';
  exam4 uuid := 'de607030-0030-4000-8000-000000000001';
  exam5 uuid := 'de607030-0031-4000-8000-000000000002';
  _qb_tri uuid;
  _qb_poly uuid;
  _qb_circ uuid;
  _today date := CURRENT_DATE;
  _d int;
  _status text;
  _students uuid[] := ARRAY[st1, st2, st3, st4, st5, st6, st7, st8, st9, st10];
  _statuses text[] := ARRAY['present', 'present', 'present', 'present', 'absent', 'present', 'present', 'leave', 'present', 'present'];
BEGIN
  -- ── Question bank (concept-tagged, teacher-created) ─────────────────────────
  INSERT INTO public.question_bank (
    id, class_level, subject, chapter, topic, concept, subconcept, difficulty,
    question, options, correct_index, explanation, source, created_by, is_approved
  ) VALUES
    ('de607030-0040-4000-8000-000000000001', 10, 'Mathematics', 'Trigonometry', 'Ratios', 'Trigonometric Ratios', 'sin/cos/tan values', 'easy',
     'The value of tan 45° is:',
     '["0","1","√3","1/2"]'::jsonb, 1, 'tan 45° = 1', 'teacher_demo', u_t_math, true),
    ('de607030-0040-4000-8000-000000000002', 10, 'Mathematics', 'Trigonometry', 'Identities', 'Pythagorean identity', 'sin²+cos²=1', 'medium',
     'Which is always true for any angle θ?',
     '["sin θ = cos θ","sin²θ + cos²θ = 1","tan θ = 1","sin θ + cos θ = 1"]'::jsonb, 1, 'Fundamental identity', 'teacher_demo', u_t_math, true),
    ('de607030-0040-4000-8000-000000000003', 10, 'Mathematics', 'Polynomials', 'Zeroes', 'Zeroes of polynomial', 'Number of zeroes', 'medium',
     'A quadratic polynomial can have at most how many zeroes?',
     '["1","2","3","4"]'::jsonb, 1, 'Degree 2 ⇒ at most 2 zeroes', 'teacher_demo', u_t_math, true),
    ('de607030-0040-4000-8000-000000000004', 10, 'Mathematics', 'Triangles', 'Similarity', 'Similarity Criteria', 'AA similarity', 'medium',
     'Two triangles are similar if two pairs of angles are:',
     '["Supplementary","Complementary","Equal","Right angles"]'::jsonb, 2, 'AA criterion', 'teacher_demo', u_t_math, true),
    ('de607030-0040-4000-8000-000000000005', 10, 'Mathematics', 'Coordinate Geometry', 'Distance', 'Distance formula', 'Between two points', 'easy',
     'Distance between (0,0) and (3,4) is:',
     '["5","7","12","25"]'::jsonb, 0, '√(9+16) = 5', 'teacher_demo', u_t_math, true)
  ON CONFLICT (id) DO UPDATE SET
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    question = EXCLUDED.question,
    is_approved = EXCLUDED.is_approved;

  SELECT id INTO _qb_tri FROM public.question_bank WHERE id = 'de607030-0040-4000-8000-000000000001';
  SELECT id INTO _qb_poly FROM public.question_bank WHERE id = 'de607030-0040-4000-8000-000000000003';
  SELECT id INTO _qb_circ FROM public.question_bank WHERE id = 'de607030-0040-4000-8000-000000000005';

  -- ── Homework (3 new + submissions across st1–st10) ────────────────────────
  INSERT INTO public.homework (id, class_id, subject, title, description, due_date, created_by) VALUES
    (hw2, c10a, 'Mathematics', 'NCERT Ch 8 — Trigonometry Ratios',
     'Memorise ratios for 0°, 30°, 45°, 60°, 90° and solve Ex 8.1 Q 1–4.', _today + 2, u_t_math),
    (hw3, c10a, 'Mathematics', 'Polynomials — Zeroes & Graphs',
     'Find zeroes of given quadratics and sketch rough graphs.', _today + 5, u_t_math),
    (hw4, c10a, 'Mathematics', 'Triangles — Similarity Proofs',
     'Prove similarity using AA criterion for two given triangles.', _today - 1, u_t_math)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, due_date = EXCLUDED.due_date;

  INSERT INTO public.homework_submissions (homework_id, student_id, content, status, grade, teacher_remarks, submitted_at, graded_at) VALUES
    (hw2, st1, 'Completed ratio table and all four questions.', 'graded', 'A', 'Accurate values.', now() - interval '6 hours', now() - interval '4 hours'),
    (hw2, st2, 'Submitted ratio sheet — please check Q3.', 'submitted', NULL, NULL, now() - interval '3 hours', NULL),
    (hw2, st3, 'All questions done with diagrams.', 'graded', 'A+', 'Excellent visual work.', now() - interval '8 hours', now() - interval '6 hours'),
    (hw2, st4, 'Finished early.', 'graded', 'A', 'Good initiative.', now() - interval '10 hours', now() - interval '8 hours'),
    (hw2, st5, 'Working on Q4 still.', 'submitted', NULL, NULL, now() - interval '1 hour', NULL),
    (hw2, st6, 'Submitted with corrections from class.', 'graded', 'B+', 'Improving steadily.', now() - interval '5 hours', now() - interval '3 hours'),
    (hw2, st7, 'Perfect ratio table.', 'graded', 'A+', 'Flawless.', now() - interval '7 hours', now() - interval '5 hours'),
    (hw2, st8, 'Need help with tan 60°.', 'submitted', NULL, NULL, now() - interval '2 hours', NULL),
    (hw2, st9, 'Completed all parts.', 'graded', 'B', 'Check unit consistency.', now() - interval '9 hours', now() - interval '7 hours'),
    (hw2, st10, 'Partial submission.', 'submitted', NULL, NULL, now() - interval '30 minutes', NULL),
    (hw3, st1, 'Zeroes found for all three polynomials.', 'submitted', NULL, NULL, now() - interval '4 hours', NULL),
    (hw3, st2, 'Graphs sketched.', 'submitted', NULL, NULL, now() - interval '2 hours', NULL),
    (hw3, st7, 'Extra challenge problem included.', 'graded', 'A+', 'Outstanding extension.', now() - interval '5 hours', now() - interval '3 hours'),
    (hw4, st1, 'AA proof completed with clear steps.', 'graded', 'A', 'Clear reasoning.', now() - interval '2 days', now() - interval '1 day'),
    (hw4, st3, 'Proof submitted.', 'graded', 'A-', 'Minor notation fix needed.', now() - interval '2 days', now() - interval '1 day'),
    (hw4, st4, 'Excellent proof structure.', 'graded', 'A+', 'Model answer quality.', now() - interval '2 days', now() - interval '1 day'),
    (hw4, st5, 'Submitted but incomplete.', 'submitted', NULL, NULL, now() - interval '1 day', NULL),
    (hw4, st8, 'Struggled with step 3.', 'submitted', NULL, NULL, now() - interval '20 hours', NULL),
    (hw4, st10, 'Could not finish proof.', 'submitted', NULL, NULL, now() - interval '18 hours', NULL)
  ON CONFLICT (homework_id, student_id) DO UPDATE SET
    content = EXCLUDED.content, status = EXCLUDED.status, grade = EXCLUDED.grade,
    teacher_remarks = EXCLUDED.teacher_remarks, submitted_at = EXCLUDED.submitted_at, graded_at = EXCLUDED.graded_at;

  -- ── DPPs (2 new published sets + attempts) ──────────────────────────────────
  INSERT INTO public.dpps (
    id, title, subject, chapter, topic, class_id, created_by,
    difficulty, instructions, due_at, duration_sec, total_marks, negative_marking,
    is_published, question_count
  ) VALUES
    (dpp2, 'DPP — Trigonometry Ratios', 'Mathematics', 'Trigonometry', 'Standard Angles',
     c10a, u_t_math, 'easy', 'No calculator. Recall standard values.', now() + interval '3 days',
     900, 3, 0, true, 3),
    (dpp3, 'DPP — Polynomials & Coordinate Geometry', 'Mathematics', 'Polynomials', 'Zeroes & Distance',
     c10a, u_t_math, 'medium', 'Show working for each step.', now() + interval '6 days',
     1200, 2, 0.25, true, 2)
  ON CONFLICT (id) DO UPDATE SET is_published = EXCLUDED.is_published, title = EXCLUDED.title;

  INSERT INTO public.dpp_questions (id, dpp_id, order_index, kind, question, options, correct, marks, explanation, concept, subconcept) VALUES
    (dpp2_q1, dpp2, 0, 'mcq', 'sin 30° equals:',
     '["1/2","√3/2","1","0"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, 'sin 30° = 1/2', 'Trigonometric Ratios', 'sin values'),
    (dpp2_q2, dpp2, 1, 'mcq', 'cos 60° equals:',
     '["1/2","√3/2","1","0"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, 'cos 60° = 1/2', 'Trigonometric Ratios', 'cos values'),
    (dpp2_q3, dpp2, 2, 'mcq', 'tan 45° equals:',
     '["0","1","√3","1/2"]'::jsonb, '{"indexes":[1]}'::jsonb, 1, 'tan 45° = 1', 'Trigonometric Ratios', 'tan values'),
    (dpp3_q1, dpp3, 0, 'mcq', 'A quadratic has at most how many zeroes?',
     '["1","2","3","4"]'::jsonb, '{"indexes":[1]}'::jsonb, 1, 'Degree 2', 'Zeroes of polynomial', 'Count'),
    (dpp3_q2, dpp3, 1, 'mcq', 'Distance between (0,0) and (6,8) is:',
     '["10","14","48","100"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, '√(36+64)=10', 'Distance formula', 'Two points')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.dpp_attempts (
    id, dpp_id, user_id, student_id, started_at, submitted_at,
    score, max_score, correct_count, total_count, time_spent_sec, status
  ) VALUES
    ('de607030-0014-4000-8000-000000000001', dpp2, u_s1, st1, now() - interval '1 day', now() - interval '1 day' + interval '8 minutes', 3, 3, 3, 3, 480, 'submitted'),
    ('de607030-0014-4000-8000-000000000002', dpp2, u_s2, st2, now() - interval '1 day', now() - interval '1 day' + interval '10 minutes', 2, 3, 2, 3, 600, 'submitted'),
    ('de607030-0014-4000-8000-000000000003', dpp2, u_s3, st3, now() - interval '1 day', now() - interval '1 day' + interval '7 minutes', 3, 3, 3, 3, 420, 'submitted'),
    ('de607030-0014-4000-8000-000000000004', dpp2, u_s4, st4, now() - interval '1 day', now() - interval '1 day' + interval '6 minutes', 3, 3, 3, 3, 360, 'submitted'),
    ('de607030-0014-4000-8000-000000000005', dpp2, u_s5, st5, now() - interval '1 day', now() - interval '1 day' + interval '12 minutes', 1, 3, 1, 3, 720, 'submitted'),
    ('de607030-0014-4000-8000-000000000006', dpp2, u_s6, st6, now() - interval '1 day', now() - interval '1 day' + interval '9 minutes', 2, 3, 2, 3, 540, 'submitted'),
    ('de607030-0014-4000-8000-000000000007', dpp2, u_s7, st7, now() - interval '1 day', now() - interval '1 day' + interval '5 minutes', 3, 3, 3, 3, 300, 'submitted'),
    ('de607030-0014-4000-8000-000000000008', dpp2, u_s8, st8, now() - interval '1 day', now() - interval '1 day' + interval '14 minutes', 0, 3, 0, 3, 840, 'submitted'),
    ('de607030-0014-4000-8000-000000000009', dpp2, u_s9, st9, now() - interval '1 day', now() - interval '1 day' + interval '11 minutes', 2, 3, 2, 3, 660, 'submitted'),
    ('de607030-0014-4000-8000-000000000010', dpp3, u_s1, st1, now() - interval '12 hours', now() - interval '11 hours', 2, 2, 2, 2, 540, 'submitted'),
    ('de607030-0014-4000-8000-000000000011', dpp3, u_s7, st7, now() - interval '10 hours', now() - interval '9 hours', 2, 2, 2, 2, 420, 'submitted'),
    ('de607030-0014-4000-8000-000000000012', dpp3, u_s10, st10, now() - interval '8 hours', now() - interval '7 hours', 0, 2, 0, 2, 780, 'submitted')
  ON CONFLICT (dpp_id, user_id) DO UPDATE SET
    status = EXCLUDED.status, score = EXCLUDED.score,
    correct_count = EXCLUDED.correct_count, submitted_at = EXCLUDED.submitted_at;

  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count, status)
  VALUES (dpp2, u_s10, st10, 3, 3, 'in_progress')
  ON CONFLICT (dpp_id, user_id) DO NOTHING;

  -- ── Teacher-created battles (live + finished + scheduled) ───────────────────
  INSERT INTO public.battles (
    id, class_id, creator_user_id, title, subject, topic, chapter, difficulty,
    type, status, starts_at, duration_sec, per_question_sec, question_count,
    is_public, mode, source, class_level
  ) VALUES
    (b_teacher_live, c10a, u_t_math, 'Live: Trigonometry Sprint', 'Mathematics', 'Trigonometry', 'Ratios', 'easy',
     'mcq', 'live', now(), 60, 20, 3, true, 'class', 'bank', 10),
    (b_teacher_done, c10a, u_t_math, 'Finished: Polynomials Blitz', 'Mathematics', 'Polynomials', 'Zeroes', 'medium',
     'mcq', 'finished', now() - interval '1 day', 60, 20, 3, true, 'class', 'bank', 10),
    (b_teacher_sched, c10a, u_t_math, 'Scheduled: Triangles Showdown', 'Mathematics', 'Triangles', 'Similarity', 'medium',
     'mcq', 'scheduled', now() + interval '3 days', 60, 20, 3, true, 'class', 'bank', 10)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, title = EXCLUDED.title, creator_user_id = EXCLUDED.creator_user_id;

  INSERT INTO public.battle_questions (id, battle_id, order_index, question, options, correct_index, points, bank_question_id, concept, subconcept) VALUES
    (bq_t1, b_teacher_done, 0, 'tan 45° equals:', '["0","1","√3","1/2"]'::jsonb, 1, 10, _qb_tri, 'Trigonometric Ratios', 'tan values'),
    (bq_t2, b_teacher_done, 1, 'A quadratic has at most how many zeroes?', '["1","2","3","4"]'::jsonb, 1, 10, _qb_poly, 'Zeroes of polynomial', 'Count'),
    (bq_t3, b_teacher_done, 2, 'Distance between (0,0) and (3,4) is:', '["5","7","12","25"]'::jsonb, 0, 10, _qb_circ, 'Distance formula', 'Two points')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.battle_questions (id, battle_id, order_index, question, options, correct_index, points, bank_question_id) VALUES
    ('de607030-0024-4000-8000-000000000001', b_teacher_live, 0, 'sin 30° equals:', '["1/2","√3/2","1","0"]'::jsonb, 0, 10, _qb_tri),
    ('de607030-0024-4000-8000-000000000002', b_teacher_live, 1, 'cos 60° equals:', '["1/2","√3/2","1","0"]'::jsonb, 0, 10, _qb_tri),
    ('de607030-0024-4000-8000-000000000003', b_teacher_live, 2, 'Which is always true?', '["sin θ = cos θ","sin²θ + cos²θ = 1","tan θ = 1","sin θ + cos θ = 1"]'::jsonb, 1, 10, _qb_tri)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.battle_participants (
    id, battle_id, user_id, student_id, display_name,
    joined_at, finished_at, score, correct_count, answered_count, total_time_ms, rank
  ) VALUES
    ('de607030-0025-4000-8000-000000000001', b_teacher_done, u_s1, st1, 'Arjun Mehta', now() - interval '1 day', now() - interval '1 day' + interval '55 seconds', 30, 3, 3, 55000, 1),
    ('de607030-0025-4000-8000-000000000002', b_teacher_done, u_s3, st3, 'Rohan Singh', now() - interval '1 day', now() - interval '1 day' + interval '62 seconds', 20, 2, 3, 62000, 2),
    ('de607030-0025-4000-8000-000000000003', b_teacher_done, u_s4, st4, 'Ananya Iyer', now() - interval '1 day', now() - interval '1 day' + interval '58 seconds', 30, 3, 3, 58000, 1),
    ('de607030-0025-4000-8000-000000000004', b_teacher_done, u_s7, st7, 'Ishaan Gupta', now() - interval '1 day', now() - interval '1 day' + interval '50 seconds', 30, 3, 3, 50000, 1),
    ('de607030-0025-4000-8000-000000000005', b_teacher_done, u_s8, st8, 'Meera Rao', now() - interval '1 day', now() - interval '1 day' + interval '70 seconds', 10, 1, 3, 70000, 5),
    ('de607030-0025-4000-8000-000000000006', b_teacher_done, u_s10, st10, 'Nisha Das', now() - interval '1 day', now() - interval '1 day' + interval '75 seconds', 0, 0, 3, 75000, 6),
    ('de607030-0025-4000-8000-000000000007', b_teacher_live, u_s2, st2, 'Priya Patel', now() - interval '5 minutes', NULL, 10, 1, 1, 18000, NULL),
    ('de607030-0025-4000-8000-000000000008', b_teacher_live, u_s5, st5, 'Vikram Joshi', now() - interval '4 minutes', NULL, 0, 0, 1, 22000, NULL),
    ('de607030-0025-4000-8000-000000000009', b_teacher_live, u_s6, st6, 'Kavya Nair', now() - interval '3 minutes', NULL, 10, 1, 1, 15000, NULL)
  ON CONFLICT (battle_id, user_id) DO UPDATE SET
    score = EXCLUDED.score, correct_count = EXCLUDED.correct_count,
    answered_count = EXCLUDED.answered_count, rank = EXCLUDED.rank, finished_at = EXCLUDED.finished_at;

  INSERT INTO public.battle_events (kind, actor_user_id, actor_name, opponent_name, subject, detail, battle_id, class_id, icon) VALUES
    ('start', u_t_math, 'Priya Sharma', NULL, 'Mathematics', 'started a Trigonometry Sprint for Class 10-A', b_teacher_live, c10a, 'swords'),
    ('win', u_s1, 'Arjun Mehta', 'Meera Rao', 'Mathematics', 'topped the Polynomials Blitz', b_teacher_done, c10a, 'trophy'),
    ('schedule', u_t_math, 'Priya Sharma', NULL, 'Mathematics', 'scheduled Triangles Showdown for Friday', b_teacher_sched, c10a, 'calendar')
  ON CONFLICT DO NOTHING;

  -- ── Attendance: 10–14 days of variety (days 5–14 back) ─────────────────────
  FOR _d IN 5..14 LOOP
    FOR i IN 1..10 LOOP
      _status := _statuses[1 + ((i + _d) % 10)];
      INSERT INTO public.attendance (student_id, class_id, date, status, marked_by)
      VALUES (_students[i], c10a, _today - _d, _status, u_t_math)
      ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by;
    END LOOP;
  END LOOP;

  -- ── Exams & marks ─────────────────────────────────────────────────────────
  INSERT INTO public.exams (id, name, exam_type, class_id, subject, max_marks, exam_date, created_by) VALUES
    (exam4, 'Weekly Test — Trigonometry', 'other', c10a, 'Mathematics', 25, _today - 5, u_t_math),
    (exam5, 'Class Test — Polynomials', 'class_test', c10a, 'Mathematics', 30, _today - 10, u_t_math)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, exam_date = EXCLUDED.exam_date;

  INSERT INTO public.marks (exam_id, student_id, marks_obtained, remarks) VALUES
    (exam4, st1, 23, 'Strong ratios recall'), (exam4, st2, 18, 'Check tan values'), (exam4, st3, 21, 'Good'),
    (exam4, st4, 25, 'Perfect score'), (exam4, st5, 14, 'Needs revision'), (exam4, st6, 19, 'Steady'),
    (exam4, st7, 24, 'Excellent'), (exam4, st8, 11, 'Recovery needed'), (exam4, st9, 17, 'Improving'),
    (exam4, st10, 10, 'Intervention required'),
    (exam5, st1, 27, 'Excellent factorisation'), (exam5, st2, 22, 'Good'), (exam5, st3, 28, 'Top performer'),
    (exam5, st4, 29, 'Outstanding'), (exam5, st5, 16, 'Practice more'), (exam5, st6, 20, 'Fair'),
    (exam5, st7, 26, 'Very good'), (exam5, st8, 13, 'Concept gaps'), (exam5, st9, 21, 'Better'),
    (exam5, st10, 12, 'Needs support')
  ON CONFLICT (exam_id, student_id) DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, remarks = EXCLUDED.remarks;

  -- ── Leave requests (pending for teacher review) ─────────────────────────────
  INSERT INTO public.leave_requests (
    id, applicant_user_id, applicant_kind, student_id, class_id,
    leave_type, from_date, to_date, reason, status, reviewed_by, reviewed_at
  ) VALUES
    ('de607030-0050-4000-8000-000000000001', u_s8, 'student', st8, c10a,
     'medical', _today + 1, _today + 2, 'Dental procedure — doctor certificate attached.', 'pending', NULL, NULL),
    ('de607030-0050-4000-8000-000000000002', u_s9, 'student', st9, c10a,
     'family', _today + 3, _today + 4, 'Sibling wedding in Nashik.', 'pending', NULL, NULL),
    ('de607030-0050-4000-8000-000000000003', u_s10, 'student', st10, c10a,
     'medical', _today, _today, 'Migraine — resting at home today.', 'pending', NULL, NULL),
    ('de607030-0050-4000-8000-000000000004', u_s6, 'student', st6, c10a,
     'other', _today + 7, _today + 7, 'National science olympiad at Delhi.', 'pending', NULL, NULL)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason;

  -- ── Messages (teacher ↔ parents & students) ─────────────────────────────────
  INSERT INTO public.messages (id, sender_id, receiver_id, content, is_read) VALUES
    ('de607030-0060-4000-8000-000000000001', u_p1, u_t_math, 'Ma''am, Arjun scored well in the trigonometry test. Thank you!', true),
    ('de607030-0060-4000-8000-000000000002', u_t_math, u_p1, 'Yes, Arjun is doing very well. Please encourage daily DPP practice.', true),
    ('de607030-0060-4000-8000-000000000003', u_p2, u_t_math, 'Priya missed submitting homework yesterday. She will upload today.', false),
    ('de607030-0060-4000-8000-000000000004', u_t_math, u_p2, 'Noted. The deadline is extended till tomorrow evening.', false),
    ('de607030-0060-4000-8000-000000000005', u_s8, u_t_math, 'Ma''am, I did not understand the similarity proof in homework.', false),
    ('de607030-0060-4000-8000-000000000006', u_t_math, u_s8, 'Come to doubt period tomorrow. We will go through AA criterion step by step.', false),
    ('de607030-0060-4000-8000-000000000007', u_s10, u_t_math, 'Can I get an extension for the polynomials homework?', false),
    ('de607030-0060-4000-8000-000000000008', u_t_math, u_s10, 'Yes — submit by Friday with your rough work notebook photo.', false),
    ('de607030-0060-4000-8000-000000000009', u_s7, u_t_math, 'Ma''am, when is the Triangles battle scheduled?', true),
    ('de607030-0060-4000-8000-000000000010', u_t_math, u_s7, 'Friday at 10 AM. Revise similarity criteria tonight.', true)
  ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, is_read = EXCLUDED.is_read;

  -- ── Class notices ─────────────────────────────────────────────────────────
  INSERT INTO public.notices (id, title, body, audience, class_id, posted_by, expires_at) VALUES
    ('de607030-0070-4000-8000-000000000001',
     'Unit Test — Trigonometry next Monday', 'Revise Ch 8 ratios and identities. No calculator allowed.', 'class', c10a, u_t_math, now() + interval '10 days'),
    ('de607030-0070-4000-8000-000000000002',
     'DPP submission reminder', 'Complete Trigonometry DPP before Wednesday 6 PM.', 'class', c10a, u_t_math, now() + interval '5 days'),
    ('de607030-0070-4000-8000-000000000003',
     'Battleground: Triangles Showdown', 'Class battle on Friday — top 3 get bonus XP.', 'class', c10a, u_t_math, now() + interval '7 days'),
    ('de607030-0070-4000-8000-000000000004',
     'Extra class — Polynomials revision', 'Saturday 8–9 AM for students scoring below 60% in last test.', 'class', c10a, u_t_math, now() + interval '4 days')
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body;

  -- ── Teacher notifications ───────────────────────────────────────────────────
  INSERT INTO public.notifications (id, user_id, type, title, body, icon, link, read) VALUES
    ('de607030-0080-4000-8000-000000000001', u_t_math, 'homework', '8 submissions pending review', 'Trigonometry and Polynomials homework need grading.', 'book', '/teacher/homework', false),
    ('de607030-0080-4000-8000-000000000002', u_t_math, 'leave', '4 leave requests pending', 'Meera, Kabir, Nisha and Kavya await your approval.', 'calendar', '/teacher/leaves', false),
    ('de607030-0080-4000-8000-000000000003', u_t_math, 'battle', 'Live battle in progress', 'Trigonometry Sprint has 3 students joined.', 'swords', '/teacher/battleground/monitor/' || b_teacher_live::text, false),
    ('de607030-0080-4000-8000-000000000004', u_t_math, 'dpp', 'DPP analytics ready', 'Trigonometry DPP: 9/10 students attempted. Meera scored 0/3.', 'chart', '/teacher/dpp/' || dpp2::text || '/analytics', false),
    ('de607030-0080-4000-8000-000000000005', u_t_math, 'insight', 'Meera & Nisha need attention', 'Both scored below 40% in recent tests and DPPs.', 'alert', '/teacher/performance', false),
    ('de607030-0080-4000-8000-000000000006', u_t_math, 'message', '3 unread messages', 'Parents and students messaged about homework and leave.', 'inbox', '/teacher/chat', false),
    ('de607030-0080-4000-8000-000000000007', u_t_math, 'exam', 'Marks entry complete', 'Weekly Trigonometry test marks saved for all 10 students.', 'clipboard', '/teacher/exams', true)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, read = EXCLUDED.read;

  -- ── Student academic brain (AI-like summaries per student) ──────────────────
  INSERT INTO public.student_academic_brain (
    id, user_id, student_id,
    strong_subjects, weak_subjects, strong_chapters, weak_chapters,
    strong_concepts, weak_concepts,
    mistake_history, recovery_history, practice_history,
    speed_trend, accuracy_trend, consistency_trend,
    mastery_snapshot, improvement_history, mistake_classification_trends,
    last_session_analytics, recovery_completion_pct, improvement_trend, total_activities, updated_at
  ) VALUES
    ('de607030-0090-4000-8000-000000000001', u_s1, st1,
     '["Mathematics","Physics"]'::jsonb, '[]'::jsonb,
     '["Real Numbers","Trigonometry"]'::jsonb, '[]'::jsonb,
     '["Euclid Division Lemma","Trigonometric Ratios"]'::jsonb, '[]'::jsonb,
     '{"recent_7d":2,"by_subject":{"Mathematics":1}}'::jsonb,
     '{"completed":2,"in_progress":0}'::jsonb,
     '{"avg_accuracy":88,"last_7d_sessions":12}'::jsonb,
     '{"avg_ms_per_question":18500}'::jsonb, '{"rolling_7d":88}'::jsonb, '{"sessions_7d":12}'::jsonb,
     '[{"subject":"Mathematics","mastery":92},{"subject":"Physics","mastery":81}]'::jsonb,
     '[{"date":"' || (_today - 7)::text || '","delta":4}]'::jsonb,
     '{"concept_error":1,"careless_mistake":1}'::jsonb,
     '{"summary":"Strong in algebra and trigonometry; maintains daily practice streak."}'::jsonb,
     100, 'improving', 34, now()),
    ('de607030-0090-4000-8000-000000000002', u_s2, st2,
     '["Mathematics"]'::jsonb, '["Physics"]'::jsonb,
     '["Quadratic Equations"]'::jsonb, '["Electricity"]'::jsonb,
     '["Discriminant"]'::jsonb, '["Series Circuit"]'::jsonb,
     '{"recent_7d":4}'::jsonb, '{"in_progress":1}'::jsonb, '{"avg_accuracy":72,"last_7d_sessions":8}'::jsonb,
     '{"avg_ms_per_question":24000}'::jsonb, '{"rolling_7d":72}'::jsonb, '{"sessions_7d":8}'::jsonb,
     '[{"subject":"Mathematics","mastery":68}]'::jsonb, '[]'::jsonb,
     '{"calculation_error":2,"concept_error":2}'::jsonb,
     '{"summary":"Steady in algebra; physics circuits need reinforcement."}'::jsonb,
     50, 'steady', 22, now()),
    ('de607030-0090-4000-8000-000000000003', u_s3, st3,
     '["Mathematics","Physics"]'::jsonb, '[]'::jsonb,
     '["Real Numbers","Electricity"]'::jsonb, '[]'::jsonb,
     '["Euclid Division Lemma","Series Circuit"]'::jsonb, '[]'::jsonb,
     '{"recent_7d":3}'::jsonb, '{"completed":1}'::jsonb, '{"avg_accuracy":91,"last_7d_sessions":16}'::jsonb,
     '{"avg_ms_per_question":16000}'::jsonb, '{"rolling_7d":91}'::jsonb, '{"sessions_7d":16}'::jsonb,
     '[{"subject":"Mathematics","mastery":86},{"subject":"Physics","mastery":81}]'::jsonb, '[]'::jsonb,
     '{"careless_mistake":2,"concept_error":1}'::jsonb,
     '{"summary":"Top performer; occasional careless errors in speed rounds."}'::jsonb,
     100, 'improving', 38, now()),
    ('de607030-0090-4000-8000-000000000004', u_s4, st4,
     '["Mathematics"]'::jsonb, '[]'::jsonb,
     '["Triangles","Polynomials"]'::jsonb, '[]'::jsonb,
     '["AA similarity","Zeroes of polynomial"]'::jsonb, '[]'::jsonb,
     '{"recent_7d":1}'::jsonb, '{"completed":0}'::jsonb, '{"avg_accuracy":94,"last_7d_sessions":20}'::jsonb,
     '{"avg_ms_per_question":14000}'::jsonb, '{"rolling_7d":94}'::jsonb, '{"sessions_7d":20}'::jsonb,
     '[{"subject":"Mathematics","mastery":94}]'::jsonb, '[]'::jsonb, '{"careless_mistake":1}'::jsonb,
     '{"summary":"Class leader in geometry and polynomials."}'::jsonb,
     100, 'improving', 42, now()),
    ('de607030-0090-4000-8000-000000000005', u_s5, st5,
     '[]'::jsonb, '["Mathematics"]'::jsonb,
     '[]'::jsonb, '["Triangles"]'::jsonb,
     '[]'::jsonb, '["SAS similarity"]'::jsonb,
     '{"recent_7d":5}'::jsonb, '{"pending":1}'::jsonb, '{"avg_accuracy":57,"last_7d_sessions":6}'::jsonb,
     '{"avg_ms_per_question":32000}'::jsonb, '{"rolling_7d":57}'::jsonb, '{"sessions_7d":6}'::jsonb,
     '[{"subject":"Mathematics","mastery":57}]'::jsonb, '[]'::jsonb,
     '{"concept_error":3,"calculation_error":2}'::jsonb,
     '{"summary":"Triangles similarity is the main gap; recovery plan active."}'::jsonb,
     20, 'slipping', 18, now()),
    ('de607030-0090-4000-8000-000000000006', u_s6, st6,
     '["Mathematics"]'::jsonb, '[]'::jsonb,
     '["Polynomials"]'::jsonb, '["Trigonometry"]'::jsonb,
     '["Zeroes of polynomial"]'::jsonb, '["Trigonometric Ratios"]'::jsonb,
     '{"recent_7d":3}'::jsonb, '{"completed":1}'::jsonb, '{"avg_accuracy":74,"last_7d_sessions":9}'::jsonb,
     '{"avg_ms_per_question":22000}'::jsonb, '{"rolling_7d":74}'::jsonb, '{"sessions_7d":9}'::jsonb,
     '[{"subject":"Mathematics","mastery":74}]'::jsonb, '[]'::jsonb, '{"concept_error":2}'::jsonb,
     '{"summary":"Good in polynomials; building trigonometry fluency."}'::jsonb,
     80, 'improving', 24, now()),
    ('de607030-0090-4000-8000-000000000007', u_s7, st7,
     '["Mathematics","Physics"]'::jsonb, '[]'::jsonb,
     '["Electricity","Trigonometry"]'::jsonb, '[]'::jsonb,
     '["Series and parallel circuits","Trigonometric Ratios"]'::jsonb, '[]'::jsonb,
     '{"recent_7d":1}'::jsonb, '{"completed":0}'::jsonb, '{"avg_accuracy":96,"last_7d_sessions":21}'::jsonb,
     '{"avg_ms_per_question":12000}'::jsonb, '{"rolling_7d":96}'::jsonb, '{"sessions_7d":21}'::jsonb,
     '[{"subject":"Physics","mastery":96},{"subject":"Mathematics","mastery":90}]'::jsonb, '[]'::jsonb, '{}'::jsonb,
     '{"summary":"Highest accuracy in class; peer helper in doubt portal."}'::jsonb,
     100, 'improving', 45, now()),
    ('de607030-0090-4000-8000-000000000008', u_s8, st8,
     '[]'::jsonb, '["Physics","Mathematics"]'::jsonb,
     '[]'::jsonb, '["Electricity","Trigonometry"]'::jsonb,
     '[]'::jsonb, '["Equivalent resistance","Trigonometric Ratios"]'::jsonb,
     '{"recent_7d":7}'::jsonb, '{"in_progress":1,"severe":1}'::jsonb, '{"avg_accuracy":38,"last_7d_sessions":5}'::jsonb,
     '{"avg_ms_per_question":45000}'::jsonb, '{"rolling_7d":38}'::jsonb, '{"sessions_7d":5}'::jsonb,
     '[{"subject":"Physics","mastery":38}]'::jsonb, '[]'::jsonb,
     '{"concept_error":4,"time_pressure_error":3}'::jsonb,
     '{"summary":"Needs intensive recovery in electricity and trigonometry basics."}'::jsonb,
     30, 'slipping', 15, now()),
    ('de607030-0090-4000-8000-000000000009', u_s9, st9,
     '["Mathematics"]'::jsonb, '[]'::jsonb,
     '["Triangles"]'::jsonb, '["Polynomials"]'::jsonb,
     '["AA similarity"]'::jsonb, '["Zeroes of polynomial"]'::jsonb,
     '{"recent_7d":4}'::jsonb, '{"in_progress":0}'::jsonb, '{"avg_accuracy":63,"last_7d_sessions":7}'::jsonb,
     '{"avg_ms_per_question":28000}'::jsonb, '{"rolling_7d":63}'::jsonb, '{"sessions_7d":7}'::jsonb,
     '[{"subject":"Mathematics","mastery":63}]'::jsonb, '[]'::jsonb, '{"concept_error":2,"careless_mistake":2}'::jsonb,
     '{"summary":"Improving in triangles; polynomials need more practice."}'::jsonb,
     60, 'steady', 19, now()),
    ('de607030-0090-4000-8000-000000000010', u_s10, st10,
     '[]'::jsonb, '["Biology","Mathematics"]'::jsonb,
     '[]'::jsonb, '["Life Processes","Trigonometry"]'::jsonb,
     '[]'::jsonb, '["Transpiration pull","Trigonometric Ratios"]'::jsonb,
     '{"recent_7d":8}'::jsonb, '{"pending":1,"severe":1}'::jsonb, '{"avg_accuracy":32,"last_7d_sessions":4}'::jsonb,
     '{"avg_ms_per_question":50000}'::jsonb, '{"rolling_7d":32}'::jsonb, '{"sessions_7d":4}'::jsonb,
     '[{"subject":"Biology","mastery":32}]'::jsonb, '[]'::jsonb,
     '{"concept_error":5,"misinterpretation_error":3}'::jsonb,
     '{"summary":"Priority intervention: biology transport and math fundamentals."}'::jsonb,
     10, 'slipping', 12, now())
  ON CONFLICT (user_id) DO UPDATE SET
    strong_subjects = EXCLUDED.strong_subjects,
    weak_subjects = EXCLUDED.weak_subjects,
    strong_concepts = EXCLUDED.strong_concepts,
    weak_concepts = EXCLUDED.weak_concepts,
    mastery_snapshot = EXCLUDED.mastery_snapshot,
    last_session_analytics = EXCLUDED.last_session_analytics,
    improvement_trend = EXCLUDED.improvement_trend,
    total_activities = EXCLUDED.total_activities,
    updated_at = EXCLUDED.updated_at;

  -- ── Student mistakes ────────────────────────────────────────────────────────
  INSERT INTO public.student_mistakes (
    id, user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    error_type, difficulty, times_wrong, mastered, last_wrong_at
  ) VALUES
    ('de607030-00a0-4000-8000-000000000001', u_s8, st8, 'dpp', dpp2, dpp2_q1,
     10, 'Mathematics', 'Trigonometry', 'Ratios', 'Trigonometric Ratios', 'sin values', 'dpp',
     'sin 30° equals:', '["1/2","√3/2","1","0"]'::jsonb,
     '{"indexes":[1]}'::jsonb, '{"indexes":[0]}'::jsonb, 'sin 30° = 1/2', 'concept_error', 'easy', 3, false, now() - interval '1 day'),
    ('de607030-00a0-4000-8000-000000000002', u_s8, st8, 'dpp', dpp2, dpp2_q2,
     10, 'Mathematics', 'Trigonometry', 'Ratios', 'Trigonometric Ratios', 'cos values', 'dpp',
     'cos 60° equals:', '["1/2","√3/2","1","0"]'::jsonb,
     '{"indexes":[1]}'::jsonb, '{"indexes":[0]}'::jsonb, 'cos 60° = 1/2', 'concept_error', 'easy', 2, false, now() - interval '1 day'),
    ('de607030-00a0-4000-8000-000000000003', u_s10, st10, 'dpp', dpp2, dpp2_q3,
     10, 'Mathematics', 'Trigonometry', 'Ratios', 'Trigonometric Ratios', 'tan values', 'dpp',
     'tan 45° equals:', '["0","1","√3","1/2"]'::jsonb,
     '{"indexes":[0]}'::jsonb, '{"indexes":[1]}'::jsonb, 'tan 45° = 1', 'concept_error', 'easy', 4, false, now() - interval '8 hours'),
    ('de607030-00a0-4000-8000-000000000004', u_s5, st5, 'exam', exam4, 'de607030-00a0-4000-8000-000000000004',
     10, 'Mathematics', 'Trigonometry', 'Ratios', 'Trigonometric Ratios', 'tan values', 'exam',
     'tan 60° equals:', '["√3","1/√3","1","0"]'::jsonb,
     '{"indexes":[1]}'::jsonb, '{"indexes":[0]}'::jsonb, 'tan 60° = √3', 'calculation_error', 'medium', 2, false, now() - interval '5 days'),
    ('de607030-00a0-4000-8000-000000000005', u_s2, st2, 'battleground', b_teacher_done, bq_t1,
     10, 'Mathematics', 'Trigonometry', 'Ratios', 'Trigonometric Ratios', 'tan values', 'battle',
     'tan 45° equals:', '["0","1","√3","1/2"]'::jsonb,
     '{"indexes":[2]}'::jsonb, '{"indexes":[1]}'::jsonb, 'tan 45° = 1', 'time_pressure_error', 'easy', 1, false, now() - interval '1 day'),
    ('de607030-00a0-4000-8000-000000000006', u_s9, st9, 'dpp', dpp_pub, 'd5000002-0002-4000-8000-000000000002',
     10, 'Mathematics', 'Quadratic Equations', 'Nature of Roots', 'Discriminant', 'Equal roots', 'dpp',
     'If roots are equal, discriminant equals:', '["0","1","b²","2ac"]'::jsonb,
     '{"indexes":[2]}'::jsonb, '{"indexes":[0]}'::jsonb, 'Equal roots ⇒ D = 0', 'careless_mistake', 'medium', 2, false, now() - interval '2 days')
  ON CONFLICT (id) DO UPDATE SET
    times_wrong = EXCLUDED.times_wrong, mastered = EXCLUDED.mastered, last_wrong_at = EXCLUDED.last_wrong_at;

  -- ── Academic daily activity (14-day heatmaps) ───────────────────────────────
  INSERT INTO public.academic_daily_activity (user_id, activity_date, dpp_count, homework_count, battle_count, practice_minutes, self_practice_count) VALUES
    (u_s1, _today, 1, 1, 0, 25, 1), (u_s1, _today - 1, 1, 0, 1, 30, 0), (u_s1, _today - 2, 0, 1, 0, 20, 1),
    (u_s1, _today - 3, 1, 1, 1, 35, 0), (u_s1, _today - 5, 1, 0, 0, 15, 1), (u_s1, _today - 7, 0, 1, 1, 40, 0),
    (u_s2, _today, 0, 1, 0, 10, 0), (u_s2, _today - 1, 1, 0, 0, 20, 0), (u_s2, _today - 3, 1, 1, 0, 25, 0),
    (u_s3, _today, 1, 1, 1, 45, 1), (u_s3, _today - 1, 1, 0, 1, 35, 0), (u_s3, _today - 4, 1, 1, 0, 30, 1),
    (u_s4, _today, 1, 1, 0, 30, 0), (u_s4, _today - 2, 1, 1, 1, 40, 1), (u_s4, _today - 6, 1, 0, 0, 20, 0),
    (u_s5, _today, 0, 1, 0, 8, 0), (u_s5, _today - 2, 1, 0, 0, 12, 0), (u_s5, _today - 5, 0, 1, 0, 10, 0),
    (u_s6, _today, 1, 1, 0, 22, 0), (u_s6, _today - 1, 1, 0, 1, 28, 0), (u_s6, _today - 3, 0, 1, 0, 18, 1),
    (u_s7, _today, 1, 1, 1, 50, 1), (u_s7, _today - 1, 1, 1, 1, 45, 0), (u_s7, _today - 2, 1, 0, 1, 38, 1),
    (u_s8, _today, 1, 1, 0, 15, 0), (u_s8, _today - 1, 1, 0, 0, 12, 0), (u_s8, _today - 4, 0, 0, 1, 10, 0),
    (u_s9, _today, 1, 0, 0, 18, 0), (u_s9, _today - 2, 1, 1, 0, 22, 0), (u_s9, _today - 6, 0, 1, 0, 14, 0),
    (u_s10, _today, 1, 0, 0, 10, 0), (u_s10, _today - 1, 0, 1, 0, 8, 0), (u_s10, _today - 3, 1, 0, 1, 12, 0)
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    dpp_count = GREATEST(academic_daily_activity.dpp_count, EXCLUDED.dpp_count),
    homework_count = GREATEST(academic_daily_activity.homework_count, EXCLUDED.homework_count),
    battle_count = GREATEST(academic_daily_activity.battle_count, EXCLUDED.battle_count),
    practice_minutes = GREATEST(academic_daily_activity.practice_minutes, EXCLUDED.practice_minutes),
    self_practice_count = GREATEST(academic_daily_activity.self_practice_count, EXCLUDED.self_practice_count);

  -- ── Timetable grid: Mon-1 style keys (teacher timetable page) ───────────────
  INSERT INTO public.class_timetables (class_id, grid, updated_by) VALUES
    (c10a, jsonb_build_object(
      'Mon-1', 'Mathematics', 'Mon-2', 'Physics', 'Mon-3', 'English', 'Mon-4', 'Hindi', 'Mon-Lunch', '—', 'Mon-5', 'Chemistry', 'Mon-6', 'Games', 'Mon-7', 'Library',
      'Tue-1', 'Physics', 'Tue-2', 'Mathematics', 'Tue-3', 'Social Science', 'Tue-4', 'English', 'Tue-Lunch', '—', 'Tue-5', 'Games', 'Tue-6', 'Computer', 'Tue-7', 'Art',
      'Wed-1', 'Chemistry', 'Wed-2', 'Mathematics', 'Wed-3', 'Physics', 'Wed-4', 'Computer', 'Wed-Lunch', '—', 'Wed-5', 'Library', 'Wed-6', 'English', 'Wed-7', 'Hindi',
      'Thu-1', 'English', 'Thu-2', 'Mathematics', 'Thu-3', 'Physics', 'Thu-4', 'Hindi', 'Thu-Lunch', '—', 'Thu-5', 'Art', 'Thu-6', 'Chemistry', 'Thu-7', 'Social Science',
      'Fri-1', 'Mathematics', 'Fri-2', 'Chemistry', 'Fri-3', 'Physics', 'Fri-4', 'Social Science', 'Fri-Lunch', '—', 'Fri-5', 'Assembly', 'Fri-6', 'English', 'Fri-7', 'Games',
      'Sat-1', 'DPP / Revision', 'Sat-2', 'Sports', 'Sat-3', '—', 'Sat-4', '—', 'Sat-Lunch', '—', 'Sat-5', '—', 'Sat-6', '—', 'Sat-7', '—'
    ), u_t_math)
  ON CONFLICT (class_id) DO UPDATE SET grid = EXCLUDED.grid, updated_by = EXCLUDED.updated_by;

  RAISE NOTICE 'Teacher panel demo enrichment applied for Class 10-A (u_t_math).';
END $demo$;
