-- Enrich demo academic signals for teacher reports and student insights.
-- Safe to re-run. Focuses on Class 10-A demo accounts.

DO $demo$
DECLARE
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
  exam1 uuid := 'd8000001-0001-4000-8000-000000000001';
  exam2 uuid := 'd8000001-0002-4000-8000-000000000002';
  exam3 uuid := 'de500001-0001-4000-8000-000000000001';
  hw1 uuid := 'd6000001-0001-4000-8000-000000000001';
  dpp_pub uuid := 'd5000001-0001-4000-8000-000000000001';
  dpp_q1 uuid := 'd5000002-0001-4000-8000-000000000001';
  dpp_q2 uuid := 'd5000002-0002-4000-8000-000000000002';
  b_done uuid := 'd4000001-0003-4000-8000-000000000003';
  bq_done1 uuid := 'd4000003-0001-4000-8000-000000000001';
  bq_done2 uuid := 'd4000003-0002-4000-8000-000000000002';
  _today date := CURRENT_DATE;
BEGIN
  INSERT INTO public.exams (id, name, exam_type, class_id, subject, max_marks, exam_date, created_by) VALUES
    (exam3, 'Concept Check — Polynomials & Electricity', 'unit_test', c10a, 'Academic Readiness', 40, _today - 3, u_t_math)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, exam_date = EXCLUDED.exam_date, max_marks = EXCLUDED.max_marks;

  INSERT INTO public.marks (exam_id, student_id, marks_obtained, remarks) VALUES
    (exam1, st6, 15, 'Good algebraic reasoning'),
    (exam1, st7, 19, 'Excellent accuracy'),
    (exam1, st8, 10, 'Needs guided practice'),
    (exam1, st9, 13, 'Improving proof structure'),
    (exam1, st10, 11, 'Revise basics before next test'),
    (exam2, st6, 37, 'Steady progress'),
    (exam2, st7, 46, 'Top physics performance'),
    (exam2, st8, 29, 'Circuit concepts need support'),
    (exam2, st9, 34, 'Better than last attempt'),
    (exam2, st10, 25, 'Recovery recommended'),
    (exam3, st1, 35, 'Ready for higher-order questions'),
    (exam3, st2, 30, 'Good, but check careless errors'),
    (exam3, st3, 33, 'Strong improvement'),
    (exam3, st4, 37, 'Excellent'),
    (exam3, st5, 27, 'Needs practice consistency'),
    (exam3, st6, 31, 'Stable'),
    (exam3, st7, 38, 'Outstanding'),
    (exam3, st8, 22, 'Needs concept recovery'),
    (exam3, st9, 29, 'Improving'),
    (exam3, st10, 20, 'Intervention needed')
  ON CONFLICT (exam_id, student_id) DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, remarks = EXCLUDED.remarks;

  INSERT INTO public.attendance (student_id, class_id, date, status, marked_by) VALUES
    (st1, c10a, _today - 3, 'present', u_t_math), (st2, c10a, _today - 3, 'present', u_t_math), (st3, c10a, _today - 3, 'present', u_t_math), (st4, c10a, _today - 3, 'present', u_t_math), (st5, c10a, _today - 3, 'absent', u_t_math),
    (st6, c10a, _today - 3, 'present', u_t_math), (st7, c10a, _today - 3, 'present', u_t_math), (st8, c10a, _today - 3, 'absent', u_t_math), (st9, c10a, _today - 3, 'present', u_t_math), (st10, c10a, _today - 3, 'leave', u_t_math),
    (st1, c10a, _today - 4, 'present', u_t_math), (st2, c10a, _today - 4, 'present', u_t_math), (st3, c10a, _today - 4, 'leave', u_t_math), (st4, c10a, _today - 4, 'present', u_t_math), (st5, c10a, _today - 4, 'present', u_t_math),
    (st6, c10a, _today - 4, 'present', u_t_math), (st7, c10a, _today - 4, 'present', u_t_math), (st8, c10a, _today - 4, 'present', u_t_math), (st9, c10a, _today - 4, 'present', u_t_math), (st10, c10a, _today - 4, 'absent', u_t_math)
  ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by;

  INSERT INTO public.homework_submissions (homework_id, student_id, content, status, grade, teacher_remarks, submitted_at, graded_at) VALUES
    (hw1, st3, 'Uploaded full Euclid lemma worksheet.', 'graded', 'A-', 'Good reasoning; improve notation.', now() - interval '20 hours', now() - interval '18 hours'),
    (hw1, st4, 'Completed with extra examples.', 'graded', 'A+', 'Excellent independent examples.', now() - interval '18 hours', now() - interval '16 hours'),
    (hw1, st5, 'Submitted partial solution.', 'submitted', NULL, NULL, now() - interval '4 hours', NULL),
    (hw1, st6, 'Completed Q1-Q5 with corrections.', 'graded', 'B+', 'Good recovery after correction.', now() - interval '15 hours', now() - interval '12 hours'),
    (hw1, st7, 'Completed and added challenge problem.', 'graded', 'A+', 'Excellent extension thinking.', now() - interval '12 hours', now() - interval '10 hours'),
    (hw1, st8, 'Submitted, unsure about Q4.', 'submitted', NULL, NULL, now() - interval '3 hours', NULL),
    (hw1, st9, 'Completed after class discussion.', 'graded', 'B', 'Visible improvement.', now() - interval '9 hours', now() - interval '8 hours'),
    (hw1, st10, 'Need help with division lemma.', 'submitted', NULL, NULL, now() - interval '2 hours', NULL)
  ON CONFLICT (homework_id, student_id) DO UPDATE SET
    content = EXCLUDED.content,
    status = EXCLUDED.status,
    grade = EXCLUDED.grade,
    teacher_remarks = EXCLUDED.teacher_remarks,
    submitted_at = EXCLUDED.submitted_at,
    graded_at = EXCLUDED.graded_at;

  INSERT INTO public.dpp_attempts (
    id, dpp_id, user_id, student_id, started_at, submitted_at,
    score, max_score, correct_count, total_count, time_spent_sec, status
  ) VALUES
    ('de500002-0001-4000-8000-000000000001', dpp_pub, u_s2, st2, now() - interval '2 days', now() - interval '2 days' + interval '11 minutes', 1, 2, 1, 2, 660, 'submitted'),
    ('de500002-0002-4000-8000-000000000002', dpp_pub, u_s3, st3, now() - interval '2 days', now() - interval '2 days' + interval '8 minutes', 2, 2, 2, 2, 480, 'submitted'),
    ('de500002-0003-4000-8000-000000000003', dpp_pub, u_s4, st4, now() - interval '2 days', now() - interval '2 days' + interval '7 minutes', 2, 2, 2, 2, 420, 'submitted'),
    ('de500002-0004-4000-8000-000000000004', dpp_pub, u_s5, st5, now() - interval '2 days', now() - interval '2 days' + interval '15 minutes', 1, 2, 1, 2, 900, 'submitted'),
    ('de500002-0005-4000-8000-000000000005', dpp_pub, u_s6, st6, now() - interval '2 days', now() - interval '2 days' + interval '10 minutes', 1, 2, 1, 2, 600, 'submitted'),
    ('de500002-0006-4000-8000-000000000006', dpp_pub, u_s7, st7, now() - interval '2 days', now() - interval '2 days' + interval '6 minutes', 2, 2, 2, 2, 360, 'submitted'),
    ('de500002-0007-4000-8000-000000000007', dpp_pub, u_s8, st8, now() - interval '2 days', now() - interval '2 days' + interval '14 minutes', 0, 2, 0, 2, 840, 'submitted'),
    ('de500002-0008-4000-8000-000000000008', dpp_pub, u_s9, st9, now() - interval '2 days', now() - interval '2 days' + interval '9 minutes', 1, 2, 1, 2, 540, 'submitted'),
    ('de500002-0009-4000-8000-000000000009', dpp_pub, u_s10, st10, now() - interval '2 days', now() - interval '2 days' + interval '16 minutes', 0, 2, 0, 2, 960, 'submitted')
  ON CONFLICT (dpp_id, user_id) DO UPDATE SET
    status = EXCLUDED.status,
    score = EXCLUDED.score,
    correct_count = EXCLUDED.correct_count,
    total_count = EXCLUDED.total_count,
    submitted_at = EXCLUDED.submitted_at,
    time_spent_sec = EXCLUDED.time_spent_sec;

  INSERT INTO public.dpp_answers (attempt_id, question_id, response, is_correct, marks_awarded, time_ms) VALUES
    ('de500002-0001-4000-8000-000000000001', dpp_q1, '{"indexes":[0]}'::jsonb, true, 1, 290000),
    ('de500002-0001-4000-8000-000000000001', dpp_q2, '{"indexes":[1]}'::jsonb, false, 0, 330000),
    ('de500002-0007-4000-8000-000000000007', dpp_q1, '{"indexes":[2]}'::jsonb, false, 0, 410000),
    ('de500002-0007-4000-8000-000000000007', dpp_q2, '{"indexes":[3]}'::jsonb, false, 0, 420000),
    ('de500002-0009-4000-8000-000000000009', dpp_q1, '{"indexes":[1]}'::jsonb, false, 0, 460000),
    ('de500002-0009-4000-8000-000000000009', dpp_q2, '{"indexes":[2]}'::jsonb, false, 0, 500000)
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET response = EXCLUDED.response, is_correct = EXCLUDED.is_correct, marks_awarded = EXCLUDED.marks_awarded, time_ms = EXCLUDED.time_ms;

  INSERT INTO public.concept_mastery (
    id, user_id, student_id, class_level, subject, chapter, concept, subconcept,
    mastery_score, total_attempts, correct_attempts, recovery_attempts, recovery_correct,
    mistake_count, last_attempt_at
  ) VALUES
    ('de500003-0001-4000-8000-000000000001', u_s1, st1, 10, 'Mathematics', 'Real Numbers', 'Euclid Division Lemma', 'Remainder reasoning', 92, 18, 16, 2, 2, 2, now() - interval '3 hours'),
    ('de500003-0002-4000-8000-000000000002', u_s1, st1, 10, 'Mathematics', 'Polynomials', 'Zeroes of polynomial', 'Graph roots', 86, 14, 12, 1, 1, 2, now() - interval '1 day'),
    ('de500003-0003-4000-8000-000000000003', u_s2, st2, 10, 'Mathematics', 'Quadratic Equations', 'Discriminant', 'Equal roots', 68, 12, 8, 2, 1, 4, now() - interval '4 hours'),
    ('de500003-0004-4000-8000-000000000004', u_s3, st3, 10, 'Physics', 'Electricity', 'Series Circuit', 'Current flow', 81, 16, 13, 2, 2, 3, now() - interval '2 hours'),
    ('de500003-0005-4000-8000-000000000005', u_s4, st4, 10, 'Mathematics', 'Triangles', 'Similarity Criteria', 'AA similarity', 94, 20, 19, 1, 1, 1, now() - interval '5 hours'),
    ('de500003-0006-4000-8000-000000000006', u_s5, st5, 10, 'Mathematics', 'Triangles', 'Similarity Criteria', 'SAS similarity', 57, 11, 6, 2, 1, 5, now() - interval '8 hours'),
    ('de500003-0007-4000-8000-000000000007', u_s6, st6, 10, 'Mathematics', 'Polynomials', 'Zeroes of polynomial', 'Graph roots', 74, 13, 10, 2, 2, 3, now() - interval '6 hours'),
    ('de500003-0008-4000-8000-000000000008', u_s7, st7, 10, 'Physics', 'Electricity', 'Series and parallel circuits', 'Current flow', 96, 21, 20, 1, 1, 1, now() - interval '1 hour'),
    ('de500003-0009-4000-8000-000000000009', u_s8, st8, 10, 'Physics', 'Electricity', 'Series and parallel circuits', 'Equivalent resistance', 38, 10, 3, 3, 1, 7, now() - interval '2 hours'),
    ('de500003-0010-4000-8000-000000000010', u_s9, st9, 10, 'Mathematics', 'Triangles', 'Similarity Criteria', 'AA vs SAS decision', 63, 12, 8, 3, 2, 4, now() - interval '4 hours'),
    ('de500003-0011-4000-8000-000000000011', u_s10, st10, 10, 'Biology', 'Life Processes', 'Transportation in plants', 'Transpiration pull', 32, 9, 3, 4, 1, 8, now() - interval '3 hours')
  ON CONFLICT (id) DO UPDATE SET
    mastery_score = EXCLUDED.mastery_score,
    total_attempts = EXCLUDED.total_attempts,
    correct_attempts = EXCLUDED.correct_attempts,
    recovery_attempts = EXCLUDED.recovery_attempts,
    recovery_correct = EXCLUDED.recovery_correct,
    mistake_count = EXCLUDED.mistake_count,
    last_attempt_at = EXCLUDED.last_attempt_at;

  INSERT INTO public.recovery_assignments (
    id, user_id, student_id, subject, chapter, concept, subconcept, severity,
    status, question_count, questions_completed, questions_correct, source_type, created_at, completed_at
  ) VALUES
    ('de500004-0001-4000-8000-000000000001', u_s2, st2, 'Mathematics', 'Quadratic Equations', 'Discriminant', 'Equal roots', 'moderate', 'in_progress', 8, 4, 3, 'dpp', now() - interval '2 days', NULL),
    ('de500004-0002-4000-8000-000000000002', u_s5, st5, 'Mathematics', 'Triangles', 'Similarity Criteria', 'SAS similarity', 'moderate', 'pending', 10, 0, 0, 'exam', now() - interval '1 day', NULL),
    ('de500004-0003-4000-8000-000000000003', u_s8, st8, 'Physics', 'Electricity', 'Series and parallel circuits', 'Equivalent resistance', 'severe', 'in_progress', 12, 5, 2, 'dpp', now() - interval '18 hours', NULL),
    ('de500004-0004-4000-8000-000000000004', u_s10, st10, 'Biology', 'Life Processes', 'Transportation in plants', 'Transpiration pull', 'severe', 'pending', 12, 0, 0, 'doubt', now() - interval '5 hours', NULL),
    ('de500004-0005-4000-8000-000000000005', u_s3, st3, 'Physics', 'Electricity', 'Series Circuit', 'Current flow', 'minor', 'completed', 6, 6, 5, 'battle', now() - interval '4 days', now() - interval '1 day'),
    ('de500004-0006-4000-8000-000000000006', u_s6, st6, 'Mathematics', 'Polynomials', 'Zeroes of polynomial', 'Graph roots', 'minor', 'completed', 6, 6, 6, 'dpp', now() - interval '3 days', now() - interval '8 hours')
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    questions_completed = EXCLUDED.questions_completed,
    questions_correct = EXCLUDED.questions_correct,
    completed_at = EXCLUDED.completed_at;

  INSERT INTO public.battle_participants (
    id, battle_id, user_id, student_id, display_name,
    joined_at, finished_at, score, correct_count, answered_count, total_time_ms, rank
  ) VALUES
    ('de500005-0001-4000-8000-000000000001', b_done, u_s4, st4, 'Ananya Verma', now() - interval '2 days', now() - interval '2 days' + interval '82 seconds', 20, 2, 2, 41000, 1),
    ('de500005-0002-4000-8000-000000000002', b_done, u_s7, st7, 'Ishaan Gupta', now() - interval '2 days', now() - interval '2 days' + interval '88 seconds', 20, 2, 2, 43000, 2),
    ('de500005-0003-4000-8000-000000000003', b_done, u_s6, st6, 'Kavya Nair', now() - interval '2 days', now() - interval '2 days' + interval '112 seconds', 10, 1, 2, 69000, 5),
    ('de500005-0004-4000-8000-000000000004', b_done, u_s8, st8, 'Meera Rao', now() - interval '2 days', now() - interval '2 days' + interval '130 seconds', 0, 0, 2, 82000, 8),
    ('de500005-0005-4000-8000-000000000005', b_done, u_s10, st10, 'Nisha Das', now() - interval '2 days', now() - interval '2 days' + interval '140 seconds', 0, 0, 2, 91000, 9)
  ON CONFLICT (battle_id, user_id) DO UPDATE SET
    score = EXCLUDED.score,
    correct_count = EXCLUDED.correct_count,
    answered_count = EXCLUDED.answered_count,
    total_time_ms = EXCLUDED.total_time_ms,
    rank = EXCLUDED.rank,
    finished_at = EXCLUDED.finished_at;

  INSERT INTO public.battle_answers (participant_id, question_id, selected_index, is_correct, time_ms) VALUES
    ('de500005-0001-4000-8000-000000000001', bq_done1, 0, true, 19000),
    ('de500005-0001-4000-8000-000000000001', bq_done2, 0, true, 22000),
    ('de500005-0004-4000-8000-000000000004', bq_done1, 2, false, 40000),
    ('de500005-0004-4000-8000-000000000004', bq_done2, 1, false, 42000),
    ('de500005-0005-4000-8000-000000000005', bq_done1, 3, false, 45000),
    ('de500005-0005-4000-8000-000000000005', bq_done2, 2, false, 46000)
  ON CONFLICT (participant_id, question_id) DO UPDATE SET selected_index = EXCLUDED.selected_index, is_correct = EXCLUDED.is_correct, time_ms = EXCLUDED.time_ms;

  INSERT INTO public.student_xp (user_id, xp, level, current_streak, longest_streak, total_battles, wins, equipped_badge, last_battle_at) VALUES
    (u_s1, 540, 6, 7, 11, 14, 7, 'first_win', now() - interval '2 hours'),
    (u_s2, 280, 3, 3, 5, 7, 2, 'first_dpp', now() - interval '1 day'),
    (u_s3, 690, 7, 9, 14, 16, 9, 'sharp_shooter', now() - interval '1 hour'),
    (u_s4, 760, 8, 10, 15, 18, 11, 'dpp_perfect', now() - interval '2 hours'),
    (u_s5, 240, 3, 2, 6, 6, 1, NULL, now() - interval '3 days'),
    (u_s6, 430, 5, 6, 8, 9, 4, 'first_dpp', now() - interval '8 hours'),
    (u_s7, 820, 8, 12, 16, 20, 13, 'sharp_shooter', now() - interval '1 hour'),
    (u_s8, 170, 2, 1, 4, 5, 1, NULL, now() - interval '4 days'),
    (u_s9, 510, 5, 7, 9, 11, 5, 'first_win', now() - interval '6 hours'),
    (u_s10, 150, 2, 1, 3, 4, 1, NULL, now() - interval '5 days')
  ON CONFLICT (user_id) DO UPDATE SET
    xp = EXCLUDED.xp,
    level = EXCLUDED.level,
    current_streak = EXCLUDED.current_streak,
    longest_streak = EXCLUDED.longest_streak,
    total_battles = EXCLUDED.total_battles,
    wins = EXCLUDED.wins,
    equipped_badge = EXCLUDED.equipped_badge,
    last_battle_at = EXCLUDED.last_battle_at;

  INSERT INTO public.notifications (user_id, type, title, body, icon, link, read) VALUES
    (u_t_math, 'insight', 'Academic report is ready', 'Class 10-A now has rich mastery, recovery, homework and battle signals for review.', 'chart', '/teacher/reports', false),
    (u_t_math, 'insight', 'Early warning: Nisha and Meera', 'Two students need recovery attention before the next concept check.', 'alert', '/teacher/performance', false),
    (u_s8, 'recovery', 'Recovery session assigned', 'Electricity: Equivalent resistance needs focused practice.', 'target', '/student/recovery', false),
    (u_s10, 'recovery', 'Teacher assigned recovery', 'Biology: Transpiration pull needs revision today.', 'target', '/student/recovery', false)
  ON CONFLICT DO NOTHING;
END $demo$;
