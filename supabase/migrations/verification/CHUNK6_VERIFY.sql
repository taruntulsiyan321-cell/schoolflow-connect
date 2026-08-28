-- Chunk 6 verification — the doc's eight numbered requirements, run live.
-- Everything is rolled back by the final RAISE.
--
-- G11 discipline applied throughout:
--   * Every impersonation clears request.jwt.claims when it RESETs ROLE.
--     CHUNK4_VERIFY item 7 did not, so it ran as table owner with RLS bypassed
--     while auth.uid() still returned the previous role — proving neither that
--     the action worked nor that policy allowed it.
--   * Each check states what it proves, and item 5 asserts the effective role
--     and auth.uid() inside the test rather than trusting the SET.
--   * "0 rows" is never accepted as a negative on its own; read and write are
--     asserted separately.
DO $$
DECLARE
  _sch uuid; _ay uuid; _secA uuid; _secB uuid;
  _ssA uuid; _ssB uuid; _csA uuid; _grpA uuid;
  _examA uuid; _examB uuid; _esA uuid; _esB uuid; _esA2 uuid;
  _test uuid; _stu1 uuid; _stu2 uuid; _stu3 uuid;
  _admin uuid; _teacher uuid;
  _eff_role text; _eff_uid uuid;
  _avg numeric; _hi int; _lo int; _below int; _unmarked int; _n int;
  _pctA numeric; _pctB numeric;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text; _r8 text;
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
  SELECT id INTO _ay FROM public.academic_years WHERE school_id=_sch AND is_current;
  SELECT id INTO _admin   FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO _teacher FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';

  -- Two sections of one class, each with its own subject, so item 4 can compare
  -- across different max marks.
  SELECT g.id, g.curriculum_class_id INTO _grpA, _csA
    FROM public.class_groups g WHERE g.school_id=_sch AND g.curriculum_class_id IS NOT NULL LIMIT 1;
  SELECT id INTO _csA FROM public.curriculum_subjects WHERE curriculum_class_id=_csA LIMIT 1;

  INSERT INTO public.classes (school_id, name, section, class_group_id)
  VALUES (_sch,'V6','A',_grpA) RETURNING id INTO _secA;
  INSERT INTO public.classes (school_id, name, section, class_group_id)
  VALUES (_sch,'V6','B',_grpA) RETURNING id INTO _secB;

  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  VALUES (_sch,_secA,_csA) RETURNING id INTO _ssA;
  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  VALUES (_sch,_secB,_csA) RETURNING id INTO _ssB;

  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch,'V6 One','VER-6-1',_secA,CURRENT_DATE-30,_ay) RETURNING id INTO _stu1;
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch,'V6 Two','VER-6-2',_secA,CURRENT_DATE-30,_ay) RETURNING id INTO _stu2;
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch,'V6 Three','VER-6-3',_secB,CURRENT_DATE-30,_ay) RETURNING id INTO _stu3;

  -- The teacher must actually TEACH the fixture section, or item 5's read half
  -- fails for the right reason and masks what it is trying to prove. Priya
  -- teaches 10-A/12-A/9-A in the demo data, not this freshly created section.
  INSERT INTO public.teacher_classes (teacher_id, class_id, subject)
  SELECT t.id, _secA, (SELECT name FROM public.curriculum_subjects WHERE id=_csA)
    FROM public.teachers t WHERE t.user_id = _teacher LIMIT 1
  ON CONFLICT DO NOTHING;

  ------------------------------------------------------------------
  -- 1. A test with no marks uploaded: every figure is —, not 0.
  --    PROVES: the model can distinguish "no marks" from "all zero".
  ------------------------------------------------------------------
  INSERT INTO public.tests (school_id, academic_year_id, section_subject_id, created_by, topic, date, max_mark)
  VALUES (_sch,_ay,_ssA,_teacher,'V6 topic',CURRENT_DATE-1,20) RETURNING id INTO _test;

  SELECT avg(mark), max(mark), min(mark), count(*) FILTER (WHERE mark IS NULL)
    INTO _avg, _hi, _lo, _unmarked
    FROM public.test_marks WHERE test_id=_test;

  _r1 := 'no marks uploaded -> avg=' || COALESCE(_avg::text,'—')
      || ' high=' || COALESCE(_hi::text,'—') || ' low=' || COALESCE(_lo::text,'—')
      || CASE WHEN _avg IS NULL AND _hi IS NULL AND _lo IS NULL
              THEN '  => all NULL, renders — not 0  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 2. A NULL mark is excluded from every aggregate, and surfaced.
  --    PROVES: NULL is not coalesced to 0 anywhere in the figures.
  ------------------------------------------------------------------
  INSERT INTO public.test_marks (school_id, test_id, student_id, mark, uploaded_at) VALUES
    (_sch,_test,_stu1,18,now()),
    (_sch,_test,_stu2,NULL,NULL);

  SELECT avg(mark), max(mark), min(mark),
         count(*) FILTER (WHERE mark IS NOT NULL AND mark < 8),
         count(*) FILTER (WHERE mark IS NULL)
    INTO _avg, _hi, _lo, _below, _unmarked
    FROM public.test_marks WHERE test_id=_test;

  _r2 := 'avg=' || round(_avg,1) || ' (18 alone, NOT 9 = 18+0/2), high=' || _hi
      || ' low=' || _lo || ' below-pass=' || _below
      || ', surfaced as "' || _unmarked || ' student not marked"'
      || CASE WHEN _avg = 18 AND _lo = 18 AND _unmarked = 1
              THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 3. Pass/fail uses the exam's OWN pass_mark, never a literal 40.
  --    PROVES: a 20-mark exam with pass 8 classifies against 8.
  ------------------------------------------------------------------
  INSERT INTO public.exams (school_id, academic_year_id, name, exam_type, class_id, subject,
                            max_marks, passing_marks, exam_date, created_by, status)
  VALUES (_sch,_ay,'V6 Exam A','unit_test',_secA,
          (SELECT name FROM public.curriculum_subjects WHERE id=_csA),
          20, 8, CURRENT_DATE-1, _teacher, 'completed')
  RETURNING id INTO _examA;

  INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id)
  VALUES (_sch,_examA,_ssA) RETURNING id INTO _esA;

  INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained) VALUES
    (_sch,_examA,_esA,_stu1,9),    -- above 8, below 40
    (_sch,_examA,_esA,_stu2,7);    -- below 8

  SELECT count(*) FILTER (WHERE m.marks_obtained < e.passing_marks) INTO _below
    FROM public.marks m JOIN public.exams e ON e.id=m.exam_id
   WHERE m.exam_id=_examA AND m.marks_obtained IS NOT NULL;

  _r3 := 'on a 20-mark exam with pass_mark 8: below-pass=' || _below
      || ' (marks 9 and 7). A literal-40 threshold would have said 2.'
      || CASE WHEN _below = 1 THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 4. Cross-section comparison is percentages, because max marks differ.
  --    PROVES: raw marks are not comparable across sections.
  ------------------------------------------------------------------
  INSERT INTO public.exams (school_id, academic_year_id, name, exam_type, class_id, subject,
                            max_marks, passing_marks, exam_date, created_by, status)
  VALUES (_sch,_ay,'V6 Exam B','unit_test',_secB,
          (SELECT name FROM public.curriculum_subjects WHERE id=_csA),
          50, 20, CURRENT_DATE-1, _teacher, 'completed')
  RETURNING id INTO _examB;

  INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id)
  VALUES (_sch,_examB,_ssB) RETURNING id INTO _esB;

  INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
  VALUES (_sch,_examB,_esB,_stu3,30);

  SELECT round(100.0*avg(m.marks_obtained)/e.max_marks,1) INTO _pctA
    FROM public.marks m JOIN public.exams e ON e.id=m.exam_id
   WHERE m.exam_id=_examA AND m.marks_obtained IS NOT NULL GROUP BY e.max_marks;
  SELECT round(100.0*avg(m.marks_obtained)/e.max_marks,1) INTO _pctB
    FROM public.marks m JOIN public.exams e ON e.id=m.exam_id
   WHERE m.exam_id=_examB AND m.marks_obtained IS NOT NULL GROUP BY e.max_marks;

  _r4 := 'section A avg 8/20 = ' || _pctA || '%, section B avg 30/50 = ' || _pctB || '%'
      || ' — raw 8 vs 30 would rank B higher; as percentages B is '
      || CASE WHEN _pctB > _pctA THEN 'still higher' ELSE 'lower' END
      || CASE WHEN _pctA = 40.0 AND _pctB = 60.0 THEN '  PASS' ELSE '  FAIL' END;

  ------------------------------------------------------------------
  -- 5. Marks after submission: teacher rejected, admin allowed.
  --    PROVES BOTH HALVES, and asserts the effective role/uid so a
  --    silent RLS bypass cannot masquerade as a pass (G11).
  ------------------------------------------------------------------
  UPDATE public.exams SET marks_locked = true WHERE id = _examA;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_teacher,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT current_user, auth.uid() INTO _eff_role, _eff_uid;
  -- Both halves: "0 rows updated" is indistinguishable from "cannot see the
  -- rows at all", and the second would mean the teacher lost their own class.
  SELECT count(*) INTO _below FROM public.marks WHERE exam_subject_id = _esA;
  BEGIN
    UPDATE public.marks SET marks_obtained = 20 WHERE exam_subject_id = _esA;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _r5 := 'as ' || _eff_role || '/uid=' || COALESCE(_eff_uid::text,'null')
        || ': teacher READS ' || _below || ' mark row(s), edit after lock changed ' || _n
        || CASE WHEN _below > 0 AND _n = 0 THEN ' => reads intact, write refused (PASS)'
                WHEN _below = 0 THEN ' => teacher cannot even READ the marks (FAIL)'
                ELSE ' => teacher edited after lock (FAIL)' END;
  EXCEPTION WHEN others THEN
    _r5 := 'as ' || _eff_role || ': teacher READS ' || _below
        || ' mark row(s); edit after lock REJECTED by policy (PASS)';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);   -- the line CHUNK4 missed

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_admin,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT current_user, auth.uid() INTO _eff_role, _eff_uid;
  UPDATE public.marks SET marks_obtained = 11 WHERE exam_subject_id = _esA AND student_id = _stu1;
  GET DIAGNOSTICS _n = ROW_COUNT;
  _r5 := _r5 || ' | as ' || _eff_role || '/uid=' || COALESCE(_eff_uid::text,'null')
      || ': admin edit changed ' || _n || ' row(s)'
      || CASE WHEN _n = 1 AND _eff_role = 'authenticated' AND _eff_uid = _admin
              THEN ' (PASS)' ELSE ' (FAIL)' END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  ------------------------------------------------------------------
  -- 6 & 7. Report card: never partial, generated when complete.
  --        PROVES the invariant is structural, not a convention.
  ------------------------------------------------------------------
  INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id)
  VALUES (_sch,_examA,_ssB) RETURNING id INTO _esA2;   -- exam A now has 2 subjects

  BEGIN
    INSERT INTO public.report_cards (school_id, exam_id, student_id)
    VALUES (_sch,_examA,_stu1);
    _r6 := 'report card with 1 of 2 subjects marked = GENERATED (FAIL)';
  EXCEPTION WHEN others THEN
    _r6 := 'report card with 1 of 2 subjects marked = REFUSED (PASS): ' || left(SQLERRM,64);
  END;

  INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
  VALUES (_sch,_examA,_esA2,_stu1,15);

  BEGIN
    INSERT INTO public.report_cards (school_id, exam_id, student_id)
    VALUES (_sch,_examA,_stu1);
    _r7 := 'all subjects marked = GENERATED (PASS)';
  EXCEPTION WHEN others THEN
    _r7 := 'all subjects marked = REFUSED (FAIL): ' || left(SQLERRM,64);
  END;

  ------------------------------------------------------------------
  -- 8. Rank is within the section only, and is not stored (G5).
  --    PROVES no column anywhere holds a rank.
  ------------------------------------------------------------------
  -- G11, assert the guarantee not a snapshot: the rule is that EXAM RANK is
  -- never stored (G5), not that no column anywhere may be called "rank".
  -- battle_participants.rank is a battle's finishing position — a recorded
  -- outcome, not a derived academic aggregate. An earlier version of this
  -- check counted it and failed a correct schema, which is exactly the
  -- pressure that gets a good test weakened.
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('exams','exam_subjects','marks','report_cards','tests','test_marks')
     AND (column_name ~ 'rank' OR column_name IN ('position','percentile'));
  _r8 := 'stored rank/position columns on the exam + marks + report-card tables = ' || _n
      || CASE WHEN _n = 0 THEN ' (PASS — rank is computed on read, never stored)' ELSE ' (FAIL)' END;

  _r8 := _r8 || ' | rank within section A: '
      || COALESCE((SELECT string_agg(s.full_name || '=' || r.rk, ', ' ORDER BY r.rk)
            FROM (SELECT m.student_id, rank() OVER (ORDER BY m.marks_obtained DESC) AS rk
                    FROM public.marks m
                   WHERE m.exam_subject_id = _esA AND m.marks_obtained IS NOT NULL) r
            JOIN public.students s ON s.id = r.student_id), 'none');

  RAISE EXCEPTION E'\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n 8) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7, _r8;
END $$;
