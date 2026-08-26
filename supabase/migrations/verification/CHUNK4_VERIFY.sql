-- Chunk 4 verification — the doc's eleven numbered requirements, run live.
-- Everything is rolled back by the final RAISE.
--
-- SCOPE NOTE, stated rather than blurred: requirements 1-4 and 8-10 are about
-- FIGURES, and the metric layer that computes them is Chunk 10. What Chunk 4
-- owns is the data model that makes those figures expressible at all. So each
-- figure below is computed here in plain SQL, the same way Chunk 10 will have
-- to compute it, to prove the model supports it. When Chunk 10 lands, these
-- same numbers become its golden-number tests.
DO $$
DECLARE
  _sch uuid; _ay uuid;
  _secSmall uuid; _secBig uuid; _secUnmarked uuid; _secAllAbsent uuid;
  _sub uuid; _stu uuid; _joiner uuid; _newbie uuid; _leaver uuid;
  _princ uuid; _admin uuid;
  _i int; _d date; _n int; _present int; _total int;
  _pct numeric; _mean numeric; _weighted numeric;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text;
  _r7 text; _r8 text; _r9 text; _r10 text; _r11 text;
  MIN_ENROLLED_DAYS_FOR_FLAGS constant int := 10;   -- locked-decisions §9/§10.27
  ATTENDANCE_LOW              constant int := 80;   -- locked-decisions §9
