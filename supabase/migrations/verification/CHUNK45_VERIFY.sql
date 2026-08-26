-- Chunk 4.5 verification — the doc's four numbered requirements, run live.
-- Everything is rolled back by the final RAISE.
DO $$
DECLARE
  _sch uuid; _ay_cur uuid; _ay_next uuid; _sec uuid; _sec2 uuid; _stu uuid; _stu2 uuid;
  _r1 text; _r2 text; _r3 text; _r4 text;
  _n int; _now text; _prev text;
BEGIN
  SELECT id INTO _sch FROM public.schools LIMIT 1;
  SELECT id INTO _ay_cur FROM public.academic_years WHERE school_id = _sch AND is_current;
  SELECT id INTO _sec FROM public.classes WHERE school_id = _sch LIMIT 1;
  SELECT id INTO _sec2 FROM public.classes WHERE school_id = _sch AND id <> _sec LIMIT 1;

  ------------------------------------------------------------------
  -- 1. The stale column is gone everywhere, including generated types.
  ------------------------------------------------------------------
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'roll_number';
  _r1 := 'students.roll_number columns = ' || _n;

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.prosrc ~ 'public\.students\M[^;]*roll_number';
  _r1 := _r1 || ', SQL functions still reading it = ' || _n
      || CASE WHEN _n = 0 THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 2 & 3. A new academic year: every screen shows the NEW roll, and the
  --        previous year's is still retrievable from history.
  --
  -- This is the failure the convergence exists to prevent. With two copies,
  -- the rollover updated one and left the other reading last year's number
  -- with no error raised.
  ------------------------------------------------------------------
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V Roll Student', 'VER-ROLL-1', _sec, CURRENT_DATE - 200, _ay_cur)
  RETURNING id INTO _stu;

  -- This year: roll 41.
  INSERT INTO public.student_enrolments
    (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
  VALUES (_sch, _stu, _ay_cur, _sec, 'V-41', CURRENT_DATE - 200);

  SELECT roll_number INTO _now FROM public.students_current WHERE id = _stu;
  _prev := _now;

  -- Roll the year over: close this year's enrolment, open next year's with a
  -- different roll, and make the new year current.
  INSERT INTO public.academic_years (school_id, name, starts_on, ends_on, status, is_current)
  VALUES (_sch, 'V-NEXT-YEAR', CURRENT_DATE + 1, CURRENT_DATE + 365, 'active', false)
  RETURNING id INTO _ay_next;

  UPDATE public.student_enrolments SET to_date = CURRENT_DATE
   WHERE student_id = _stu AND to_date IS NULL;

  INSERT INTO public.student_enrolments
    (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
  VALUES (_sch, _stu, _ay_next, _sec, 'V-7', CURRENT_DATE + 1);

  UPDATE public.academic_years SET is_current = false WHERE id = _ay_cur;
  UPDATE public.academic_years SET is_current = true  WHERE id = _ay_next;

  SELECT roll_number INTO _now FROM public.students_current WHERE id = _stu;

  _r2 := 'before rollover the view read ' || COALESCE(_prev,'NULL')
      || ', after rollover it reads ' || COALESCE(_now,'NULL')
      || CASE WHEN _prev = 'V-41' AND _now = 'V-7'
              THEN '  => one source, every reader moved together  PASS'
              ELSE '  FAIL' END;

  SELECT en.roll_number INTO _prev
    FROM public.student_enrolments en
   WHERE en.student_id = _stu AND en.academic_year_id = _ay_cur;
  _r3 := 'previous year''s roll still retrievable from history = ' || COALESCE(_prev,'NULL')
      || CASE WHEN _prev = 'V-41' THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 4. Uniqueness still enforced per section per year.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO public.student_enrolments
      (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
    VALUES (_sch, _stu, _ay_next, _sec, 'V-7', CURRENT_DATE + 2);
    _r4 := 'duplicate roll in the same section+year = ACCEPTED (FAIL)';
  EXCEPTION WHEN unique_violation THEN
    _r4 := 'duplicate roll in the same section+year = REJECTED (PASS)';
  END;

  -- Reuse across sections must be tested with a DIFFERENT student: Chunk 3's
  -- student_enrolments_one_open correctly refuses a second OPEN enrolment for
  -- the same student, which would mask the constraint actually under test.
  IF _sec2 IS NOT NULL THEN
    INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
    VALUES (_sch, 'V Roll Student 2', 'VER-ROLL-2', _sec2, CURRENT_DATE - 200, _ay_next)
    RETURNING id INTO _stu2;
    BEGIN
      INSERT INTO public.student_enrolments
        (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
      VALUES (_sch, _stu2, _ay_next, _sec2, 'V-7', CURRENT_DATE + 2);
      _r4 := _r4 || ' | same roll, DIFFERENT section, different student = ACCEPTED (PASS)';
    EXCEPTION WHEN others THEN
      _r4 := _r4 || ' | different section = REJECTED: ' || SQLERRM || ' (FAIL)';
    END;
  END IF;

  RAISE EXCEPTION E'\n 1) %\n 2) %\n 3) %\n 4) %\n [all rolled back]',
    _r1, _r2, _r3, _r4;
END $$;
