-- Chunk 4.6 verification — the three stale sources are gone, the guarantees
-- they carried are not. Everything is rolled back by the final RAISE.
DO $$
DECLARE
  _sch uuid; _ay uuid; _secA uuid; _secB uuid;
  _subA uuid; _subB uuid; _stu uuid; _admin uuid; _teacher uuid;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text;
  _n int;
BEGIN
  -- The fixture must live in the school whose accounts this test authenticates
  -- as. "FROM public.schools LIMIT 1" was UNORDERED: it worked only while there
  -- was exactly one school, and began picking arbitrarily once Chunk 6.7 added a
  -- second institution for the scale fixture. The test then reported "the
  -- principal cannot read attendance" when the truth was that the rows belonged
  -- to another school. Derive it from the account the test actually uses, so no
  -- number of additional institutions can break it (G11: assert the guarantee).
  SELECT m.school_id INTO _sch
    FROM public.memberships m JOIN auth.users u ON u.id = m.account_id
   WHERE u.email = 'admin@wisdomcampus.com' AND m.status = 'active' LIMIT 1;
  IF _sch IS NULL THEN
    RAISE EXCEPTION 'verification fixture: admin@wisdomcampus.com has no active membership, so there is no school to build the fixture in';
  END IF;
  SELECT id INTO _ay FROM public.academic_years WHERE school_id = _sch AND is_current;
  SELECT id INTO _admin FROM auth.users WHERE email = 'admin@wisdomcampus.com';
  SELECT id INTO _teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';

  ------------------------------------------------------------------
  -- 1. All three stale copies are gone from the schema.
  ------------------------------------------------------------------
  -- attendance_locks was deleted outright by Chunk 4.7, so only attendance is
  -- checked for stale copies here; the lock's total absence is item 5.
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'attendance' AND column_name IN ('class_id','date');
  _r1 := 'stale columns remaining on attendance = ' || _n
      || CASE WHEN _n = 0 THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 2. Both views inherit RLS rather than bypassing it.
  ------------------------------------------------------------------
  SELECT count(*) INTO _n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'v'
     AND coalesce(c.reloptions::text, '') NOT LIKE '%security_invoker=true%';
  _r2 := 'views MISSING security_invoker = ' || _n
      || CASE WHEN _n = 0 THEN '  PASS' ELSE '  FAIL (a view without it is a hole around the table''s RLS)' END;

  ------------------------------------------------------------------
  -- 3. The view reproduces section and date faithfully for every row.
  ------------------------------------------------------------------
  SELECT count(*) INTO _n
    FROM public.attendance_current v
    JOIN public.attendance_submissions s ON s.id = v.submission_id
   WHERE v.class_id IS DISTINCT FROM s.section_id OR v.date IS DISTINCT FROM s.date;
  _r3 := 'rows where the view disagrees with the submission = ' || _n
      || ', total rows through the view = ' || (SELECT count(*) FROM public.attendance_current)::text
      || CASE WHEN _n = 0 THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 4. One attendance row per student per day is still enforced, even
  --    though the constraint that used to guarantee it is gone.
  ------------------------------------------------------------------
  INSERT INTO public.classes (school_id, name, section) VALUES (_sch, 'V46', 'A')
  RETURNING id INTO _secA;
  INSERT INTO public.classes (school_id, name, section) VALUES (_sch, 'V46', 'B')
  RETURNING id INTO _secB;

  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V46 Student', 'VER-46-1', _secA, CURRENT_DATE - 30, _ay)
  RETURNING id INTO _stu;

  INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_sch, _ay, _secA, CURRENT_DATE - 3, _admin) RETURNING id INTO _subA;
  INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_sch, _ay, _secB, CURRENT_DATE - 3, _admin) RETURNING id INTO _subB;

  INSERT INTO public.attendance (school_id, submission_id, student_id, status, marked_by)
  VALUES (_sch, _subA, _stu, 'present', _admin);

  -- Same student, same date, a DIFFERENT section's submission. UNIQUE
  -- (student_id, submission_id) would allow this; the guarantee the old
  -- UNIQUE (student_id, date) carried must still refuse it.
  BEGIN
    UPDATE public.students SET class_id = _secB WHERE id = _stu;  -- satisfy the section guard
    INSERT INTO public.attendance (school_id, submission_id, student_id, status, marked_by)
    VALUES (_sch, _subB, _stu, 'absent', _admin);
    _r4 := 'second row for the same student on the same date = ACCEPTED (FAIL)';
  EXCEPTION WHEN others THEN
    _r4 := 'second row for the same student on the same date = REJECTED (PASS): '
        || left(SQLERRM, 70);
  END;

  ------------------------------------------------------------------
  -- 5. The lock hangs off the submission and still blocks a write.
  ------------------------------------------------------------------
  -- Chunk 4.7 deleted the lock entirely: no table, no view, nothing to lock.
  -- What this item proves now is that the lock is genuinely gone rather than
  -- merely unused, and that its replacement -- the edited-day marker -- exists.
  SELECT count(*) INTO _n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname LIKE '%attendance_lock%';
  _r5 := 'attendance_lock* relations remaining = ' || _n
      || CASE WHEN _n = 0 THEN '  PASS' ELSE '  FAIL' END;

  _r5 := _r5 || ' | edited-day marker present: '
      || CASE WHEN EXISTS (SELECT 1 FROM pg_class c
                             JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'public' AND c.relname = 'attendance_day_edits')
              THEN 'yes (attendance_day_edits)' ELSE 'NO (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. A teacher still reads their own class's attendance after the
  --    policies were rewritten to resolve the section via the submission.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.attendance_current;
  RESET ROLE;
  _r6 := 'rows a class teacher can read through the view = ' || _n
      || CASE WHEN _n > 0 THEN '  PASS (policy rewrite preserved the grant)'
              ELSE '  FAIL — the rewrite cost the teacher their own class' END;

  RAISE EXCEPTION E'\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6;
END $$;