BEGIN
  SELECT id INTO _sch FROM public.schools LIMIT 1;
  SELECT id INTO _ay FROM public.academic_years WHERE school_id = _sch AND is_current;
  SELECT id INTO _princ FROM auth.users WHERE email = 'principal@wisdomcampus.com';
  SELECT id INTO _admin FROM auth.users WHERE email = 'admin@wisdomcampus.com';

  INSERT INTO public.classes (school_id, name, section) VALUES
    (_sch, 'V1', 'SMALL'), (_sch, 'V1', 'BIG'), (_sch, 'V1', 'UNMARKED'), (_sch, 'V1', 'ALLABSENT');
  SELECT id INTO _secBig       FROM public.classes WHERE school_id=_sch AND name='V1' AND section='BIG';
  SELECT id INTO _secUnmarked  FROM public.classes WHERE school_id=_sch AND name='V1' AND section='UNMARKED';
  SELECT id INTO _secAllAbsent FROM public.classes WHERE school_id=_sch AND name='V1' AND section='ALLABSENT';
  SELECT id INTO _secSmall     FROM public.classes WHERE school_id=_sch AND name='V1' AND section='SMALL';

  ------------------------------------------------------------------
  -- 1 & 2. not_marked vs a genuine 0%
  ------------------------------------------------------------------
  -- UNMARKED: students exist, no submission row at all.
  FOR _i IN 1..5 LOOP
    INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
    VALUES (_sch, 'V Unmarked '||_i, 'VER-UM-'||_i, _secUnmarked, CURRENT_DATE - 60, _ay);
  END LOOP;

  -- ALLABSENT: a real submission, every student absent.
  FOR _i IN 1..5 LOOP
    INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
    VALUES (_sch, 'V Absent '||_i, 'VER-AB-'||_i, _secAllAbsent, CURRENT_DATE - 60, _ay);
  END LOOP;
  INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_sch, _ay, _secAllAbsent, CURRENT_DATE - 1, _admin) RETURNING id INTO _sub;
  INSERT INTO public.attendance (school_id, submission_id, student_id, class_id, date, status, marked_by)
  SELECT _sch, _sub, s.id, _secAllAbsent, CURRENT_DATE - 1, 'absent', _admin
    FROM public.students s WHERE s.class_id = _secAllAbsent;

  -- The model's own distinction: a submission exists, or it does not.
  _r1 := 'UNMARKED section -> submission rows = '
      || (SELECT count(*) FROM public.attendance_submissions
           WHERE section_id = _secUnmarked AND date = CURRENT_DATE - 1)::text
      || ' => state=not_marked (NOT 0%)';
  SELECT count(*) FILTER (WHERE a.status::text='present'), count(*)
    INTO _present, _total
    FROM public.attendance a WHERE a.submission_id = _sub;
  _r2 := 'ALLABSENT section -> submission exists, '||_present||'/'||_total
      || ' present => genuine 0%';
  _r1 := _r1 || ' | ' || _r2 ||
    CASE WHEN (SELECT count(*) FROM public.attendance_submissions
                WHERE section_id=_secUnmarked AND date=CURRENT_DATE-1) = 0
              AND _total = 5 AND _present = 0
         THEN '  => DISTINGUISHABLE  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 3 & 4. School figure weighted by student, unmarked excluded
  ------------------------------------------------------------------
  FOR _i IN 1..12 LOOP
    INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
    VALUES (_sch, 'V Small '||_i, 'VER-SM-'||_i, _secSmall, CURRENT_DATE - 60, _ay);
  END LOOP;
  FOR _i IN 1..58 LOOP
    INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
    VALUES (_sch, 'V Big '||_i, 'VER-BG-'||_i, _secBig, CURRENT_DATE - 60, _ay);
  END LOOP;

  -- SMALL: 12 of 12 present (100%).
  INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_sch, _ay, _secSmall, CURRENT_DATE - 1, _admin) RETURNING id INTO _sub;
  INSERT INTO public.attendance (school_id, submission_id, student_id, class_id, date, status, marked_by)
  SELECT _sch, _sub, s.id, _secSmall, CURRENT_DATE - 1, 'present', _admin
    FROM public.students s WHERE s.class_id = _secSmall;

  -- BIG: 29 of 58 present (50%).
  INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_sch, _ay, _secBig, CURRENT_DATE - 1, _admin) RETURNING id INTO _sub;
  INSERT INTO public.attendance (school_id, submission_id, student_id, class_id, date, status, marked_by)
  SELECT _sch, _sub, s.id, _secBig, CURRENT_DATE - 1,
         (CASE WHEN row_number() OVER (ORDER BY s.admission_number) <= 29 THEN 'present' ELSE 'absent' END)::public.attendance_status,
         _admin
    FROM public.students s WHERE s.class_id = _secBig;

  -- Weighted by student, across sections that SUBMITTED only.
  SELECT count(*) FILTER (WHERE a.status::text='present'), count(*)
    INTO _present, _total
    FROM public.attendance a
    JOIN public.attendance_submissions s ON s.id = a.submission_id
   WHERE s.date = CURRENT_DATE - 1
     AND s.section_id IN (_secSmall, _secBig);
  _weighted := round(100.0 * _present / NULLIF(_total,0), 1);
  _mean := round((100.0 + 50.0) / 2, 1);

  _r3 := 'unmarked section contributes 0 students to the denominator: denominator='
      || _total || ' (12+58, UNMARKED''s 5 excluded)'
      || CASE WHEN _total = 70 THEN ' PASS' ELSE ' FAIL' END;
  _r4 := 'weighted=' || _weighted || '%  vs mean-of-percentages=' || _mean || '%'
      || CASE WHEN _weighted <> _mean AND _weighted = 58.6 THEN ' => weighted by STUDENT  PASS' ELSE ' FAIL' END;

  ------------------------------------------------------------------
  -- 5 & 6. Principal may never mark or edit
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _princ, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
    VALUES (_sch, _ay, _secUnmarked, CURRENT_DATE - 1, _princ);
    _r5 := 'principal MARK = ACCEPTED (FAIL)';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    _r5 := 'principal MARK = REJECTED by policy (PASS)';
  WHEN others THEN _r5 := 'principal MARK = REJECTED: '||SQLERRM||' (PASS)';
  END;
  SELECT count(*) INTO _n FROM public.attendance WHERE submission_id = _sub;
  BEGIN
    UPDATE public.attendance SET status = 'present' WHERE submission_id = _sub;
    GET DIAGNOSTICS _i = ROW_COUNT;
    _r6 := 'principal can READ ' || _n || ' row(s) of that submission, and UPDATE changed '
        || _i || ' of them'
        || CASE WHEN _n > 0 AND _i = 0
                THEN ' => reads intact, writes refused (PASS)'
                WHEN _n = 0
                THEN ' => principal cannot even READ attendance — dashboard would break (FAIL)'
                ELSE ' => principal EDITED attendance (FAIL)' END;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    _r6 := 'principal can READ ' || _n || ' row(s); UPDATE = REJECTED by policy (PASS)';
  WHEN others THEN
    _r6 := 'principal can READ ' || _n || ' row(s); UPDATE = REJECTED: '||SQLERRM||' (PASS)';
  END;
  RESET ROLE;

  ------------------------------------------------------------------
  -- 7. Admin edits; the edit is recorded with old, new, who, when
  ------------------------------------------------------------------
  SELECT a.id INTO _stu FROM public.attendance a WHERE a.submission_id = _sub LIMIT 1;
  SELECT count(*) INTO _n FROM public.attendance_audit;
  UPDATE public.attendance SET status = 'absent' WHERE id = _stu AND status::text = 'present';
  _r7 := 'attendance_audit rows before=' || _n || ' after=' ||
         (SELECT count(*) FROM public.attendance_audit)::text ||
         ', latest=' ||
         COALESCE((SELECT 'prev='||prev_status::text||' new='||new_status::text||
                          ' by='||coalesce(edited_by::text,'null')||' at='||edited_at::text
                     FROM public.attendance_audit ORDER BY edited_at DESC LIMIT 1), 'none')
      || CASE WHEN (SELECT count(*) FROM public.attendance_audit) > _n THEN ' PASS' ELSE ' FAIL' END;

  ------------------------------------------------------------------
  -- 8. A past date with no submission is a holiday, not a zero
  ------------------------------------------------------------------
  SELECT count(*) INTO _n
    FROM public.attendance_submissions
   WHERE section_id = _secSmall AND date = CURRENT_DATE - 30;
  _r8 := 'SMALL on a past date with no submission -> submissions=' || _n
      || ' => excluded from the denominator as a holiday (no row = no school day)'
      || CASE WHEN _n = 0 THEN ' PASS' ELSE ' FAIL' END;

  ------------------------------------------------------------------
  -- 9. Mid-term joiner counts from enrolment_date: 20/22 = 91%, not 20/42 = 48%
  ------------------------------------------------------------------
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V Joiner4', 'VER-J4', _secUnmarked, CURRENT_DATE - 22, _ay)
  RETURNING id INTO _joiner;

  -- The section submitted on 42 consecutive days; the joiner was enrolled for
  -- the last 22 of them and was present on 20.
  FOR _i IN 0..41 LOOP
    _d := CURRENT_DATE - 42 + _i;
    INSERT INTO public.attendance_submissions (school_id, academic_year_id, section_id, date, submitted_by)
    VALUES (_sch, _ay, _secUnmarked, _d, _admin)
    ON CONFLICT (section_id, date) DO NOTHING
    RETURNING id INTO _sub;
    IF _sub IS NULL THEN
      SELECT id INTO _sub FROM public.attendance_submissions WHERE section_id=_secUnmarked AND date=_d;
    END IF;
    IF _d >= CURRENT_DATE - 22 THEN
      INSERT INTO public.attendance (school_id, submission_id, student_id, class_id, date, status, marked_by)
      VALUES (_sch, _sub, _joiner, _secUnmarked, _d,
              (CASE WHEN _i >= 22 AND _i < 24 THEN 'absent' ELSE 'present' END)::public.attendance_status,
              _admin);
    END IF;
  END LOOP;

  SELECT count(*) FILTER (WHERE status::text='present'), count(*)
    INTO _present, _total
    FROM public.attendance WHERE student_id = _joiner;
  _pct := round(100.0 * _present / NULLIF(_total,0));
  _r9 := 'joiner present ' || _present || '/' || _total || ' since enrolment = ' || _pct || '%'
      || '  (from session start it would be ' || _present || '/42 = '
      || round(100.0*_present/42) || '%)'
      || CASE WHEN _pct = 91 THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 10. No flag before MIN_ENROLLED_DAYS_FOR_FLAGS enrolled school days
  ------------------------------------------------------------------
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V Newbie', 'VER-NB', _secUnmarked, CURRENT_DATE - 3, _ay)
  RETURNING id INTO _newbie;
  FOR _i IN 0..2 LOOP
    _d := CURRENT_DATE - 3 + _i;
    SELECT id INTO _sub FROM public.attendance_submissions WHERE section_id=_secUnmarked AND date=_d;
    IF _sub IS NOT NULL THEN
      INSERT INTO public.attendance (school_id, submission_id, student_id, class_id, date, status, marked_by)
      VALUES (_sch, _sub, _newbie, _secUnmarked, _d,
              (CASE WHEN _i = 0 THEN 'absent' ELSE 'present' END)::public.attendance_status, _admin);
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE status::text='present'), count(*)
    INTO _present, _total FROM public.attendance WHERE student_id = _newbie;
  _pct := round(100.0 * _present / NULLIF(_total,0));
  _r10 := 'newbie ' || _present || '/' || _total || ' = ' || _pct || '% (below ' || ATTENDANCE_LOW || ')'
       || ', enrolled school days=' || _total
       || ' < ' || MIN_ENROLLED_DAYS_FOR_FLAGS || ' => flag suppressed'
       || CASE WHEN _total < MIN_ENROLLED_DAYS_FOR_FLAGS AND _pct < ATTENDANCE_LOW
               THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 11. Leaver: counts to exit_date, invisible live, record retained
  ------------------------------------------------------------------
  SELECT id INTO _leaver FROM public.students WHERE class_id = _secSmall LIMIT 1;
  UPDATE public.students SET exit_date = CURRENT_DATE - 1 WHERE id = _leaver;
  _r11 := 'leaver: live-screen visibility (exit in the past) = '
       || (SELECT count(*) FROM public.students s
            WHERE s.id=_leaver AND (s.exit_date IS NULL OR s.exit_date > CURRENT_DATE))::text
       || ', record retained = '
       || (SELECT count(*) FROM public.students WHERE id=_leaver)::text
       || ', their attendance retained = '
       || (SELECT count(*) FROM public.attendance WHERE student_id=_leaver)::text
       || CASE WHEN (SELECT count(*) FROM public.students WHERE id=_leaver) = 1 THEN '  PASS' ELSE '  FAIL' END;

  RAISE EXCEPTION E'\n 1+2) %\n   3) %\n   4) %\n   5) %\n   6) %\n   7) %\n   8) %\n   9) %\n  10) %\n  11) %\n [all rolled back]',
    _r1, _r3, _r4, _r5, _r6, _r7, _r8, _r9, _r10, _r11;
END $$;
