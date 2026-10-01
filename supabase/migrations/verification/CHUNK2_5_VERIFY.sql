-- ═══════════════════════════════════════════════════════════════════════════
-- Chunk 2.5 verification. Impersonates real identities via
-- `SET LOCAL ROLE authenticated` + request.jwt.claims, so RLS and auth.uid()
-- behave exactly as they do for a signed-in user. Everything is rolled back.
--
-- Rewritten 2026-10-01 (KNOWN_ISSUES 64). It had rotted on
-- homework.section_subject_id, which the homework redesign removed — and it
-- could not have failed even before that: it printed "(BAD)" into a report the
-- runner counts as a pass, and its foreign-teacher check used a random uuid, so
-- a missing teacher, not a tenant key, was what refused it. Every check below
-- now names its failure with (FAIL), and every refusal has a control that the
-- same statement is accepted when the one thing under test is put right.
--
-- Its homework item found the tenant key gone: 20261133000000 restored it.
--
-- CHUNK2_5_VERIFY_OK means every item ran and passed.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _teacher uuid; _parent uuid; _princ uuid; _student uuid;
  _sch uuid; _other uuid; _cls uuid;
  _ss uuid; _ss_sch uuid; _t_same uuid; _t_other uuid;
  _snap jsonb; _n bigint; _fail text := '';
BEGIN
  SELECT id INTO _teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO _parent  FROM auth.users WHERE email = 'mehta.parent@wisdomcampus.com';
  SELECT id INTO _princ   FROM auth.users WHERE email = 'principal@wisdomcampus.com';
  SELECT id INTO _student FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  IF _teacher IS NULL OR _parent IS NULL OR _princ IS NULL OR _student IS NULL THEN
    RAISE EXCEPTION 'CHUNK2_5_VERIFY: a demo account is missing; cannot verify as real roles.';
  END IF;

  -- ── 1-3. rpc_get_student_progression: practice counts are the student's own.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _snap := public.rpc_get_student_progression(_student);
  RESET ROLE;
  IF jsonb_typeof(_snap -> 'counts') IS DISTINCT FROM 'object' THEN
    _fail := _fail || '(FAIL) 1: the teacher got no counts object, so the absence below proves nothing. ';
  ELSIF (_snap -> 'counts') ? 'practice_sessions' THEN
    _fail := _fail || '(FAIL) 1: a teacher received the student''s practice_sessions. ';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _snap := public.rpc_get_student_progression(_student);
  RESET ROLE;
  IF jsonb_typeof(_snap -> 'counts') IS DISTINCT FROM 'object' THEN
    _fail := _fail || '(FAIL) 2: the parent got no counts object. ';
  ELSIF (_snap -> 'counts') ? 'practice_sessions' THEN
    _fail := _fail || '(FAIL) 2: a parent received the student''s practice_sessions. ';
  END IF;

  -- CONTROL for 1 and 2: the field exists, for the right caller.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _snap := public.rpc_get_student_progression(_student);
  RESET ROLE;
  IF NOT coalesce((_snap -> 'counts') ? 'practice_sessions', false) THEN
    _fail := _fail || '(FAIL) 3: the student did not receive their own practice_sessions, so 1 and 2 are passing on a missing field. ';
  END IF;

  -- ── 4. student_xp is not readable by staff — with the table non-empty.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.student_xp;
  RESET ROLE;
  IF _n <> 0 THEN _fail := _fail || format('(FAIL) 4: a teacher read %s student_xp row(s). ', _n); END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _princ, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.student_xp;
  RESET ROLE;
  IF _n <> 0 THEN _fail := _fail || format('(FAIL) 4: the principal read %s student_xp row(s). ', _n); END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT count(*) INTO _n FROM public.student_xp;
  IF _n = 0 THEN _fail := _fail || '(FAIL) 4: student_xp is empty, so the zero reads above prove nothing. '; END IF;

  -- ── 5. Homework belongs to its class's school (20261133000000).
  SELECT st.school_id INTO _sch FROM public.students st WHERE st.user_id = _student;
  SELECT c.id INTO _cls FROM public.classes c WHERE c.school_id = _sch ORDER BY c.created_at LIMIT 1;
  SELECT s.id INTO _other FROM public.schools s WHERE s.id <> _sch ORDER BY s.created_at LIMIT 1;
  IF _cls IS NULL OR _other IS NULL THEN
    RAISE EXCEPTION 'CHUNK2_5_VERIFY: need a class of the demo school and a second school.';
  END IF;

  BEGIN
    INSERT INTO public.homework (class_id, subject, title, school_id, closes_at)
    VALUES (_cls, 'VERIFY', 'no school', NULL, now() + interval '1 day');
    _fail := _fail || '(FAIL) 5a: a homework with no school was accepted. ';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.homework (class_id, subject, title, school_id, closes_at)
    VALUES (_cls, 'VERIFY', 'another school', _other, now() + interval '1 day');
    _fail := _fail || '(FAIL) 5b: a homework naming another school''s class was accepted. ';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- CONTROL for 5a and 5b: the same row, with the class's own school.
  BEGIN
    INSERT INTO public.homework (class_id, subject, title, school_id, closes_at)
    VALUES (_cls, 'VERIFY', 'own school', _sch, now() + interval '1 day');
  EXCEPTION WHEN others THEN
    _fail := _fail || format('(FAIL) 5c: the own-school homework was refused (%s), so 5a and 5b prove nothing. ', SQLERRM);
  END;

  -- ── 6. A teacher assignment cannot cross schools. Both teachers are REAL
  --    rows, so a refusal is the tenant key, not a missing teacher.
  SELECT ss.id, ss.school_id INTO _ss, _ss_sch FROM public.section_subjects ss WHERE ss.school_id = _sch LIMIT 1;
  SELECT t.id INTO _t_same  FROM public.teachers t WHERE t.school_id = _ss_sch ORDER BY t.created_at LIMIT 1;
  SELECT t.id INTO _t_other FROM public.teachers t WHERE t.school_id <> _ss_sch ORDER BY t.created_at LIMIT 1;
  IF _ss IS NULL OR _t_same IS NULL OR _t_other IS NULL THEN
    RAISE EXCEPTION 'CHUNK2_5_VERIFY: need a section subject, a teacher of its school and a teacher of another.';
  END IF;

  BEGIN
    INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, start_date)
    VALUES (_ss_sch, _ss, _t_other, current_date);
    _fail := _fail || '(FAIL) 6a: a teacher of another school was assigned to this school''s subject. ';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, start_date)
    VALUES (_ss_sch, _ss, _t_same, current_date);
  EXCEPTION WHEN others THEN
    _fail := _fail || format('(FAIL) 6b: a same-school assignment was refused (%s), so 6a proves nothing. ', SQLERRM);
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION E'CHUNK2_5_VERIFY — AT LEAST ONE CHECK FAILED\n%', _fail;
  END IF;
  RAISE EXCEPTION 'CHUNK2_5_VERIFY_OK — 6/6 passed (practice counts own-only, student_xp closed to staff, homework and assignments held to their school, every refusal with its control). Rolling back.';
END
$verify$;
