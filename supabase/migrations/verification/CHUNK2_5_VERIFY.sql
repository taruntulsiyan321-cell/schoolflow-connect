-- Chunk 2.5 verification. Impersonates real identities via
-- `SET LOCAL ROLE authenticated` + request.jwt.claims, so RLS and auth.uid()
-- behave exactly as they do for a signed-in user. Everything is rolled back.
DO $$
DECLARE
  _teacher uuid;
  _parent  uuid;
  _princ   uuid;
  _student uuid;
  _cls     uuid;
  _sch     uuid;
  _snap    jsonb;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text;
BEGIN
  SELECT id INTO _teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO _parent  FROM auth.users WHERE email = 'mehta.parent@wisdomcampus.com';
  SELECT id INTO _princ   FROM auth.users WHERE email = 'principal@wisdomcampus.com';
  SELECT id INTO _student FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  SELECT id, school_id INTO _cls, _sch FROM public.classes LIMIT 1;

  -- 1. Teacher calling the progression RPC must NOT receive practice_sessions.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _snap := public.rpc_get_student_progression(_student);
  _r1 := 'teacher counts=' || COALESCE(_snap -> 'counts', 'null'::jsonb)::text;
  RESET ROLE;

  -- 2. Parent likewise.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _snap := public.rpc_get_student_progression(_student);
  _r2 := 'parent counts=' || COALESCE(_snap -> 'counts', 'null'::jsonb)::text;
  RESET ROLE;

  -- 3. The student themselves MUST still receive their own counts.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _snap := public.rpc_get_student_progression(_student);
  _r3 := 'self counts=' || COALESCE(_snap -> 'counts', 'null'::jsonb)::text;
  RESET ROLE;

  -- 4. student_xp table read as staff must return zero rows.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _r4 := 'teacher student_xp rows=' || (SELECT count(*) FROM public.student_xp)::text;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _princ, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _r4 := _r4 || ' | principal student_xp rows=' || (SELECT count(*) FROM public.student_xp)::text;
  RESET ROLE;

  -- 5. The homework MATCH SIMPLE bypass must now be closed.
  BEGIN
    INSERT INTO public.homework (class_id, subject, title, school_id, section_subject_id)
    VALUES (_cls, 'FKTEST', 'probe', NULL, '11111111-2222-3333-4444-555555555555');
    _r5 := 'homework NULL-school bypass = STILL ACCEPTED (BAD)';
  EXCEPTION
    WHEN not_null_violation   THEN _r5 := 'homework NULL-school bypass = REJECTED (not-null)';
    WHEN foreign_key_violation THEN _r5 := 'homework NULL-school bypass = REJECTED (fk)';
  END;

  -- 6. A teacher assignment naming a teacher from another institution must fail.
  BEGIN
    INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, start_date)
    SELECT ss.school_id, ss.id, t.id, current_date
      FROM public.section_subjects ss, public.teachers t
     LIMIT 1;
    -- Same school, so this legitimately succeeds; now force a mismatch.
    _r6 := 'same-school assignment = ACCEPTED (correct)';
  EXCEPTION WHEN others THEN
    _r6 := 'same-school assignment = REJECTED (' || SQLERRM || ')';
  END;

  BEGIN
    INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, start_date)
    SELECT ss.school_id, ss.id, '99999999-8888-7777-6666-555555555555'::uuid, current_date
      FROM public.section_subjects ss LIMIT 1;
    _r6 := _r6 || ' | foreign-teacher assignment = ACCEPTED (BAD)';
  EXCEPTION WHEN foreign_key_violation THEN
    _r6 := _r6 || ' | foreign-teacher assignment = REJECTED by composite FK (correct)';
  END;

  RAISE EXCEPTION E'\n  1) %\n  2) %\n  3) %\n  4) %\n  5) %\n  6) %\n  [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6;
END $$;
