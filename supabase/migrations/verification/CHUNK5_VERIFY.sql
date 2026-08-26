-- =====================================================================
-- CHUNK 5 — verification, all eight items.
--
-- SAFETY: seeds a section, students, homework and questions, proves against
-- them, then RAISEs deliberately so every fixture rolls back.
-- =====================================================================

DO $v$
DECLARE
  _out text := E'\n===== CHUNK 5 VERIFICATION =====\n';
  _ok boolean := true;
  _school uuid; _grp uuid; _section uuid;
  _admin uuid; _teacher_acct uuid; _teacher uuid;
  _s1 uuid; _s2 uuid; _s3 uuid;
  _hw_future uuid; _hw_past uuid; _hw_digital uuid; _hw_del uuid;
  _q_key uuid; _q_nokey uuid;
  _sub uuid; _asub uuid;
  _ans uuid;
  _n int; _txt text; _b boolean; _due date;
  _rate numeric;
BEGIN
  SELECT id INTO _school FROM public.schools ORDER BY created_at LIMIT 1;
  SELECT id INTO _admin        FROM public.profiles WHERE email = 'admin@wisdomcampus.com';
  SELECT id INTO _teacher_acct FROM public.profiles WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO _teacher      FROM public.teachers WHERE user_id = _teacher_acct AND school_id = _school;

  INSERT INTO public.class_groups (school_id, label) VALUES (_school, 'ZZ C5 Class')
  RETURNING id INTO _grp;
  INSERT INTO public.classes (school_id, name, section, class_group_id, kind, is_active)
  VALUES (_school, 'ZZ C5 Class', 'A', _grp, 'class', true) RETURNING id INTO _section;
  UPDATE public.teachers SET class_teacher_of = _section WHERE id = _teacher;
  INSERT INTO public.teacher_classes (teacher_id, class_id, subject, school_id)
  VALUES (_teacher, _section, 'Mathematics', _school);

  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date)
  VALUES (_school,'ZZ C5 One','ZZC5-1',_section, current_date - 60) RETURNING id INTO _s1;
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date)
  VALUES (_school,'ZZ C5 Two','ZZC5-2',_section, current_date - 60) RETURNING id INTO _s2;
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date)
  VALUES (_school,'ZZ C5 Three','ZZC5-3',_section, current_date - 60) RETURNING id INTO _s3;

  -- FINDING: question_bank.correct_index is NOT NULL and 0 of 21,696 rows lack
  -- a key, so "if a stored correct answer exists" can never be false for a bank
  -- question. The branch that actually occurs is a FREE-RESPONSE answer: the
  -- key exists but cannot be applied to prose, so it stays ungraded until the
  -- teacher acts. That is what item 6 exercises.
  SELECT id INTO _q_key   FROM public.question_bank WHERE correct_index IS NOT NULL LIMIT 1;
  SELECT id INTO _q_nokey FROM public.question_bank WHERE correct_index IS NOT NULL OFFSET 1 LIMIT 1;

  -- =================================================================
  -- 1 + 2. NOT YET DUE IS EXCLUDED; DUE YESTERDAY IS INCLUDED
  -- =================================================================
  _out := _out || format('%s1+2. NOT-YET-DUE vs PAST-DUE%s', E'\n', E'\n');

  INSERT INTO public.homework (school_id, class_id, title, subject, due_date, created_by, status)
  VALUES (_school, _section, 'ZZ due tomorrow', 'Mathematics', current_date + 1, _teacher_acct, 'published')
  RETURNING id INTO _hw_future;

  INSERT INTO public.homework (school_id, class_id, title, subject, due_date, created_by, status)
  VALUES (_school, _section, 'ZZ due yesterday', 'Mathematics', current_date - 1, _teacher_acct, 'published')
  RETURNING id INTO _hw_past;

  -- Nobody has closed the future one, so it has no completions rows at all.
  SELECT count(*) INTO _n FROM public.homework_completions WHERE homework_id = _hw_future;
  _out := _out || format('  future homework completion rows .... %s   (expected 0 = not_yet_due)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  -- Close the past one: that generates the report.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role','authenticated','session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_close_homework(_hw_past, false);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT count(*) INTO _n FROM public.homework_completions WHERE homework_id = _hw_past;
  _out := _out || format('  past homework completion rows ...... %s   (expected 3 = whole section)%s', _n, E'\n');
  IF _n <> 3 THEN _ok := false; END IF;

  -- The rate counts only homework whose due date has passed.
  SELECT round(100.0 * count(*) FILTER (WHERE hc.status = 'completed') / NULLIF(count(*),0), 1)
    INTO _rate
    FROM public.homework_completions hc
    JOIN public.homework h ON h.id = hc.homework_id
   WHERE h.school_id = _school AND h.due_date < current_date
     AND h.due_date >= current_date - 7
     AND h.id IN (_hw_future, _hw_past);
  _out := _out || format('  7-day completion rate .............. %s%%   (future homework contributes nothing)%s',
                         COALESCE(_rate::text,'—'), E'\n');
  IF EXISTS (SELECT 1 FROM public.homework_completions WHERE homework_id = _hw_future) THEN
    _out := _out || format('  FAIL: future homework produced completions%s', E'\n'); _ok := false;
  END IF;

  -- =================================================================
  -- 3. ABSENT IS COUNTED SEPARATELY FROM NOT-COMPLETED
  -- =================================================================
  _out := _out || format('%s3. ABSENT vs NOT_COMPLETED%s', E'\n', E'\n');

  _due := current_date - 2;
  INSERT INTO public.homework (school_id, class_id, title, subject, due_date, created_by, status)
  VALUES (_school, _section, 'ZZ absence case', 'Mathematics', _due, _teacher_acct, 'published')
  RETURNING id INTO _hw_digital;

  -- s1 submits; s2 was absent that day; s3 simply did not do it.
  INSERT INTO public.homework_submissions (school_id, homework_id, student_id, submitted_at, status)
  VALUES (_school, _hw_digital, _s1, (_due)::timestamptz, 'submitted');

  INSERT INTO public.attendance_submissions (school_id, section_id, date, submitted_by)
  VALUES (_school, _section, _due, _teacher_acct) RETURNING id INTO _asub;
  INSERT INTO public.attendance (student_id, status, school_id, marked_by, submission_id)
  VALUES (_s1,'present',_school,_teacher_acct,_asub),
         (_s2,'absent', _school,_teacher_acct,_asub),
         (_s3,'present',_school,_teacher_acct,_asub);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role','authenticated','session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_close_homework(_hw_digital, false);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT string_agg(hc.status::text || '=' || cnt, ', ' ORDER BY hc.status::text) INTO _txt
    FROM (SELECT status, count(*) cnt FROM public.homework_completions
           WHERE homework_id = _hw_digital GROUP BY status) hc;
  _out := _out || format('  statuses ........................... %s%s', _txt, E'\n');
  _out := _out || format('  (expected absent=1, completed=1, not_completed=1 — three distinct facts)%s', E'\n');

  SELECT count(*) INTO _n FROM public.homework_completions
   WHERE homework_id = _hw_digital AND status = 'absent' AND student_id = _s2;
  IF _n <> 1 THEN _ok := false; END IF;
  SELECT count(*) INTO _n FROM public.homework_completions
   WHERE homework_id = _hw_digital AND status = 'not_completed' AND student_id = _s3;
  IF _n <> 1 THEN _ok := false; END IF;

  -- =================================================================
  -- 4. SUBMISSION AFTER THE DUE DATE IS REJECTED
  -- =================================================================
  _out := _out || format('%s4. LATE SUBMISSION%s', E'\n', E'\n');

  BEGIN
    INSERT INTO public.homework_submissions (school_id, homework_id, student_id, submitted_at, status)
    VALUES (_school, _hw_past, _s2, now(), 'submitted');
    _out := _out || format('  submitting after due_date .......... ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  submitting after due_date .......... rejected%s', E'\n');
  END;

  SELECT count(*) INTO _n FROM public.homework_submissions WHERE is_late;
  _out := _out || format('  historical late rows preserved ..... %s   (D1: kept, not rewritten)%s', _n, E'\n');
  IF _n <> 9 THEN _ok := false; END IF;

  -- =================================================================
  -- 5 + 6 + 7. AUTO-GRADING, NO KEY, AND OVERRIDE
  -- =================================================================
  _out := _out || format('%s5+6+7. GRADING%s', E'\n', E'\n');

  INSERT INTO public.homework_questions (school_id, homework_id, question_id, sequence)
  VALUES (_school, _hw_digital, _q_key, 1), (_school, _hw_digital, _q_nokey, 2);

  -- 5. With a key: graded on submission, no teacher involved.
  INSERT INTO public.homework_answers (school_id, homework_id, student_id, question_id, answer)
  VALUES (_school, _hw_digital, _s1, _q_key,
          (SELECT correct_index::text FROM public.question_bank WHERE id = _q_key))
  RETURNING id INTO _ans;

  SELECT is_correct INTO _b FROM public.homework_answers WHERE id = _ans;
  _out := _out || format('  correct answer, with key ........... is_correct=%s   (expected t, auto)%s',
                         COALESCE(_b::text,'NULL'), E'\n');
  IF _b IS DISTINCT FROM true THEN _ok := false; END IF;

  INSERT INTO public.homework_answers (school_id, homework_id, student_id, question_id, answer)
  VALUES (_school, _hw_digital, _s2, _q_key, '999');
  SELECT is_correct INTO _b FROM public.homework_answers
   WHERE homework_id = _hw_digital AND student_id = _s2 AND question_id = _q_key;
  _out := _out || format('  wrong answer, with key ............. is_correct=%s   (expected f)%s',
                         COALESCE(_b::text,'NULL'), E'\n');
  IF _b IS DISTINCT FROM false THEN _ok := false; END IF;

  -- 6. Nothing gradeable: stays unmarked. NULL, never false.
  INSERT INTO public.homework_answers (school_id, homework_id, student_id, question_id, answer)
  VALUES (_school, _hw_digital, _s1, _q_nokey, 'a written response')
  RETURNING id INTO _ans;
  SELECT is_correct INTO _b FROM public.homework_answers WHERE id = _ans;
  _out := _out || format('  free-response answer ............... is_correct=%s   (expected NULL, not false)%s',
                         COALESCE(_b::text,'NULL'), E'\n');
  IF _b IS NOT NULL THEN _ok := false; END IF;

  -- And an unanswered question is equally not-wrong.
  INSERT INTO public.homework_answers (school_id, homework_id, student_id, question_id, answer)
  VALUES (_school, _hw_digital, _s3, _q_key, NULL);
  SELECT is_correct INTO _b FROM public.homework_answers
   WHERE homework_id = _hw_digital AND student_id = _s3 AND question_id = _q_key;
  _out := _out || format('  unanswered ......................... is_correct=%s   (expected NULL — G4)%s',
                         COALESCE(_b::text,'NULL'), E'\n');
  IF _b IS NOT NULL THEN _ok := false; END IF;

  -- 7. Teacher overrides the auto-grade; the override is recorded.
  UPDATE public.homework_answers
     SET is_correct = true, graded_by = _teacher_acct
   WHERE homework_id = _hw_digital AND student_id = _s2 AND question_id = _q_key;

  SELECT is_correct, graded_by INTO _b, _ans
    FROM public.homework_answers
   WHERE homework_id = _hw_digital AND student_id = _s2 AND question_id = _q_key;
  _out := _out || format('  after teacher override ............. is_correct=%s graded_by=%s%s',
                         COALESCE(_b::text,'NULL'),
                         CASE WHEN _ans = _teacher_acct THEN 'the teacher' ELSE COALESCE(_ans::text,'NULL') END,
                         E'\n');
  IF _b IS DISTINCT FROM true OR _ans IS DISTINCT FROM _teacher_acct THEN _ok := false; END IF;
  _out := _out || format('  (the override survives the autograde trigger rather than being overwritten)%s', E'\n');

  -- =================================================================
  -- 8. SOFT DELETE: RESTORABLE FOR 7 DAYS, GONE AFTER
  -- =================================================================
  _out := _out || format('%s8. SOFT DELETE%s', E'\n', E'\n');

  INSERT INTO public.homework (school_id, class_id, title, subject, due_date, created_by, status)
  VALUES (_school, _section, 'ZZ to delete', 'Mathematics', current_date - 1, _teacher_acct, 'published')
  RETURNING id INTO _hw_del;

  UPDATE public.homework SET deleted_at = now(), deleted_by = _admin WHERE id = _hw_del;

  -- The teacher must not see it; the admin must, in order to restore it.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher_acct, 'role','authenticated','session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.homework WHERE id = _hw_del;
  RESET ROLE;
  _out := _out || format('  visible to the teacher ............. %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role','authenticated','session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.homework WHERE id = _hw_del;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  _out := _out || format('  visible to the admin (restorable) .. %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  -- Within 7 days the purge leaves it alone.
  SELECT public.rpc_purge_deleted_homework() INTO _n;
  SELECT count(*) INTO _n FROM public.homework WHERE id = _hw_del;
  _out := _out || format('  after purge, still within 7 days ... %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  -- Past 7 days it is gone for good.
  UPDATE public.homework SET deleted_at = now() - interval '8 days' WHERE id = _hw_del;
  PERFORM public.rpc_purge_deleted_homework();
  SELECT count(*) INTO _n FROM public.homework WHERE id = _hw_del;
  _out := _out || format('  after purge, past 7 days ........... %s   (expected 0 — permanent)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL EIGHT VERIFIED' ELSE 'AT LEAST ONE CHECK FAILED' END, E'\n');
  _out := _out || 'Fixtures rolled back by the deliberate abort below.';
  RAISE EXCEPTION '%', _out;
END;
$v$;
