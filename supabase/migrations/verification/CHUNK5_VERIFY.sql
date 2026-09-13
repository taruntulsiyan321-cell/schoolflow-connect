-- =====================================================================
-- CHUNK 5 — verification, as the homework ruling of 2026-09-13 left it.
--
-- Chunk 5 verified eight items. The product owner's homework specification
-- (docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13"; migrations
-- 20260925100000–20260925140000) removed four of them, and this file says so
-- rather than letting them disappear:
--   3.     ABSENT vs NOT_COMPLETED — removed. `homework_completions` and its
--          absent status are gone: every student resolves to submitted or not.
--   4b.    "the 9 historical late rows are preserved" (D1) — removed with
--          `is_late`. Nothing can be late; the rows live in
--          `homework_submissions_pre_20260925110000` until that is dropped.
--   5–7.   AUTO-GRADING, NO KEY, OVERRIDE — removed. There is no digital
--          submission to grade: a hand-in is one image or PDF.
-- What still holds, and is proved below:
--   1+2.   homework whose deadline has not passed is not counted as missed;
--          homework whose deadline has passed resolves every student, once.
--   4.     nothing is handed in at or after the deadline.       (+ positive control)
--   8.     soft delete: hidden from the teacher, restorable by the admin, and
--          purged for good after 7 days by rpc_purge_expired.
--
-- SAFETY: seeds a section, students and homework, proves against them, then
-- RAISEs deliberately so every fixture rolls back.
-- =====================================================================

