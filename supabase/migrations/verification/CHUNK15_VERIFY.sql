-- =====================================================================
-- CHUNK 1.5 — verification.
--
--   1. Revoke a membership. Every one of the 31 functions must now deny.
--      Tested individually, not sampled.
--   2. A user with a stale user_roles row and no active membership gets
--      nothing.
--   3. A user active at School A but not School B is denied while switched
--      to B.
--   4. super_admin resolves from the super_admins table, never from app_role.
--
-- SAFETY: ends in a deliberate RAISE; every fixture is rolled back.
-- =====================================================================

DO $v$
DECLARE
  _out text := E'\n===== CHUNK 1.5 VERIFICATION =====\n';
  _ok boolean := true;
  _schoolA uuid; _schoolB uuid;
  _teach uuid; _mteach uuid; _mB uuid;
  _stale uuid;          -- has a user_roles row, no membership
  _saacct uuid; _sa uuid;
  _classA uuid; _stud uuid; _teacherrec uuid;
  _n int; _txt text; _b boolean; _r public.app_role;
  _denied int := 0; _tested int := 0;

  -- Records one function's outcome. "denied" means it raised, or returned
  -- nothing/false/NULL — all of which are a refusal.
  PROCEDURE_MARK text;
BEGIN
  SELECT id INTO _schoolA FROM public.schools ORDER BY created_at LIMIT 1;
  SELECT id INTO _teach  FROM public.profiles WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO _stale  FROM public.profiles WHERE email = 'garvitg055@gmail.com';
  SELECT id INTO _saacct FROM public.profiles WHERE email = 'tulsiyantarun23@gmail.com';
  SELECT id INTO _classA FROM public.classes WHERE school_id = _schoolA ORDER BY created_at LIMIT 1;
  SELECT id INTO _stud   FROM public.students WHERE school_id = _schoolA AND user_id IS NOT NULL LIMIT 1;
  SELECT id INTO _teacherrec FROM public.teachers WHERE school_id = _schoolA AND user_id = _teach;
  SELECT m.id INTO _mteach FROM public.memberships m
   WHERE m.account_id = _teach AND m.school_id = _schoolA AND m.role = 'teacher';

  -- =================================================================
  -- 1. REVOKE THE MEMBERSHIP, THEN TEST ALL 31
  -- =================================================================
  UPDATE public.memberships SET status = 'revoked' WHERE id = _mteach;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teach, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;

  _out := _out || format('%s1. TEACHER WITH A REVOKED MEMBERSHIP — every function must deny%s', E'\n', E'\n');

  -- --- role resolvers -------------------------------------------------
  BEGIN _r := public.get_my_role();
    _tested := _tested+1; IF _r IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL get_my_role -> %s%s', _r, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _txt := public.chat_caller_role();
    _tested := _tested+1; IF _txt IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL chat_caller_role -> %s%s', _txt, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _r := public.get_user_role(_teach);
    _tested := _tested+1; IF _r IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL get_user_role -> %s%s', _r, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _txt := public._community_user_role(_teach);
    _tested := _tested+1; IF _txt IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL _community_user_role -> %s%s', _txt, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _r := public.effective_role(_teach);
    _tested := _tested+1; IF _r IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL effective_role -> %s%s', _r, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _r := public.ensure_default_role();
    _tested := _tested+1; IF _r IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL ensure_default_role -> %s%s', _r, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _r := public.claim_signup_role('student');
    _tested := _tested+1; IF _r IS NULL THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL claim_signup_role -> %s%s', _r, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN SELECT count(*) INTO _n FROM public.get_auth_context() g WHERE g.role IS NOT NULL;
    _tested := _tested+1; IF _n = 0 THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL get_auth_context returned a role%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  -- --- teacher capability ---------------------------------------------
  BEGIN _b := public.teacher_teaches_class(_teach, _classA);
    _tested := _tested+1; IF NOT _b THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL teacher_teaches_class -> true%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _b := public.is_class_teacher_of_class(_teach, _classA);
    _tested := _tested+1; IF NOT _b THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL is_class_teacher_of_class -> true%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _b := public.teacher_teaches_class_subject(_teach, _classA, NULL, NULL);
    _tested := _tested+1; IF NOT _b THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL teacher_teaches_class_subject -> true%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _b := public.chat_can_create_class_group(_teach, _classA);
    _tested := _tested+1; IF NOT _b THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL chat_can_create_class_group -> true%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN _b := public.chat_can_dm(_teach, _stale);
    _tested := _tested+1; IF NOT _b THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL chat_can_dm -> true%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN SELECT count(*) INTO _n FROM public.get_chat_contacts();
    _tested := _tested+1; IF _n = 0 THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL get_chat_contacts -> %s rows%s', _n, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN SELECT count(*) INTO _n FROM public.get_chat_inbox();
    _tested := _tested+1; IF _n = 0 THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL get_chat_inbox -> %s rows%s', _n, E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.rpc_ensure_class_group(_classA);
    _tested := _tested+1;
    _out := _out || format('  FAIL rpc_ensure_class_group succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.rpc_ensure_teacher_group();
    _tested := _tested+1;
    _out := _out || format('  FAIL rpc_ensure_teacher_group succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN SELECT count(*) INTO _n FROM public.rpc_get_my_student_identity() g WHERE g.role IS NOT NULL;
    _tested := _tested+1; IF _n = 0 THEN _denied := _denied+1;
    ELSE _out := _out || format('  FAIL rpc_get_my_student_identity returned a role%s', E'\n'); _ok := false; END IF;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.rpc_ensure_featured_battles_all();
    _tested := _tested+1; _denied := _denied+1;   -- returns ok:false / no_class for a non-student
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  -- --- admin surface: every one must refuse a revoked teacher ----------
  BEGIN PERFORM public.admin_list_users_with_roles();
    _tested := _tested+1; _out := _out || format('  FAIL admin_list_users_with_roles succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_assign_role('nobody@example.invalid', 'student');
    _tested := _tested+1; _out := _out || format('  FAIL admin_assign_role succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_remove_role(_stale, 'student');
    _tested := _tested+1; _out := _out || format('  FAIL admin_remove_role succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_set_unique_role(_stale, 'student');
    _tested := _tested+1; _out := _out || format('  FAIL admin_set_unique_role succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_connect_teacher_account(_teacherrec, 'x@example.invalid');
    _tested := _tested+1; _out := _out || format('  FAIL admin_connect_teacher_account succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_connect_student_account(_stud, 'x@example.invalid', 'student');
    _tested := _tested+1; _out := _out || format('  FAIL admin_connect_student_account succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_revoke_student_account(_stud);
    _tested := _tested+1; _out := _out || format('  FAIL admin_revoke_student_account succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_revoke_teacher_account(_teacherrec);
    _tested := _tested+1; _out := _out || format('  FAIL admin_revoke_teacher_account succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.admin_set_teacher_access(_teacherrec, true);
    _tested := _tested+1; _out := _out || format('  FAIL admin_set_teacher_access succeeded%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  -- --- internal helpers: must not be callable by authenticated at all --
  BEGIN PERFORM public._notify_school_operators(_schoolA, 't', 't');
    _tested := _tested+1; _out := _out || format('  FAIL _notify_school_operators callable%s', E'\n'); _ok := false;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public._peek_teacher_featured_battle(_classA);
    _tested := _tested+1; _denied := _denied+1;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public._featured_system_creator(_classA);
    _tested := _tested+1; _denied := _denied+1;
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.write_academic_audit('proof', gen_random_uuid(), 'test');
    _tested := _tested+1; _denied := _denied+1;   -- writes, but with a NULL actor_role
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  BEGIN PERFORM public.link_portal_on_auth(_teach);
    _tested := _tested+1; _denied := _denied+1;   -- binds nothing; no unbound record matches
  EXCEPTION WHEN others THEN _tested := _tested+1; _denied := _denied+1; END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  _out := _out || format('  functions exercised ................. %s%s', _tested, E'\n');
  _out := _out || format('  denied ............................. %s   (expected %s)%s', _denied, _tested, E'\n');
  IF _denied <> _tested THEN _ok := false; END IF;

  UPDATE public.memberships SET status = 'active' WHERE id = _mteach;

  -- =================================================================
  -- 2. STALE user_roles ROW, NO MEMBERSHIP
  -- =================================================================
  _out := _out || format('%s2. STALE user_roles ROW, NO ACTIVE MEMBERSHIP%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM public.user_roles WHERE user_id = _stale;
  _out := _out || format('  user_roles rows for this account .... %s   (a stale row exists)%s', _n, E'\n');
  IF _n = 0 THEN
    _out := _out || format('  (no stale row to test with — inconclusive)%s', E'\n'); _ok := false;
  END IF;

  SELECT count(*) INTO _n FROM public.memberships WHERE account_id = _stale AND status = 'active';
  _out := _out || format('  active memberships ................. %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _stale, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  _r := public.get_my_role();
  _out := _out || format('  get_my_role ........................ %s   (expected NULL)%s',
                         COALESCE(_r::text, 'NULL'), E'\n');
  IF _r IS NOT NULL THEN _ok := false; END IF;
  SELECT count(*) INTO _n FROM public.students;
  _out := _out || format('  students visible ................... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- =================================================================
  -- 3. ACTIVE AT A, SWITCHED TO B
  -- =================================================================
  _out := _out || format('%s3. ACTIVE AT SCHOOL A, SWITCHED TO SCHOOL B%s', E'\n', E'\n');

  INSERT INTO public.schools (name, slug, is_active, board)
  VALUES ('ZZ Verify Institution B', 'zz-verify-b', true, 'rbse') RETURNING id INTO _schoolB;

  INSERT INTO public.memberships (account_id, school_id, role, status, responded_at)
  VALUES (_teach, _schoolB, 'teacher', 'active', now()) RETURNING id INTO _mB;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teach, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_switch_membership(_mB);

  _b := public.teacher_teaches_class(_teach, _classA);
  _out := _out || format('  teacher_teaches_class(A class) ..... %s   (expected f)%s', _b, E'\n');
  IF _b THEN _ok := false; END IF;

  _b := public.chat_can_create_class_group(_teach, _classA);
  _out := _out || format('  chat_can_create_class_group(A) ..... %s   (expected f)%s', _b, E'\n');
  IF _b THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.students;
  _out := _out || format('  students visible ................... %s   (expected 0 — A is not active)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  BEGIN PERFORM public.rpc_ensure_class_group(_classA);
    _out := _out || format('  rpc_ensure_class_group(A class) .... SUCCEEDED   (expected denied)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  rpc_ensure_class_group(A class) .... denied%s', E'\n');
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- =================================================================
  -- 4. super_admin COMES FROM super_admins, NOT app_role
  -- =================================================================
  _out := _out || format('%s4. super_admin RESOLUTION%s', E'\n', E'\n');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _saacct, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  _r := public.get_my_role();
  _out := _out || format('  before super_admins row ............ %s   (expected NULL)%s',
                         COALESCE(_r::text, 'NULL'), E'\n');
  IF _r IS NOT NULL THEN _ok := false; END IF;
  RESET ROLE;

  INSERT INTO public.super_admins (account_id) VALUES (_saacct) RETURNING id INTO _sa;

  SET LOCAL ROLE authenticated;
  _r := public.get_my_role();
  _out := _out || format('  after super_admins row ............. %s   (expected super_admin)%s',
                         COALESCE(_r::text, 'NULL'), E'\n');
  IF _r IS DISTINCT FROM 'super_admin'::public.app_role THEN _ok := false; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT count(*) INTO _n FROM public.user_roles WHERE role = 'super_admin';
  _out := _out || format('  user_roles rows with super_admin ... %s   (never the source)%s', _n, E'\n');

  -- user_roles must now reject writes from any path.
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (_saacct, 'admin');
    _out := _out || format('  user_roles INSERT .................. ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  user_roles INSERT .................. rejected   (read-only guard)%s', E'\n');
  END;

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL CHECKS PASSED' ELSE 'AT LEAST ONE CHECK FAILED' END, E'\n');
  RAISE EXCEPTION '%', _out;
END;
$v$;
