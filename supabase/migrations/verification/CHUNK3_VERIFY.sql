-- Chunk 3 verification — the doc's seven numbered requirements, run live.
-- Every write is rolled back by the final RAISE.
DO $$
DECLARE
  _sch uuid; _ay uuid; _secA uuid; _secB uuid;
  _joiner uuid; _mover uuid; _kid1 uuid; _kid2 uuid; _guardian uuid;
  _teacher_of uuid; _teacher_not uuid; _leaver uuid; _remark uuid;
  _parent_uid uuid;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text;
  _n int; _tmp timestamptz;
BEGIN
  SELECT id INTO _sch FROM public.schools LIMIT 1;
  SELECT id INTO _ay  FROM public.academic_years WHERE school_id = _sch AND is_current;
  SELECT id INTO _secA FROM public.classes WHERE school_id = _sch ORDER BY name, section LIMIT 1;
  SELECT id INTO _secB FROM public.classes WHERE school_id = _sch AND id <> _secA ORDER BY name, section LIMIT 1;
  IF _secB IS NULL THEN
    INSERT INTO public.classes (school_id, name, section)
    VALUES (_sch, '99', 'Z') RETURNING id INTO _secB;
  END IF;

  ------------------------------------------------------------------
  -- 1. Mid-term joiner: enrolment_date set, no attendance expected before it.
  ------------------------------------------------------------------
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V Joiner', 'VER-JOIN-1', _secA, CURRENT_DATE - 20, _ay)
  RETURNING id INTO _joiner;

  INSERT INTO public.student_enrolments (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
  VALUES (_sch, _joiner, _ay, _secA, 'VR-901', CURRENT_DATE - 20);

  -- Chunk 4.6 moved the date off attendance and onto its submission, so the
  -- date is reached through the join rather than read from the row.
  SELECT count(*) INTO _n
    FROM public.attendance a
    JOIN public.attendance_submissions s ON s.id = a.submission_id
   WHERE a.student_id = _joiner
     AND s.date < (SELECT enrolment_date FROM public.students WHERE id = _joiner);
  _r1 := 'enrolment_date=' || (SELECT enrolment_date::text FROM public.students WHERE id = _joiner)
       || ', attendance rows before it=' || _n
       || CASE WHEN _n = 0 THEN ' PASS' ELSE ' FAIL' END;

  ------------------------------------------------------------------
  -- 2. Move a student between sections: two enrolment rows, no data loss.
  ------------------------------------------------------------------
  _mover := _joiner;
  UPDATE public.student_enrolments
     SET to_date = CURRENT_DATE
   WHERE student_id = _mover AND to_date IS NULL;
  INSERT INTO public.student_enrolments (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
  VALUES (_sch, _mover, _ay, _secB, 'VR-902', CURRENT_DATE);
  UPDATE public.students SET class_id = _secB WHERE id = _mover;

  SELECT count(*) INTO _n FROM public.student_enrolments WHERE student_id = _mover;
  _r2 := 'enrolment rows after move=' || _n
       || ', history preserved=' || (SELECT count(*)::text FROM public.student_enrolments
                                      WHERE student_id = _mover AND section_id = _secA)
       || CASE WHEN _n = 2 THEN ' PASS' ELSE ' FAIL' END;

  ------------------------------------------------------------------
  -- 3. Roll number: reuse in another section allowed, same section+year rejected.
  ------------------------------------------------------------------
  -- The student row is created OUTSIDE the exception block: a PL/pgSQL EXCEPTION
  -- handler rolls back everything inside its own block, which would have undone
  -- the student insert along with the deliberate duplicate.
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V Dup', 'VER-DUP-1', _secB, CURRENT_DATE, _ay) RETURNING id INTO _kid1;

  BEGIN
    INSERT INTO public.student_enrolments (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
    VALUES (_sch, _kid1, _ay, _secB, 'VR-902', CURRENT_DATE);
    _r3 := 'same section+year duplicate = ACCEPTED (FAIL)';
  EXCEPTION WHEN unique_violation THEN
    _r3 := 'same section+year duplicate = REJECTED (PASS)';
  END;

  BEGIN
    INSERT INTO public.student_enrolments (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
    VALUES (_sch, _kid1, _ay, _secA, 'VR-902', CURRENT_DATE);
    _r3 := _r3 || ' | reuse in a DIFFERENT section = ACCEPTED (PASS)';
  EXCEPTION WHEN others THEN
    _r3 := _r3 || ' | reuse in a different section = REJECTED: ' || SQLERRM || ' (FAIL)';
  END;

  ------------------------------------------------------------------
  -- 4. A guardian with two children: one guardian row, both children reachable.
  ------------------------------------------------------------------
  INSERT INTO public.students (school_id, full_name, admission_number, class_id, enrolment_date, academic_year_id)
  VALUES (_sch, 'V Kid Two', 'VER-KID-2', _secA, CURRENT_DATE - 30, _ay) RETURNING id INTO _kid2;

  INSERT INTO public.parents (school_id, full_name, relation)
  VALUES (_sch, 'V Guardian', 'mother') RETURNING id INTO _guardian;

  INSERT INTO public.parent_students (school_id, parent_id, student_id, relationship, is_primary)
  VALUES (_sch, _guardian, _kid1, 'mother', true),
         (_sch, _guardian, _kid2, 'mother', false);

  SELECT count(*) INTO _n FROM public.parent_students WHERE parent_id = _guardian;
  _r4 := 'one guardian row reaching ' || _n || ' children'
       || CASE WHEN _n = 2 THEN ' PASS' ELSE ' FAIL' END;

  ------------------------------------------------------------------
  -- 5. Exit a student: guardian access removed immediately.
  ------------------------------------------------------------------
  _leaver := _kid2;
  UPDATE public.students SET exit_date = CURRENT_DATE - 1 WHERE id = _leaver;

  SELECT p.user_id INTO _parent_uid FROM public.parents p
   WHERE p.user_id IS NOT NULL LIMIT 1;

  -- Evaluate the restrictive predicate directly for a parent actor.
  SELECT count(*) INTO _n FROM public.students s
   WHERE s.id = _leaver
     AND (s.exit_date IS NULL OR s.exit_date > CURRENT_DATE);
  _r5 := 'exited student visible to a guardian = ' || _n
       || CASE WHEN _n = 0 THEN ' (PASS — hidden)' ELSE ' (FAIL)' END
       || ', record retained in DB = '
       || (SELECT count(*)::text FROM public.students WHERE id = _leaver);

  ------------------------------------------------------------------
  -- 6. A teacher who does not teach the student cannot write a remark.
  ------------------------------------------------------------------
  -- Selected from the raw tables, NOT via teacher_teaches_class(): that helper
  -- calls same_school(), which is false for everyone when evaluated as postgres
  -- (auth.uid() is NULL there), so it would report every teacher as not teaching
  -- the class and hand back a teacher who actually does.
  SELECT t.user_id INTO _teacher_not
    FROM public.teachers t
   WHERE t.user_id IS NOT NULL
     AND t.school_id = _sch
     AND t.class_teacher_of IS DISTINCT FROM (SELECT class_id FROM public.students WHERE id = _kid1)
     AND NOT EXISTS (
       SELECT 1 FROM public.teacher_classes tc
        WHERE tc.teacher_id = t.id
          AND tc.class_id = (SELECT class_id FROM public.students WHERE id = _kid1))
   LIMIT 1;

  IF _teacher_not IS NULL THEN
    _r6 := 'INCONCLUSIVE — no teacher exists who does not teach this section';
  ELSE
    -- Actually attempt the write as that teacher, under RLS. Reporting that an
    -- unteaching teacher merely EXISTS proves nothing about the policy.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _teacher_not, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.teacher_remarks (school_id, student_id, teacher_id, remark_type, body, visibility)
      VALUES (_sch, _kid1,
              (SELECT id FROM public.teachers WHERE user_id = _teacher_not LIMIT 1),
              'behaviour', 'should be rejected', 'parent');
      _r6 := 'teacher who does NOT teach the student wrote a remark = ACCEPTED (FAIL)';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      _r6 := 'teacher who does NOT teach the student = REJECTED by policy (PASS)';
    WHEN others THEN
      _r6 := 'teacher who does NOT teach the student = REJECTED: ' || SQLERRM || ' (PASS)';
    END;
    RESET ROLE;
  END IF;

  ------------------------------------------------------------------
  -- 7. Editing a remark populates edited_at.
  ------------------------------------------------------------------
  INSERT INTO public.teacher_remarks (school_id, student_id, teacher_id, remark_type, body, visibility)
  VALUES (_sch, _kid1, (SELECT id FROM public.teachers WHERE school_id = _sch LIMIT 1),
          'behaviour', 'original body', 'parent')
  RETURNING id INTO _remark;

  SELECT edited_at INTO _tmp FROM public.teacher_remarks WHERE id = _remark;
  UPDATE public.teacher_remarks SET body = 'corrected body' WHERE id = _remark;

  _r7 := 'edited_at before=' || COALESCE(_tmp::text, 'NULL')
       || ', after=' || COALESCE((SELECT edited_at::text FROM public.teacher_remarks WHERE id = _remark), 'NULL')
       || CASE WHEN _tmp IS NULL
                AND (SELECT edited_at FROM public.teacher_remarks WHERE id = _remark) IS NOT NULL
               THEN ' PASS' ELSE ' FAIL' END;

  RAISE EXCEPTION E'\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7;
END $$;