DO $v$
DECLARE
  _out text := E'\n===== CHUNK 5 VERIFICATION (homework ruling, 2026-09-13) =====\n';
  _ok boolean := true;
  _school uuid; _grp uuid; _section uuid;
  _admin uuid; _teacher_acct uuid; _teacher uuid;
  _s1 uuid; _s2 uuid; _s3 uuid;
  _hw_future uuid; _hw_past uuid; _hw_open uuid; _hw_closed uuid; _hw_del uuid;
  _stu uuid; _stu_user uuid; _stu_class uuid; _stu_school uuid; _file text;
  _n int; _txt text;
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

  -- Everything below is written as the server: nobody signed in.
  PERFORM set_config('request.jwt.claims', '', true);

  -- =================================================================
  -- 1 + 2. NOT YET DUE IS NOT MISSED; PAST THE DEADLINE RESOLVES EVERYONE ONCE
  -- =================================================================
  _out := _out || format('%s1+2. NOT-YET-DUE vs PAST THE DEADLINE%s', E'\n', E'\n');

  INSERT INTO public.homework (school_id, class_id, title, subject, description, closes_at, status)
  VALUES (_school, _section, 'ZZ due tomorrow', 'Mathematics', 'q', now() + interval '1 day', 'published')
  RETURNING id INTO _hw_future;
  INSERT INTO public.homework (school_id, class_id, title, subject, description, closes_at, status)
  VALUES (_school, _section, 'ZZ due yesterday', 'Mathematics', 'q', now() - interval '1 day', 'published')
  RETURNING id INTO _hw_past;

  PERFORM public.resolve_closed_homework();

  SELECT count(*) INTO _n FROM public.homework_submissions WHERE homework_id = _hw_future;
  _out := _out || format('  future homework resolved rows ...... %s   (expected 0 — still open)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;
  SELECT count(*) INTO _n FROM public.homework_student_status WHERE homework_id = _hw_future AND closed;
  _out := _out || format('  future homework counted as closed .. %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.homework_submissions WHERE homework_id = _hw_past AND status = 'not_submitted';
  _out := _out || format('  past homework resolved rows ........ %s   (expected 3 = whole section)%s', _n, E'\n');
  IF _n <> 3 THEN _ok := false; END IF;
  PERFORM public.resolve_closed_homework();
  SELECT count(*) INTO _n FROM public.homework_submissions WHERE homework_id = _hw_past;
  _out := _out || format('  after a second closure run ......... %s   (expected 3 — once only)%s', _n, E'\n');
  IF _n <> 3 THEN _ok := false; END IF;
  SELECT string_agg(DISTINCT closed::text || '/' || given::text, ',') INTO _txt
    FROM public.homework_student_status WHERE homework_id = _hw_past;
  _out := _out || format('  past homework closed/given ......... %s   (expected true/false)%s', _txt, E'\n');
  IF _txt IS DISTINCT FROM 'true/false' THEN _ok := false; END IF;

  -- =================================================================
  -- 4. NOTHING IS HANDED IN AT OR AFTER THE DEADLINE
  -- =================================================================
  _out := _out || format('%s4. AFTER THE DEADLINE%s', E'\n', E'\n');

  -- A signed-in student with exactly one student row, so the RPC resolves them.
  SELECT s.id, s.user_id, s.class_id, s.school_id INTO _stu, _stu_user, _stu_class, _stu_school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL AND s.class_id IS NOT NULL
     AND (SELECT count(*) FROM public.students x WHERE x.user_id = s.user_id AND x.deleted_at IS NULL) = 1
   ORDER BY s.id LIMIT 1;
  IF _stu IS NULL THEN
    _out := _out || format('  FAIL: no signed-in student to hand in as%s', E'\n'); _ok := false;
  ELSE
    INSERT INTO public.homework (school_id, class_id, title, subject, description, closes_at, status)
    VALUES (_stu_school, _stu_class, 'ZZ closed', 'Mathematics', 'q', now() - interval '1 minute', 'published')
    RETURNING id INTO _hw_closed;
    INSERT INTO public.homework (school_id, class_id, title, subject, description, closes_at, status)
    VALUES (_stu_school, _stu_class, 'ZZ open', 'Mathematics', 'q', now() + interval '1 day', 'published')
    RETURNING id INTO _hw_open;
    _file := _stu_user::text || '/zz-c5-hand-in.pdf';
    INSERT INTO storage.objects (bucket_id, name) VALUES ('academic-files', _file);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_homework_submit(_hw_closed, json_build_object('path', _file, 'name', 'w.pdf', 'mime', 'application/pdf')::jsonb);
      _out := _out || format('  handing in after the deadline ...... ACCEPTED   (expected refused)%s', E'\n');
      _ok := false;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      _out := _out || format('  handing in after the deadline ...... refused%s', E'\n');
    END;
    BEGIN
      PERFORM public.rpc_homework_submit(_hw_open, json_build_object('path', _file, 'name', 'w.pdf', 'mime', 'application/pdf')::jsonb);
      _out := _out || format('  handing in before the deadline ..... accepted   (positive control)%s', E'\n');
    EXCEPTION WHEN OTHERS THEN
      _out := _out || format('  handing in before the deadline ..... FAILED: %s%s', SQLERRM, E'\n');
      _ok := false;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;

  -- =================================================================
  -- 8. SOFT DELETE: RESTORABLE FOR 7 DAYS, GONE AFTER
  -- =================================================================
  _out := _out || format('%s8. SOFT DELETE%s', E'\n', E'\n');

  INSERT INTO public.homework (school_id, class_id, title, subject, description, closes_at, status)
  VALUES (_school, _section, 'ZZ to delete', 'Mathematics', 'q', now() - interval '1 day', 'published')
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
  PERFORM set_config('request.jwt.claims', '', true);
  _out := _out || format('  visible to the admin (restorable) .. %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  -- Deleted homework is in nobody's standing.
  SELECT count(*) INTO _n FROM public.homework_student_status WHERE homework_id = _hw_del;
  _out := _out || format('  standing rows for deleted homework . %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  -- Within 7 days the purge leaves it alone.
  PERFORM public.rpc_purge_expired();
  SELECT count(*) INTO _n FROM public.homework WHERE id = _hw_del;
  _out := _out || format('  after purge, still within 7 days ... %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  -- Past 7 days it is gone for good.
  UPDATE public.homework SET deleted_at = now() - interval '8 days' WHERE id = _hw_del;
  PERFORM public.rpc_purge_expired();
  SELECT count(*) INTO _n FROM public.homework WHERE id = _hw_del;
  _out := _out || format('  after purge, past 7 days ........... %s   (expected 0 — permanent)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL REMAINING ITEMS VERIFIED' ELSE 'AT LEAST ONE CHECK FAILED' END, E'\n');
  _out := _out || 'Fixtures rolled back by the deliberate abort below.';
  RAISE EXCEPTION '%', _out;
END;
$v$;
