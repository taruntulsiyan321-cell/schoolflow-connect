-- =====================================================================
-- CHUNK 4.7 — verification of the four new Chunk 4 items.
--
--   7. Admin edits a day from three months ago — allowed, no window. Records
--      old value, new value, who, when.
--   8. That day carries an edited marker, detail resolving from the edit record.
--   9. A teacher attempts to edit their own submission — rejected by policy.
--  10. attendance_locks does not exist anywhere: no table, no view, no policy,
--      no code reference.
--
-- SAFETY: seeds a section, a student and a three-month-old submission, proves
-- against them, then RAISEs deliberately so everything rolls back.
-- =====================================================================

DO $v$
DECLARE
  _out text := E'\n===== CHUNK 4.7 VERIFICATION =====\n';
  _ok boolean := true;
  _school uuid; _grp uuid; _section uuid; _student uuid;
  _teacher uuid; _teacher_acct uuid; _admin uuid;
  _old_date date := current_date - 92;
  _sub uuid; _att uuid;
  _n int; _txt text;
  _prev text; _new text; _by uuid; _at timestamptz;
BEGIN
  SELECT id INTO _school FROM public.schools ORDER BY created_at LIMIT 1;
  SELECT id INTO _admin  FROM public.profiles WHERE email = 'admin@wisdomcampus.com';
  SELECT id INTO _teacher_acct FROM public.profiles WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO _teacher FROM public.teachers WHERE user_id = _teacher_acct AND school_id = _school;

  -- A section this teacher is class teacher of, with one student.
  INSERT INTO public.class_groups (school_id, label)
  VALUES (_school, 'ZZ 4.7 Class') RETURNING id INTO _grp;
  INSERT INTO public.classes (school_id, name, section, class_group_id, kind, is_active)
  VALUES (_school, 'ZZ 4.7 Class', 'A', _grp, 'class', true) RETURNING id INTO _section;
  UPDATE public.teachers SET class_teacher_of = _section WHERE id = _teacher;

  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date)
  VALUES (_school, 'ZZ 4.7 Student', 'ZZ47-001', _section, _old_date - 10)
  RETURNING id INTO _student;

  -- A submission from three months ago, marked present.
  INSERT INTO public.attendance_submissions (school_id, section_id, date, submitted_by, submitted_at)
  VALUES (_school, _section, _old_date, _teacher_acct, (_old_date::timestamptz + interval '9 hours'))
  RETURNING id INTO _sub;

  INSERT INTO public.attendance (student_id, status, school_id, marked_by, submission_id)
  VALUES (_student, 'present', _school, _teacher_acct, _sub)
  RETURNING id INTO _att;

  -- =================================================================
  -- 10. THE LOCK IS GONE EVERYWHERE
  -- =================================================================
  _out := _out || format('%s10. attendance_locks REMOVED%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname LIKE '%attendance_lock%';
  _out := _out || format('  relations named attendance_lock* .... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname = 'public'
     AND (tablename LIKE '%attendance_lock%'
       OR (coalesce(qual,'')||' '||coalesce(with_check,'')) ILIKE '%attendance_lock%');
  _out := _out || format('  policies referencing the lock ...... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*), string_agg(p.proname, ', ') INTO _n, _txt
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosrc ILIKE '%attendance_lock%';
  _out := _out || format('  functions referencing the lock ..... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; _out := _out || format('    %s%s', _txt, E'\n'); END IF;

  SELECT count(*), string_agg(p.proname, ', ') INTO _n, _txt
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname LIKE '%attendance%'
     AND p.prosrc ~* '(24 hour|24h|edit_window)';
  _out := _out || format('  edit-window logic remaining ........ %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; _out := _out || format('    %s%s', _txt, E'\n'); END IF;

  -- =================================================================
  -- 9. THE TEACHER CANNOT EDIT THEIR OWN SUBMISSION
  -- =================================================================
  _out := _out || format('%s9. TEACHER EDITS OWN SUBMISSION%s', E'\n', E'\n');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher_acct, 'role', 'authenticated',
                      'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;

  -- Through the write path.
  BEGIN
    PERFORM public.rpc_bulk_upsert_attendance(
      jsonb_build_array(jsonb_build_object(
        'student_id', _student, 'class_id', _section,
        'date', _old_date, 'status', 'absent')));
    _out := _out || format('  via rpc_bulk_upsert_attendance ..... ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  via rpc_bulk_upsert_attendance ..... rejected%s', E'\n');
  END;

  -- And directly, by policy: the teacher's write policy is INSERT-only now.
  BEGIN
    UPDATE public.attendance SET status = 'absent' WHERE id = _att;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n > 0 THEN
      _out := _out || format('  direct UPDATE by teacher ........... %s row(s)   (expected 0)%s', _n, E'\n');
      _ok := false;
    ELSE
      _out := _out || format('  direct UPDATE by teacher ........... 0 rows — rejected by policy%s', E'\n');
    END IF;
  EXCEPTION WHEN others THEN
    _out := _out || format('  direct UPDATE by teacher ........... rejected by policy%s', E'\n');
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- =================================================================
  -- 7. ADMIN EDITS A THREE-MONTH-OLD DAY, NO WINDOW
  -- =================================================================
  _out := _out || format('%s7. ADMIN EDITS A DAY FROM THREE MONTHS AGO (%s)%s', E'\n', _old_date, E'\n');

  SELECT count(*) INTO _n FROM public.attendance_audit WHERE submission_id = _sub;
  _out := _out || format('  edit records before ................ %s%s', _n, E'\n');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated',
                      'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.rpc_bulk_upsert_attendance(
      jsonb_build_array(jsonb_build_object(
        'student_id', _student, 'class_id', _section,
        'date', _old_date, 'status', 'absent')));
    _out := _out || format('  admin edit 92 days later ........... allowed%s', E'\n');
  EXCEPTION WHEN others THEN
    _out := _out || format('  admin edit 92 days later ........... REJECTED (%s)   (expected allowed)%s',
                           SQLERRM, E'\n');
    _ok := false;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT prev_status, new_status, edited_by, edited_at
    INTO _prev, _new, _by, _at
    FROM public.attendance_audit
   WHERE submission_id = _sub
   ORDER BY edited_at DESC LIMIT 1;

  _out := _out || format('  old value recorded ................. %s%s', COALESCE(_prev,'(none)'), E'\n');
  _out := _out || format('  new value recorded ................. %s%s', COALESCE(_new,'(none)'), E'\n');
  _out := _out || format('  who ................................ %s%s',
                         CASE WHEN _by = _admin THEN 'the admin' ELSE COALESCE(_by::text,'(none)') END, E'\n');
  _out := _out || format('  when ............................... %s%s', COALESCE(_at::text,'(none)'), E'\n');
  IF _prev IS DISTINCT FROM 'present' OR _new IS DISTINCT FROM 'absent'
     OR _by IS DISTINCT FROM _admin OR _at IS NULL THEN
    _ok := false;
  END IF;

  -- =================================================================
  -- 8. THAT DAY NOW CARRIES AN EDITED MARKER
  -- =================================================================
  _out := _out || format('%s8. THE EDITED MARKER%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM public.attendance_day_edits
   WHERE submission_id = _sub;
  _out := _out || format('  day appears in the marker view ..... %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  SELECT edit_count, students_changed INTO _n, _n
    FROM public.attendance_day_edits WHERE submission_id = _sub;
  SELECT edit_count INTO _n FROM public.attendance_day_edits WHERE submission_id = _sub;
  _out := _out || format('  changes on that day ................ %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  -- A day that was never edited must NOT carry the marker.
  SELECT count(*) INTO _n
    FROM public.attendance_submissions s
    LEFT JOIN public.attendance_day_edits e ON e.submission_id = s.id
   WHERE s.id <> _sub AND e.submission_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.attendance_audit a WHERE a.submission_id = s.id);
  _out := _out || format('  unedited days wrongly marked ....... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  -- The marker must be readable by the principal, who reads the figure.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM public.profiles WHERE email='principal@wisdomcampus.com'),
                      'role','authenticated','session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.attendance_day_edits;
  _out := _out || format('  principal can read the marker ...... %s row(s) visible%s', _n, E'\n');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL FOUR VERIFIED' ELSE 'AT LEAST ONE CHECK FAILED' END, E'\n');
  _out := _out || 'Fixtures rolled back by the deliberate abort below.';
  RAISE EXCEPTION '%', _out;
END;
$v$;
