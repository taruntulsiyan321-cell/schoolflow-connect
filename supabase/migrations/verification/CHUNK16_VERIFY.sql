-- =====================================================================
-- CHUNK 1.6 — verification.
--
--   1. Teacher, parent, principal and admin each return ZERO rows from
--      student_mistakes and concept_mastery (and the three tables the
--      exhaustive search added).
--   2. The student returns their own rows only.
--   3. No RPC, view or function exposes practice data to another role.
--   4. XP remains readable for the section leaderboard — the one exception.
--
-- Reads only; ends in a deliberate RAISE so nothing can persist.
-- =====================================================================

DO $v$
DECLARE
  _out text := E'\n===== CHUNK 1.6 VERIFICATION =====\n';
  _ok boolean := true;
  _p record;
  _t text;
  _n int;
  _row text;
  _student uuid;
  _tables text[] := ARRAY['student_mistakes','concept_mastery','question_records',
                          'revision_queue','student_academic_brain'];
BEGIN
  -- =================================================================
  -- 1. NON-STUDENT ROLES SEE NOTHING
  -- =================================================================
  _out := _out || format('1. PRACTICE TABLES BY ROLE (expected 0 for every non-student)%s', E'\n');
  _out := _out || format('%-11s %-30s %s%s', 'ROLE', 'ACCOUNT',
                         array_to_string(_tables, ' | '), E'\n');

  FOR _p IN
    SELECT pr.id, pr.email, m.role::text AS role
      FROM public.profiles pr
      JOIN public.memberships m ON m.account_id = pr.id AND m.status = 'active'
     WHERE pr.email IN ('priya.sharma@wisdomcampus.com', 'mehta.parent@wisdomcampus.com',
                        'admin@wisdomcampus.com', 'principal@wisdomcampus.com',
                        'arjun.mehta@wisdomcampus.com')
     ORDER BY CASE m.role::text WHEN 'student' THEN 2 ELSE 1 END, m.role
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _p.id, 'role', 'authenticated',
                        'session_id', gen_random_uuid())::text, true);
    SET LOCAL ROLE authenticated;

    _row := '';
    FOREACH _t IN ARRAY _tables LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', _t) INTO _n;
      EXCEPTION WHEN others THEN _n := -1;
      END;
      _row := _row || lpad(_n::text, 5) || ' ';

      -- Every non-student must be at zero.
      IF _p.role <> 'student' AND _n > 0 THEN _ok := false; END IF;
    END LOOP;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    _out := _out || format('%-11s %-30s %s%s', _p.role, _p.email, _row, E'\n');
  END LOOP;

  -- =================================================================
  -- 2. THE STUDENT SEES THEIR OWN ROWS ONLY
  -- =================================================================
  SELECT id INTO _student FROM public.profiles WHERE email = 'arjun.mehta@wisdomcampus.com';
  _out := _out || format('%s2. THE STUDENT SEES ONLY THEIR OWN%s', E'\n', E'\n');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated',
                      'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;

  FOREACH _t IN ARRAY _tables LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id <> $1', _t)
        INTO _n USING _student;
    EXCEPTION WHEN others THEN _n := -1;
    END;
    _out := _out || format('  %-24s rows belonging to someone else: %s   (expected 0)%s',
                           _t, _n, E'\n');
    IF _n > 0 THEN _ok := false; END IF;
  END LOOP;

  -- =================================================================
  -- 3. THE GUTTED RPCs REFUSE
  -- =================================================================
  RESET ROLE;
  _out := _out || format('%s3. ANALYTICS RPCs%s', E'\n', E'\n');

  FOR _p IN
    SELECT pr.id, pr.email, m.role::text AS role
      FROM public.profiles pr
      JOIN public.memberships m ON m.account_id = pr.id AND m.status = 'active'
     WHERE pr.email IN ('priya.sharma@wisdomcampus.com', 'mehta.parent@wisdomcampus.com',
                        'principal@wisdomcampus.com')
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _p.id, 'role', 'authenticated',
                        'session_id', gen_random_uuid())::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      IF _p.role = 'teacher' THEN
        PERFORM public.rpc_teacher_concept_analytics(
          (SELECT id FROM public.classes ORDER BY created_at LIMIT 1));
      ELSIF _p.role = 'parent' THEN
        PERFORM public.rpc_parent_concept_analytics();
      ELSE
        PERFORM public.rpc_principal_concept_analytics();
      END IF;
      _out := _out || format('  %-10s concept analytics ......... SUCCEEDED   (expected refused)%s',
                             _p.role, E'\n');
      _ok := false;
    EXCEPTION WHEN others THEN
      _out := _out || format('  %-10s concept analytics ......... refused%s', _p.role, E'\n');
    END;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
  END LOOP;

  -- No remaining policy anywhere may grant practice data by role.
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = ANY (_tables || ARRAY['practice_sessions','question_attempts'])
     AND permissive = 'PERMISSIVE'
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
         ~ '(has_role|teacher_teaches_class|parent_user_id|parent_students)';
  _out := _out || format('  policies granting practice by role ... %s   (expected 0)%s', _n, E'\n');
  IF _n > 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM information_schema.views WHERE table_schema = 'public';
  _out := _out || format('  views in public ...................... %s   (none to leak through)%s', _n, E'\n');

  -- =================================================================
  -- 4. XP SURVIVES — the one deliberate exception
  -- =================================================================
  _out := _out || format('%s4. XP / LEADERBOARD (must still work)%s', E'\n', E'\n');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated',
                      'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.student_xp;
  _out := _out || format('  student_xp rows visible to student ... %s   (expected > 0)%s', _n, E'\n');
  IF _n = 0 THEN _ok := false; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL CHECKS PASSED' ELSE 'AT LEAST ONE CHECK FAILED' END, E'\n');
  RAISE EXCEPTION '%', _out;
END;
$v$;
